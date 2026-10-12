package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"quartz/internal/gitstore"
	"quartz/internal/vault"
)

func (a *API) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	hits, err := serviceFrom(r).Index.Search(q, limit)
	if err != nil {
		// A malformed FTS expression is the user's half-typed query, not a fault.
		a.log.Warn("search failed", "q", q, "err", err)
		writeJSON(w, http.StatusOK, map[string]any{"hits": []any{}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hits": hits})
}

// handleHistory surfaces the vault's git log — the answer to "I deleted a note,
// where did it go" without shelling into the Pi.
func (a *API) handleHistory(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 30
	}
	entries, err := serviceFrom(r).Git.Log(p, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not read history")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

// handleHistoryFile answers a path as it was at one of the commits
// handleHistory lists, so an older version of a note can be put back from the
// app rather than over SSH.
func (a *API) handleHistoryFile(w http.ResponseWriter, r *http.Request) {
	p, err := vault.CleanPath(r.URL.Query().Get("path"))
	if err != nil {
		writeVaultError(w, err)
		return
	}
	data, err := serviceFrom(r).Git.Show(r.URL.Query().Get("rev"), p)
	if errors.Is(err, gitstore.ErrNoRevision) {
		writeError(w, http.StatusNotFound, "not_found", "no such version")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not read history")
		return
	}
	h := w.Header()
	h.Set("Content-Type", contentType(p))
	h.Set("Content-Length", strconv.Itoa(len(data)))
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
