// Package httpapi exposes the sync API described in plan section 4.3.
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"quartz/internal/config"
	"quartz/internal/index"
	"quartz/internal/service"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"quartz/internal/auth"
)

type API struct {
	cfg     config.Config
	svc     *service.Service
	idx     *index.Index
	log     *slog.Logger
	limiter *auth.Limiter
}

func New(cfg config.Config, svc *service.Service, idx *index.Index, log *slog.Logger) *API {
	return &API{
		cfg:     cfg,
		svc:     svc,
		idx:     idx,
		log:     log,
		limiter: auth.NewLimiter(10, 15*time.Minute),
	}
}

func (a *API) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(a.logRequests)
	if a.cfg.DevOrigin != "" {
		r.Use(a.devCORS)
	}

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/auth", func(r chi.Router) {
		r.Post("/login", a.handleLogin)
		r.Post("/logout", a.handleLogout)
		r.With(a.requireSession).Get("/session", a.handleSession)
	})

	r.Route("/api", func(r chi.Router) {
		r.Use(a.requireSession)
		r.Get("/snapshot", a.handleSnapshot)
		r.Get("/changes", a.handleChanges)
		r.Get("/search", a.handleSearch)
		r.Get("/history", a.handleHistory)
		r.Get("/file", a.handleGetFile)
		r.Put("/file", a.handlePutFile)
		r.Delete("/file", a.handleDeleteFile)
	})

	if a.cfg.WebDir != "" {
		r.NotFound(a.serveWeb())
	}
	return r
}

func (a *API) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		// Static asset noise is not worth a line each.
		if ww.Status() >= 400 || r.URL.Path == "/auth/login" || len(r.URL.Path) > 4 && r.URL.Path[:4] == "/api" {
			a.log.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"bytes", ww.BytesWritten(),
				"dur", time.Since(start).Round(time.Millisecond).String())
		}
	})
}

func (a *API) devCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin == a.cfg.DevOrigin {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Allow-Headers", "Content-Type, If-Match, If-None-Match, X-Quartz-Device")
			h.Set("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
			h.Set("Access-Control-Expose-Headers", "ETag")
			h.Set("Vary", "Origin")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

type errorBody struct {
	Error string `json:"error"`
	Code  string `json:"code,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, errorBody{Error: msg, Code: code})
}
