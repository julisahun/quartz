package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
)

// --- changing a password --------------------------------------------------

func changePassword(u *signedIn, body map[string]any) *http.Response {
	raw, _ := json.Marshal(body)
	return u.do(http.MethodPost, "/auth/password", raw, nil)
}

func TestChangePassword(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")

	resp := changePassword(juli, map[string]any{"current": testPassword, "next": "a-longer-secret"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("change = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()

	// The new one works and the old one does not.
	h.signIn("juli", "a-longer-secret")
	if resp := h.tryLogin("juli", testPassword); resp != http.StatusUnauthorized {
		t.Fatalf("old password = %d, want 401", resp)
	}
}

// The session that did the changing keeps working: signing yourself out of the
// device you are holding is never what was asked for.
func TestChangePasswordKeepsTheCallersSession(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")

	changePassword(juli, map[string]any{
		"current": testPassword, "next": "a-longer-secret", "signOutOthers": true,
	}).Body.Close()

	if resp := juli.do(http.MethodGet, "/auth/session", nil, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("own session after change = %d, want 200", resp.StatusCode)
	}
}

func TestChangePasswordSignsOtherDevicesOut(t *testing.T) {
	h := newHarness(t)
	laptop := h.account("juli")
	phone := h.signIn("juli", testPassword)

	resp := changePassword(laptop, map[string]any{
		"current": testPassword, "next": "a-longer-secret", "signOutOthers": true,
	})
	out := decode[struct {
		SignedOut int `json:"signedOut"`
	}](t, resp)
	if out.SignedOut != 1 {
		t.Fatalf("signedOut = %d, want 1", out.SignedOut)
	}
	if resp := phone.do(http.MethodGet, "/auth/session", nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("other device = %d, want 401", resp.StatusCode)
	}
}

// Not asking is the same as asking not to: a rotation on a shared machine
// should not knock the phone offline behind the user's back.
func TestChangePasswordLeavesOtherDevicesAloneByDefault(t *testing.T) {
	h := newHarness(t)
	laptop := h.account("juli")
	phone := h.signIn("juli", testPassword)

	changePassword(laptop, map[string]any{"current": testPassword, "next": "a-longer-secret"}).Body.Close()

	if resp := phone.do(http.MethodGet, "/auth/session", nil, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("other device = %d, want 200", resp.StatusCode)
	}
}

func TestChangePasswordRejectsTheWrongCurrentOne(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")

	resp := changePassword(juli, map[string]any{"current": "not-it", "next": "a-longer-secret"})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong current = %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
	// And nothing changed.
	h.signIn("juli", testPassword)
}

func TestChangePasswordRejectsAShortOne(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")

	resp := changePassword(juli, map[string]any{"current": testPassword, "next": "short"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("short password = %d, want 400", resp.StatusCode)
	}
	body := decode[errorBody](t, resp)
	if body.Code != "password_too_short" {
		t.Fatalf("code = %q", body.Code)
	}
	h.signIn("juli", testPassword)
}

func TestChangePasswordNeedsASession(t *testing.T) {
	h := newHarness(t)
	h.account("juli")

	anonymous := &signedIn{h: h}
	resp := changePassword(anonymous, map[string]any{"current": testPassword, "next": "a-longer-secret"})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated = %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
}

// One account cannot reach another's password: the handler takes the name from
// the session and never from the body.
func TestChangePasswordOnlyTouchesTheCaller(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")
	if err := h.store.CreateUser("maria", testPassword); err != nil {
		t.Fatal(err)
	}

	changePassword(juli, map[string]any{
		"user": "maria", "current": testPassword, "next": "a-longer-secret",
	}).Body.Close()

	// maria's password is untouched; juli's is the one that moved.
	h.signIn("maria", testPassword)
	h.signIn("juli", "a-longer-secret")
}
