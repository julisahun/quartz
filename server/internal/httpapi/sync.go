package httpapi

import (
	"net/http"
	"strconv"
)

func (a *API) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	idx := serviceFrom(r).Index
	files, err := idx.Snapshot()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not read the manifest")
		return
	}
	head, err := idx.Head()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not read the cursor")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"head": head, "epoch": idx.Epoch(), "files": files})
}

func (a *API) handleChanges(w http.ResponseWriter, r *http.Request) {
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	idx := serviceFrom(r).Index
	changes, head, err := idx.Changes(since, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not read the journal")
		return
	}
	// more=true means the client should call again before considering itself
	// caught up: the page stopped short of head.
	more := len(changes) > 0 && changes[len(changes)-1].Seq < head
	writeJSON(w, http.StatusOK, map[string]any{
		"head":    head,
		"epoch":   idx.Epoch(),
		"changes": changes,
		"more":    more,
	})
}
