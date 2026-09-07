package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"quartz/internal/auth"
)

const cookieName = "quartz_session"

type loginRequest struct {
	User     string `json:"user"`
	Password string `json:"password"`
	Device   string `json:"device"`
	// Client "desktop" also gets the session token in the response body.
	// The Tauri webview is a different origin from the server, so it carries
	// the session in an Authorization header instead of a cookie.
	Client string `json:"client"`
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

	ok, err := a.accounts.Verify(req.User, req.Password)
	if err != nil {
		a.log.Error("could not verify a password", "err", err)
		writeError(w, http.StatusInternalServerError, "server_error", "authentication is misconfigured")
		return
	}
	if !ok {
		// One message for a wrong name and a wrong password: which of the two
		// it was is not the caller's business.
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
	if err := a.accounts.CreateSession(hash, req.User, device, a.cfg.SessionTTL); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not store the session")
		return
	}
	http.SetCookie(w, a.sessionCookie(token, int(a.cfg.SessionTTL.Seconds())))

	vaults, err := a.accounts.VaultsFor(req.User)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not list vaults")
		return
	}
	body := map[string]any{
		"user":      req.User,
		"device":    device,
		"vaults":    vaults,
		"expiresAt": time.Now().Add(a.cfg.SessionTTL).UTC().Format(time.RFC3339),
	}
	if req.Client == "desktop" {
		// Only handed out on request: in a browser the token stays in an
		// HttpOnly cookie where page scripts cannot reach it.
		body["token"] = token
	}
	writeJSON(w, http.StatusOK, body)
}

func (a *API) handleLogout(w http.ResponseWriter, r *http.Request) {
	if token := sessionToken(r); token != "" {
		if err := a.accounts.DeleteSession(auth.HashToken(token)); err != nil {
			a.log.Warn("could not delete session", "err", err)
		}
	}
	http.SetCookie(w, a.sessionCookie("", -1))
	w.WriteHeader(http.StatusNoContent)
}

// handleSession answers "who am I and what can I open", so a client needs one
// round trip at startup.
func (a *API) handleSession(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r)
	vaults, err := a.accounts.VaultsFor(user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not list vaults")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user, "vaults": vaults})
}

// MinPasswordLength is what quartz-admin and quartz-passwd already ask for, so
// a password set in the app and one set over SSH are held to the same rule.
const MinPasswordLength = 8

type passwordRequest struct {
	Current string `json:"current"`
	Next    string `json:"next"`
	// Whether to end the account's other sessions. The client offers it and
	// defaults it on, since a password being changed usually means it is
	// suspected, and a session outlives the password it was opened with.
	SignOutOthers bool `json:"signOutOthers"`
}

// handleChangePassword changes the signed-in account's own password. It is not
// a recovery flow: it needs a session and the current password, so it adds no
// public surface — the reasoning is the one in DECISIONS.md for creating a
// vault, applied to something smaller.
func (a *API) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var req passwordRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "malformed body")
		return
	}
	// Checking the current password is the same oracle login is, so it draws on
	// login's budget rather than being given a fresh one to spend.
	key := clientIP(r)
	if !a.limiter.Allow(key) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "too many attempts, try again later")
		return
	}

	user := userFrom(r)
	ok, err := a.accounts.Verify(user, req.Current)
	if err != nil {
		a.log.Error("could not verify a password", "err", err)
		writeError(w, http.StatusInternalServerError, "server_error", "authentication is misconfigured")
		return
	}
	if !ok {
		a.log.Warn("failed password change", "user", user, "ip", key)
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "that is not your current password")
		return
	}
	// Knowing the current password is proof enough of good faith; a typo in the
	// new one should not spend what is left of the budget.
	a.limiter.Reset(key)

	if len(req.Next) < MinPasswordLength {
		writeError(w, http.StatusBadRequest, "password_too_short",
			fmt.Sprintf("use at least %d characters", MinPasswordLength))
		return
	}
	if err := a.accounts.SetPassword(user, req.Next); err != nil {
		a.log.Error("could not change a password", "err", err, "user", user)
		writeError(w, http.StatusInternalServerError, "server_error", "could not change the password")
		return
	}

	var signedOut int64
	if req.SignOutOthers {
		// The password has already changed. Failing the request now would tell
		// the caller nothing happened, which is the one answer that is false.
		signedOut, err = a.accounts.DeleteSessionsFor(user, auth.HashToken(sessionToken(r)))
		if err != nil {
			a.log.Error("could not sign the other devices out", "err", err, "user", user)
		}
	}
	a.log.Info("password changed", "user", user, "signedOut", signedOut)
	writeJSON(w, http.StatusOK, map[string]any{"signedOut": signedOut})
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
		token := sessionToken(r)
		if token == "" {
			writeError(w, http.StatusUnauthorized, "no_session", "sign in again — nothing has been lost")
			return
		}
		hash := auth.HashToken(token)
		session, ok, err := a.accounts.LookupSession(hash)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "session lookup failed")
			return
		}
		if !ok {
			writeError(w, http.StatusUnauthorized, "session_expired", "sign in again — nothing has been lost")
			return
		}
		// Slide the expiry, but write at most once a day per session.
		if time.Since(session.LastSeen) > 24*time.Hour {
			if err := a.accounts.TouchSession(hash, a.cfg.SessionTTL); err != nil {
				a.log.Warn("could not refresh session", "err", err)
			}
			http.SetCookie(w, a.sessionCookie(token, int(a.cfg.SessionTTL.Seconds())))
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userCtxKey, session.User)))
	})
}

// sessionToken reads the session from the cookie a browser sends, or from the
// Authorization header the desktop shell sends.
func sessionToken(r *http.Request) string {
	if c, err := r.Cookie(cookieName); err == nil && c.Value != "" {
		return c.Value
	}
	const prefix = "Bearer "
	if header := r.Header.Get("Authorization"); strings.HasPrefix(header, prefix) {
		return strings.TrimSpace(header[len(prefix):])
	}
	return ""
}

// clientIP strips the ephemeral port so the rate limit budget belongs to the
// caller, not to a single connection.
func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
