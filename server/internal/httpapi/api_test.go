package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"quartz/internal/accounts"
	"quartz/internal/config"
	"quartz/internal/provision"
	"quartz/internal/registry"
	"quartz/internal/vault"
)

const testPassword = "hunter2-hunter2"

type harness struct {
	t     *testing.T
	srv   *httptest.Server
	cfg   config.Config
	store *accounts.Store
	reg   *registry.Registry
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	cfg := config.Config{
		DataDir:      t.TempDir(),
		SessionTTL:   time.Hour,
		SecureCookie: false,
		MaxFileBytes: 1 << 20,
		GitEnabled:   false, // git is exercised in the service package
	}
	store, err := accounts.Open(cfg.AccountsDB())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	reg := registry.New(ctx, cfg, store, log)
	t.Cleanup(func() { reg.Close() })

	srv := httptest.NewServer(New(cfg, store, reg, log).Router())
	t.Cleanup(srv.Close)
	return &harness{t: t, srv: srv, cfg: cfg, store: store, reg: reg}
}

// signedIn is one account with a session, i.e. one person using the app.
type signedIn struct {
	h      *harness
	name   string
	cookie string
}

func (h *harness) account(name string) *signedIn {
	h.t.Helper()
	if err := provision.User(h.store, h.cfg, name, testPassword); err != nil {
		h.t.Fatal(err)
	}
	return h.signIn(name, testPassword)
}

func (h *harness) signIn(name, password string) *signedIn {
	h.t.Helper()
	body, _ := json.Marshal(map[string]string{"user": name, "password": password, "device": "test"})
	resp, err := http.Post(h.srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		h.t.Fatalf("login as %s = %d", name, resp.StatusCode)
	}
	user := &signedIn{h: h, name: name}
	for _, c := range resp.Cookies() {
		if c.Name == cookieName {
			user.cookie = c.Value
		}
	}
	if user.cookie == "" {
		h.t.Fatal("no session cookie")
	}
	return user
}

func (u *signedIn) do(method, path string, body []byte, headers map[string]string) *http.Response {
	u.h.t.Helper()
	var r io.Reader
	if body != nil {
		r = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, u.h.srv.URL+path, r)
	if err != nil {
		u.h.t.Fatal(err)
	}
	if u.cookie != "" {
		req.AddCookie(&http.Cookie{Name: cookieName, Value: u.cookie})
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		u.h.t.Fatal(err)
	}
	return resp
}

func (u *signedIn) put(vaultID, path string, body []byte, headers map[string]string) *http.Response {
	return u.do(http.MethodPut, vaultPath(vaultID, "/file?path="+url.QueryEscape(path)), body, headers)
}

func (u *signedIn) create(vaultID, path, body string) vault.FileMeta {
	u.h.t.Helper()
	resp := u.put(vaultID, path, []byte(body), map[string]string{"If-None-Match": "*"})
	if resp.StatusCode != http.StatusOK {
		u.h.t.Fatalf("create %s in %s = %d", path, vaultID, resp.StatusCode)
	}
	return decode[vault.FileMeta](u.h.t, resp)
}

func (u *signedIn) get(vaultID, path string) *http.Response {
	return u.do(http.MethodGet, vaultPath(vaultID, "/file?path="+url.QueryEscape(path)), nil, nil)
}

func vaultPath(vaultID, suffix string) string {
	return "/api/v/" + vaultID + suffix
}

func decode[T any](t *testing.T, resp *http.Response) T {
	t.Helper()
	defer resp.Body.Close()
	var v T
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	return v
}

type vaultList struct {
	Vaults []accounts.Vault `json:"vaults"`
}

// --- sessions -------------------------------------------------------------

func TestLoginAndSession(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")

	session := decode[struct {
		User   string           `json:"user"`
		Vaults []accounts.Vault `json:"vaults"`
	}](t, juli.do(http.MethodGet, "/auth/session", nil, nil))
	if session.User != "juli" || len(session.Vaults) != 1 || session.Vaults[0].ID != "juli" {
		t.Fatalf("session = %+v", session)
	}

	anonymous := &signedIn{h: h}
	if resp := anonymous.do(http.MethodGet, "/api/vaults", nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated = %d, want 401", resp.StatusCode)
	}
}

func TestWrongPasswordAndUnknownUserLookTheSame(t *testing.T) {
	h := newHarness(t)
	h.account("juli")

	for _, creds := range []map[string]string{
		{"user": "juli", "password": "wrong"},
		{"user": "nobody", "password": testPassword},
	} {
		body, _ := json.Marshal(creds)
		resp, err := http.Post(h.srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("login %v = %d, want 401", creds, resp.StatusCode)
		}
		if got := decode[errorBody](t, resp); got.Code != "invalid_credentials" {
			t.Errorf("error code = %q, want invalid_credentials", got.Code)
		}
	}
}

