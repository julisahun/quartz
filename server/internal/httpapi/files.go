package httpapi

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"

	"quartz/internal/vault"
)

func (a *API) handleGetFile(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	data, meta, err := serviceFrom(r).Read(p)
	if err != nil {
		writeVaultError(w, err)
		return
	}
	etag := `"` + meta.Hash + `"`
	if match := r.Header.Get("If-None-Match"); match != "" && etagMatches(match, meta.Hash) {
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h := w.Header()
	h.Set("ETag", etag)
	h.Set("Content-Type", contentType(meta.Path))
	h.Set("Content-Length", strconv.Itoa(len(data)))
	h.Set("X-Quartz-Mtime", strconv.FormatInt(meta.ModTime, 10))
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// handlePutFile requires a precondition so two devices can never silently
// overwrite each other: If-Match: <hash> to replace a known version, or
// If-None-Match: * to create a file the client believes does not exist yet.
func (a *API) handlePutFile(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")

	ifMatch := strings.TrimSpace(r.Header.Get("If-Match"))
	ifNone := strings.TrimSpace(r.Header.Get("If-None-Match"))
	mustNotExist := ifNone == "*"
	if ifMatch == "" && !mustNotExist {
		writeError(w, http.StatusPreconditionRequired, "precondition_required",
			"send If-Match: <hash> to update, or If-None-Match: * to create")
		return
	}
	if ifMatch != "" && mustNotExist {
		writeError(w, http.StatusBadRequest, "bad_request", "send one precondition, not both")
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, a.cfg.MaxFileBytes))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "file exceeds the size limit")
		return
	}

	meta, err := serviceFrom(r).Write(p, body, unquoteETag(ifMatch), mustNotExist)
	if errors.Is(err, vault.ErrConflict) {
		// 412 carries the server's current hash so the client can fetch it and
		// write a conflict copy without a second round trip.
		if meta.Hash != "" {
			w.Header().Set("ETag", `"`+meta.Hash+`"`)
		}
		writeError(w, http.StatusPreconditionFailed, "conflict", "the server has a different version")
		return
	}
	if err != nil {
		writeVaultError(w, err)
		return
	}
	w.Header().Set("ETag", `"`+meta.Hash+`"`)
	writeJSON(w, http.StatusOK, meta)
}

func (a *API) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	ifMatch := strings.TrimSpace(r.Header.Get("If-Match"))
	if ifMatch == "" {
		writeError(w, http.StatusPreconditionRequired, "precondition_required", "send If-Match: <hash>")
		return
	}
	err := serviceFrom(r).Delete(p, unquoteETag(ifMatch))
	if errors.Is(err, vault.ErrConflict) {
		writeError(w, http.StatusPreconditionFailed, "conflict", "the server has a different version")
		return
	}
	if err != nil {
		writeVaultError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeVaultError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, vault.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "no such file")
	case errors.Is(err, vault.ErrBadPath):
		writeError(w, http.StatusBadRequest, "bad_path", "invalid path")
	case errors.Is(err, vault.ErrIgnored):
		writeError(w, http.StatusForbidden, "ignored", "that path is not synced")
	case errors.Is(err, vault.ErrTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "file exceeds the size limit")
	default:
		writeError(w, http.StatusInternalServerError, "server_error", "unexpected error")
	}
}

func unquoteETag(v string) string {
	v = strings.TrimPrefix(v, "W/")
	return strings.Trim(v, `"`)
}

func etagMatches(header, hash string) bool {
	for _, part := range strings.Split(header, ",") {
		if unquoteETag(strings.TrimSpace(part)) == hash {
			return true
		}
	}
	return false
}

func contentType(p string) string {
	switch strings.ToLower(path.Ext(p)) {
	case ".md", ".markdown":
		return "text/markdown; charset=utf-8"
	case ".txt", ".csv":
		return "text/plain; charset=utf-8"
	case ".canvas", ".json":
		return "application/json; charset=utf-8"
	}
	if ct := mime.TypeByExtension(path.Ext(p)); ct != "" {
		return ct
	}
	return "application/octet-stream"
}
