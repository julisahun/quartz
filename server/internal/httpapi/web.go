package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// serveWeb serves the built PWA from the same origin as the API, which is what
// lets the session cookie and the service worker work without CORS or a second
// vhost. Unknown paths fall back to index.html (client-side routing).
func (a *API) serveWeb() http.HandlerFunc {
	root := a.cfg.WebDir
	fileServer := http.FileServer(http.Dir(root))

	return func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
		if clean == "." || strings.HasPrefix(clean, "..") {
			clean = "index.html"
		}
		full := filepath.Join(root, clean)

		if fi, err := os.Stat(full); err != nil || fi.IsDir() {
			// SPA fallback. Never for /api or /auth — those 404 as JSON.
			if strings.HasPrefix(r.URL.Path, "/api") || strings.HasPrefix(r.URL.Path, "/auth") {
				writeError(w, http.StatusNotFound, "not_found", "no such endpoint")
				return
			}
			clean = "index.html"
			full = filepath.Join(root, clean)
			r = r.Clone(r.Context())
			r.URL.Path = "/index.html"
		}

		switch {
		case strings.HasPrefix(clean, "assets"+string(filepath.Separator)):
			// Vite fingerprints these, so they are safe to pin forever.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case clean == "sw.js" || clean == "index.html" || clean == "manifest.webmanifest":
			// The shell must be re-validated or a stale app sticks forever.
			w.Header().Set("Cache-Control", "no-cache")
		default:
			w.Header().Set("Cache-Control", "no-cache")
		}
		fileServer.ServeHTTP(w, r)
	}
}
