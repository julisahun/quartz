package httpapi

import (
	"encoding/json"
	"net"
	"net/http"
	"time"

	"quarts/internal/auth"
)

const cookieName = "quarts_session"

type loginRequest struct {
	User     string `json:"user"`
	Password string `json:"password"`
	Device   string `json:"device"`
}

func (a *API) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "malformed body")
		return
	}
	key := clientIP(r)
	if !a.limiter.Allow(key) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "too many attempts, try again later")
		return
	}

	ok, err := auth.VerifyPassword(req.Password, a.cfg.PasswordHash)
	if err != nil {
		a.log.Error("password hash is unusable", "err", err)
		writeError(w, http.StatusInternalServerError, "server_error", "authentication is misconfigured")
		return
	}
	if !ok || req.User != a.cfg.User {
		a.log.Warn("failed login", "user", req.User, "ip", key)
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "wrong user or password")
		return
	}
	a.limiter.Reset(key)

	token, hash, err := auth.NewToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not start a session")
		return
	}
	device := req.Device
	if device == "" {
		device = "unknown"
	}
	if err := a.idx.CreateSession(hash, device, a.cfg.SessionTTL); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not store the session")
		return
	}
	http.SetCookie(w, a.sessionCookie(token, int(a.cfg.SessionTTL.Seconds())))
	writeJSON(w, http.StatusOK, map[string]any{
		"user":      a.cfg.User,
		"device":    device,
		"expiresAt": time.Now().Add(a.cfg.SessionTTL).UTC().Format(time.RFC3339),
	})
}

func (a *API) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		if err := a.idx.DeleteSession(auth.HashToken(c.Value)); err != nil {
			a.log.Warn("could not delete session", "err", err)
		}
	}
	http.SetCookie(w, a.sessionCookie("", -1))
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) handleSession(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"user": a.cfg.User})
}

// clientIP strips the ephemeral port so the rate limit budget belongs to the
// caller, not to a single connection.
func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func (a *API) sessionCookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     cookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   a.cfg.SecureCookie,
		SameSite: http.SameSiteLaxMode,
	}
}

// requireSession rejects unauthenticated requests with a plain 401 and a
// machine-readable code. Clients must treat this as "prompt for a re-login",
// never as "drop the pending queue" — losing unsent edits silently is the one
// unforgivable bug in a notes app (plan section 4.3).
func (a *API) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil || c.Value == "" {
			writeError(w, http.StatusUnauthorized, "no_session", "sign in again — nothing has been lost")
			return
		}
		hash := auth.HashToken(c.Value)
		sess, ok, err := a.idx.LookupSession(hash)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "session lookup failed")
			return
		}
		if !ok {
			writeError(w, http.StatusUnauthorized, "session_expired", "sign in again — nothing has been lost")
			return
		}
		// Slide the expiry, but write at most once a day per session.
		if time.Since(sess.LastSeen) > 24*time.Hour {
			if err := a.idx.TouchSession(hash, a.cfg.SessionTTL); err != nil {
				a.log.Warn("could not refresh session", "err", err)
			}
			http.SetCookie(w, a.sessionCookie(c.Value, int(a.cfg.SessionTTL.Seconds())))
		}
		next.ServeHTTP(w, r)
	})
}