func TestUnauthorizedBodyIsMachineReadable(t *testing.T) {
	// A 401 mid-sync must be recognisable so the client can prompt for a
	// re-login instead of discarding its queue (plan section 4.3).
	h := newHarness(t)
	anonymous := &signedIn{h: h}
	resp := anonymous.do(http.MethodGet, "/api/v/juli/changes?since=0", nil, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if body := decode[errorBody](t, resp); body.Code != "no_session" {
		t.Fatalf("error code = %q, want no_session", body.Code)
	}
}

func TestLoginRateLimited(t *testing.T) {
	h := newHarness(t)
	h.account("juli")
	body, _ := json.Marshal(map[string]string{"user": "juli", "password": "wrong"})
	var last *http.Response
	for i := 0; i < 12; i++ {
		resp, err := http.Post(h.srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		last = resp
	}
	if last.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("after 12 bad logins status = %d, want 429", last.StatusCode)
	}
}

func TestDesktopBearerToken(t *testing.T) {
	h := newHarness(t)
	h.account("juli")
	body, _ := json.Marshal(map[string]string{
		"user": "juli", "password": testPassword, "device": "mac", "client": "desktop",
	})
	resp, err := http.Post(h.srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	out := decode[struct {
		Token string `json:"token"`
	}](t, resp)
	if out.Token == "" {
		t.Fatal("no token was returned to the desktop client")
	}

	req, _ := http.NewRequest(http.MethodGet, h.srv.URL+"/api/vaults", nil)
	req.Header.Set("Authorization", "Bearer "+out.Token)
	authed, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer authed.Body.Close()
	if authed.StatusCode != http.StatusOK {
		t.Fatalf("bearer request = %d, want 200", authed.StatusCode)
	}

	plain, _ := json.Marshal(map[string]string{"user": "juli", "password": testPassword})
	browserResp, err := http.Post(h.srv.URL+"/auth/login", "application/json", bytes.NewReader(plain))
	if err != nil {
		t.Fatal(err)
	}
	if _, leaked := decode[map[string]any](t, browserResp)["token"]; leaked {
		t.Error("the browser login response contains the session token")
	}
}

// --- vaults and isolation --------------------------------------------------

func TestEachAccountGetsItsOwnPrivateVault(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")
	maria := h.account("maria")

	juli.create("juli", "notes/mine.md", "juli's note")
	maria.create("maria", "notes/mine.md", "maria's note")

	// The same path in two vaults is two different files.
	julisCopy, _ := io.ReadAll(juli.get("juli", "notes/mine.md").Body)
	mariasCopy, _ := io.ReadAll(maria.get("maria", "notes/mine.md").Body)
	if string(julisCopy) != "juli's note" || string(mariasCopy) != "maria's note" {
		t.Fatalf("vaults are not separate: %q vs %q", julisCopy, mariasCopy)
	}
	if _, err := os.Stat(filepath.Join(h.cfg.VaultsDir(), "maria", "notes", "mine.md")); err != nil {
		t.Errorf("maria's note is not in her own directory: %v", err)
	}
}

func TestAnotherUsersVaultIsUnreachable(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")
	maria := h.account("maria")
	note := juli.create("juli", "secret.md", "private thoughts")

	// Every route into someone else's vault answers 404 — not 403, which
	// would confirm that the vault exists.
	cases := []struct {
		method, path string
		headers      map[string]string
	}{
		{http.MethodGet, vaultPath("juli", "/snapshot"), nil},
		{http.MethodGet, vaultPath("juli", "/changes?since=0"), nil},
		{http.MethodGet, vaultPath("juli", "/search?q=private"), nil},
		{http.MethodGet, vaultPath("juli", "/history"), nil},
		{http.MethodGet, vaultPath("juli", "/members"), nil},
		{http.MethodGet, vaultPath("juli", "/file?path=secret.md"), nil},
		{http.MethodPut, vaultPath("juli", "/file?path=secret.md"), map[string]string{"If-Match": `"` + note.Hash + `"`}},
		{http.MethodPut, vaultPath("juli", "/file?path=new.md"), map[string]string{"If-None-Match": "*"}},
		{http.MethodDelete, vaultPath("juli", "/file?path=secret.md"), map[string]string{"If-Match": `"` + note.Hash + `"`}},
	}
	for _, c := range cases {
		resp := maria.do(c.method, c.path, []byte("x"), c.headers)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s as maria = %d, want 404", c.method, c.path, resp.StatusCode)
		}
		resp.Body.Close()
	}

	// And the note is untouched.
	body, _ := io.ReadAll(juli.get("juli", "secret.md").Body)
	if string(body) != "private thoughts" {
		t.Fatalf("the note changed: %q", body)
	}

	// It is not even listed.
	list := decode[vaultList](t, maria.do(http.MethodGet, "/api/vaults", nil, nil))
	for _, v := range list.Vaults {
		if v.ID == "juli" {
			t.Fatalf("maria can see juli's vault: %+v", list.Vaults)
		}
	}
}

func TestVaultIdCannotEscape(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")
	for _, id := range []string{"..", "%2e%2e", "juli%2f..", "does-not-exist"} {
		resp := juli.do(http.MethodGet, "/api/v/"+id+"/snapshot", nil, nil)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("vault id %q = %d, want 404", id, resp.StatusCode)
		}
		resp.Body.Close()
	}
}

