// Package httpapi exposes the sync API. Every path below /api/v/{vault} is
// gated by membership of that vault; there is no other way in.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"quartz/internal/accounts"
	"quartz/internal/auth"
	"quartz/internal/config"
	"quartz/internal/provision"
	"quartz/internal/registry"
	"quartz/internal/service"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type API struct {
	cfg      config.Config
	accounts *accounts.Store
	reg      *registry.Registry
	log      *slog.Logger
	limiter  *auth.Limiter
}

func New(cfg config.Config, store *accounts.Store, reg *registry.Registry, log *slog.Logger) *API {
	return &API{
		cfg:      cfg,
		accounts: store,
		reg:      reg,
		log:      log,
		limiter:  auth.NewLimiter(10, 15*time.Minute),
	}
}

type ctxKey int

const (
	userCtxKey ctxKey = iota
	vaultCtxKey
	serviceCtxKey
)

func userFrom(r *http.Request) string {
	user, _ := r.Context().Value(userCtxKey).(string)
	return user
}

func vaultFrom(r *http.Request) accounts.Vault {
	v, _ := r.Context().Value(vaultCtxKey).(accounts.Vault)
	return v
}

func serviceFrom(r *http.Request) *service.Service {
	svc, _ := r.Context().Value(serviceCtxKey).(*service.Service)
	return svc
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
		r.Get("/vaults", a.handleVaults)
		r.Post("/vaults", a.handleCreateVault)

		r.Route("/v/{vault}", func(r chi.Router) {
			r.Use(a.requireVault)
			r.Get("/snapshot", a.handleSnapshot)
			r.Get("/changes", a.handleChanges)
			r.Get("/search", a.handleSearch)
			r.Get("/history", a.handleHistory)
			r.Get("/members", a.handleMembers)
			r.Get("/file", a.handleGetFile)
			r.Put("/file", a.handlePutFile)
			r.Delete("/file", a.handleDeleteFile)
		})
	})

	if a.cfg.WebDir != "" {
		r.NotFound(a.serveWeb())
	}
	return r
}

// requireVault resolves {vault} and checks that the signed-in user is a member.
//
// A vault the user cannot reach answers 404, not 403: whether someone else's
// vault exists is not information this API gives out.
func (a *API) requireVault(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := userFrom(r)
		vaultID := chi.URLParam(r, "vault")

		role, err := a.accounts.Access(user, vaultID)
		if errors.Is(err, accounts.ErrNotAMember) {
			writeError(w, http.StatusNotFound, "no_vault", "no such vault")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not check access")
			return
		}
		meta, err := a.accounts.Vault(vaultID)
		if err != nil {
			writeError(w, http.StatusNotFound, "no_vault", "no such vault")
			return
		}
		meta.Role = role

		svc, err := a.reg.Service(vaultID)
		if err != nil {
			a.log.Error("could not open vault", "vault", vaultID, "err", err)
			writeError(w, http.StatusInternalServerError, "server_error", "could not open the vault")
			return
		}

		ctx := context.WithValue(r.Context(), vaultCtxKey, meta)
		ctx = context.WithValue(ctx, serviceCtxKey, svc)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (a *API) handleVaults(w http.ResponseWriter, r *http.Request) {
	vaults, err := a.accounts.VaultsFor(userFrom(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not list vaults")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"vaults": vaults})
}

// handleCreateVault promotes a folder: the caller gets a vault of its own on
// the server, which it then fills through the ordinary file routes.
//
// This is the only way a vault comes into being without shell access, which
// reverses part of "vault changes are CLI-only" (DECISIONS.md) on purpose. It
// creates a vault owned by the caller and nothing else — adding other people
// to one is still quartz-admin's job — so the reach of the endpoint is one
// account's own storage.
func (a *API) handleCreateVault(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r)
	var body struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Bytes int64  `json:"bytes"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "expected {id, name, bytes}")
		return
	}
	if !accounts.ValidName(body.ID) {
		writeError(w, http.StatusBadRequest, "bad_name", accounts.ErrBadName.Error())
		return
	}
	// What the client says it is about to upload. This guards against pointing
	// a promotion at a 40 GB folder by mistake; it is not a defence against a
	// client that lies, and is not meant to be. Signing in already means being
	// trusted with the disk you are writing to.
	if a.cfg.MaxVaultBytes > 0 && body.Bytes > a.cfg.MaxVaultBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large",
			fmt.Sprintf("that folder is %d MB and the limit is %d MB",
				body.Bytes>>20, a.cfg.MaxVaultBytes>>20))
		return
	}
	if body.Name == "" {
		body.Name = body.ID
	}

	switch err := provision.SharedVault(a.accounts, a.cfg, body.ID, body.Name, user); {
	case err == nil:
	case errors.Is(err, accounts.ErrVaultExists):
		// Deliberately not 404-by-obscurity like the read routes: the id is a
		// name the user is choosing, and "taken" is what they need to hear.
		writeError(w, http.StatusConflict, "vault_exists", "that name is already taken")
		return
	case errors.Is(err, accounts.ErrBadName):
		writeError(w, http.StatusBadRequest, "bad_name", accounts.ErrBadName.Error())
		return
	default:
		a.log.Error("creating a vault failed", "vault", body.ID, "user", user, "err", err)
		writeError(w, http.StatusInternalServerError, "server_error", "could not create the vault")
		return
	}

	vault, err := a.accounts.Vault(body.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not read the vault back")
		return
	}
	vault.Role = accounts.Owner
	a.log.Info("vault created from a promoted folder", "vault", vault.ID, "user", user)
	writeJSON(w, http.StatusCreated, vault)
}

func (a *API) handleMembers(w http.ResponseWriter, r *http.Request) {
	members, err := a.accounts.Members(vaultFrom(r).ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not list members")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": members})
}

func (a *API) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		// Static asset noise is not worth a line each.
		if ww.Status() >= 400 || r.URL.Path == "/auth/login" || strings.HasPrefix(r.URL.Path, "/api") {
			a.log.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"user", userFrom(r),
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
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match, If-None-Match, X-Quartz-Device")
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
