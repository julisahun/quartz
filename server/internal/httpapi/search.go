package httpapi

import (
	"net/http"
	"strconv"
)

func (a *API) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	hits, err := a.idx.Search(q, limit)
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
	entries, err := a.svc.Git.Log(p, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not read history")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}