func TestSharedVault(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")
	maria := h.account("maria")
	outsider := h.account("outsider")

	if err := provision.SharedVault(h.store, h.cfg, "casa", "Casa", "juli"); err != nil {
		t.Fatal(err)
	}
	if err := h.store.AddMember("casa", "maria", accounts.Member); err != nil {
		t.Fatal(err)
	}

	// Both members work in the same vault.
	juli.create("casa", "shopping.md", "- bread\n")
	body, _ := io.ReadAll(maria.get("casa", "shopping.md").Body)
	if string(body) != "- bread\n" {
		t.Fatalf("maria sees %q", body)
	}

	// And maria's edit reaches juli.
	meta := decode[vault.FileMeta](t, maria.put("casa", "shopping.md", []byte("- bread\n- milk\n"),
		map[string]string{"If-Match": `"` + vault.HashBytes([]byte("- bread\n")) + `"`}))
	if meta.Hash != vault.HashBytes([]byte("- bread\n- milk\n")) {
		t.Fatalf("maria's write did not land: %+v", meta)
	}
	julisView, _ := io.ReadAll(juli.get("casa", "shopping.md").Body)
	if string(julisView) != "- bread\n- milk\n" {
		t.Fatalf("juli sees %q", julisView)
	}

	// The outsider does not know it exists.
	if resp := outsider.get("casa", "shopping.md"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("outsider read the shared vault: %d", resp.StatusCode)
	}

	// Both members see it listed, with their role.
	list := decode[vaultList](t, maria.do(http.MethodGet, "/api/vaults", nil, nil))
	var found bool
	for _, v := range list.Vaults {
		if v.ID == "casa" {
			found = true
			if v.Role != accounts.Member || v.Kind != accounts.Shared {
				t.Errorf("maria's view of casa = %+v", v)
			}
		}
	}
	if !found {
		t.Fatalf("maria cannot see casa: %+v", list.Vaults)
	}

	// Losing membership closes the door immediately.
	if err := h.store.RemoveMember("casa", "maria"); err != nil {
		t.Fatal(err)
	}
	if resp := maria.get("casa", "shopping.md"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("maria still reads casa after removal: %d", resp.StatusCode)
	}
}

func TestSearchStaysInsideItsVault(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")
	maria := h.account("maria")

	juli.create("juli", "a.md", "the pi runs cloudflared")
	maria.create("maria", "b.md", "unrelated shopping list")

	hits := decode[struct {
		Hits []struct {
			Path string `json:"path"`
		} `json:"hits"`
	}](t, maria.do(http.MethodGet, vaultPath("maria", "/search?q=cloudflared"), nil, nil))
	if len(hits.Hits) != 0 {
		t.Fatalf("maria's search reached juli's notes: %+v", hits.Hits)
	}
}

// --- files -----------------------------------------------------------------

func TestFileLifecycleAndPreconditions(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")

	if resp := juli.put("juli", "a.md", []byte("x"), nil); resp.StatusCode != http.StatusPreconditionRequired {
		t.Fatalf("unconditional PUT = %d, want 428", resp.StatusCode)
	}

	meta := juli.create("juli", "notes/a.md", "# one")
	if meta.Hash != vault.HashBytes([]byte("# one")) {
		t.Fatal("returned hash does not match the body")
	}
	if resp := juli.put("juli", "notes/a.md", []byte("# clobber"), map[string]string{"If-None-Match": "*"}); resp.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("duplicate create = %d, want 412", resp.StatusCode)
	}

	get := juli.get("juli", "notes/a.md")
	body, _ := io.ReadAll(get.Body)
	get.Body.Close()
	if string(body) != "# one" || get.Header.Get("ETag") != `"`+meta.Hash+`"` {
		t.Fatalf("content %q, etag %q", body, get.Header.Get("ETag"))
	}

	stale := juli.put("juli", "notes/a.md", []byte("# two"), map[string]string{"If-Match": `"deadbeef"`})
	if stale.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("stale write = %d, want 412", stale.StatusCode)
	}
	if stale.Header.Get("ETag") != `"`+meta.Hash+`"` {
		t.Errorf("412 did not carry the current ETag: %q", stale.Header.Get("ETag"))
	}

	updated := decode[vault.FileMeta](t, juli.put("juli", "notes/a.md", []byte("# two"),
		map[string]string{"If-Match": `"` + meta.Hash + `"`}))

	if resp := juli.do(http.MethodDelete, vaultPath("juli", "/file?path=notes%2Fa.md"), nil,
		map[string]string{"If-Match": `"stale"`}); resp.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("stale delete = %d, want 412", resp.StatusCode)
	}
	if resp := juli.do(http.MethodDelete, vaultPath("juli", "/file?path=notes%2Fa.md"), nil,
		map[string]string{"If-Match": `"` + updated.Hash + `"`}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", resp.StatusCode)
	}
	if resp := juli.get("juli", "notes/a.md"); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("get after delete = %d", resp.StatusCode)
	}
}

func TestPathTraversalRejected(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")
	for _, p := range []string{"../escape.md", "/etc/passwd", "a/../../b.md"} {
		resp := juli.put("juli", p, []byte("no"), map[string]string{"If-None-Match": "*"})
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("PUT %q = %d, want 400", p, resp.StatusCode)
		}
		resp.Body.Close()
	}
	if resp := juli.put("juli", ".git/config", []byte("no"), map[string]string{"If-None-Match": "*"}); resp.StatusCode != http.StatusForbidden {
		t.Errorf("PUT into .git = %d, want 403", resp.StatusCode)
	}
}

func TestSnapshotChangesAndSearch(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")
	juli.create("juli", "a.md", "the pi runs cloudflared")
	juli.create("juli", "b.md", "shopping list")

	snap := decode[struct {
		Head  int64            `json:"head"`
		Epoch string           `json:"epoch"`
		Files []vault.FileMeta `json:"files"`
	}](t, juli.do(http.MethodGet, vaultPath("juli", "/snapshot"), nil, nil))
	if len(snap.Files) != 2 || snap.Head != 2 || snap.Epoch == "" {
		t.Fatalf("snapshot = %+v", snap)
	}

	page := decode[struct {
		Head    int64 `json:"head"`
		Changes []struct {
			Path string `json:"path"`
		} `json:"changes"`
		More bool `json:"more"`
	}](t, juli.do(http.MethodGet, vaultPath("juli", "/changes?since=1"), nil, nil))
	if len(page.Changes) != 1 || page.Changes[0].Path != "b.md" || page.More {
		t.Fatalf("changes = %+v", page)
	}

	hits := decode[struct {
		Hits []struct {
			Path string `json:"path"`
		} `json:"hits"`
	}](t, juli.do(http.MethodGet, vaultPath("juli", "/search?q=cloudflared"), nil, nil))
	if len(hits.Hits) != 1 || hits.Hits[0].Path != "a.md" {
		t.Fatalf("search = %+v", hits.Hits)
	}
}

func TestExternalWriteIsJournalled(t *testing.T) {
	// Obsidian writing a vault directly: the file never goes through the API,
	// but the watcher must journal it (plan section 6).
	h := newHarness(t)
	juli := h.account("juli")
	svc, err := h.reg.Service("juli")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.Vault.Root(), "obsidian.md"), []byte("written by obsidian"), 0o644); err != nil {
		t.Fatal(err)
	}
	svc.Refresh("obsidian.md")

	snap := decode[struct {
		Files []vault.FileMeta `json:"files"`
	}](t, juli.do(http.MethodGet, vaultPath("juli", "/snapshot"), nil, nil))
	var found bool
	for _, f := range snap.Files {
		if f.Path == "obsidian.md" {
			found = true
		}
	}
	if !found {
		t.Fatalf("external write missing from the manifest: %+v", snap.Files)
	}
}

func TestAttachmentsRoundTrip(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")
	png := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3}
	if resp := juli.put("juli", "img/pasted.png", png, map[string]string{"If-None-Match": "*"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("attachment upload = %d", resp.StatusCode)
	}
	get := juli.get("juli", "img/pasted.png")
	body, _ := io.ReadAll(get.Body)
	get.Body.Close()
	if !bytes.Equal(body, png) {
		t.Fatalf("attachment came back changed: %v", body)
	}
	if ct := get.Header.Get("Content-Type"); ct != "image/png" {
		t.Errorf("content type = %q, want image/png", ct)
	}
}

func TestOversizeRejected(t *testing.T) {
	h := newHarness(t)
	juli := h.account("juli")
	resp := juli.put("juli", "big.bin", make([]byte, (1<<20)+1), map[string]string{"If-None-Match": "*"})
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize upload = %d, want 413", resp.StatusCode)
	}
}
