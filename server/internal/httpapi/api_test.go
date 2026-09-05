package httpapi

import (
	"bytes"
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

	"quarts/internal/auth"
	"quarts/internal/config"
	"quarts/internal/gitstore"
	"quarts/internal/index"
	"quarts/internal/service"
	"quarts/internal/vault"
)

const testPassword = "hunter2-hunter2"

type harness struct {
	t      *testing.T
	srv    *httptest.Server
	cookie string
	vault  *vault.Vault
	svc    *service.Service
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	dir := t.TempDir()
	vaultDir := filepath.Join(dir, "vault")

	hash, err := auth.HashPassword(testPassword)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		VaultDir:     vaultDir,
		IndexDB:      filepath.Join(dir, "index.sqlite"),
		User:         "juli",
		PasswordHash: hash,
		SessionTTL:   time.Hour,
		SecureCookie: false,
		MaxFileBytes: 1 << 20,
	}
	v, err := vault.Open(cfg.VaultDir, cfg.MaxFileBytes)
	if err != nil {
		t.Fatal(err)
	}
	idx, err := index.Open(cfg.IndexDB)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { idx.Close() })

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	git, err := gitstore.NewDisabled(v.Root(), log)
	if err != nil {
		t.Fatal(err)
	}
	svc := service.New(v, idx, git, log)

	srv := httptest.NewServer(New(cfg, svc, idx, log).Router())
	t.Cleanup(srv.Close)

	return &harness{t: t, srv: srv, vault: v, svc: svc}
}

func (h *harness) login(password string) *http.Response {
	h.t.Helper()
	body, _ := json.Marshal(map[string]string{"user": "juli", "password": password, "device": "test"})
	resp, err := http.Post(h.srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		h.t.Fatal(err)
	}
	for _, c := range resp.Cookies() {
		if c.Name == cookieName {
			h.cookie = c.Value
		}
	}
	return resp
}

func (h *harness) do(method, path string, body []byte, headers map[string]string) *http.Response {
	h.t.Helper()
	var r io.Reader
	if body != nil {
		r = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, h.srv.URL+path, r)
	if err != nil {
		h.t.Fatal(err)
	}
	if h.cookie != "" {
		req.AddCookie(&http.Cookie{Name: cookieName, Value: h.cookie})
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	return resp
}

func (h *harness) putFile(path string, body []byte, headers map[string]string) *http.Response {
	return h.do(http.MethodPut, "/api/file?path="+url.QueryEscape(path), body, headers)
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

func TestLoginAndSession(t *testing.T) {
	h := newHarness(t)

	if resp := h.do(http.MethodGet, "/api/snapshot", nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated snapshot = %d, want 401", resp.StatusCode)
	}

	bad := h.login("wrong password")
	if bad.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bad login = %d, want 401", bad.StatusCode)
	}
	if h.cookie != "" {
		t.Fatal("a failed login handed out a cookie")
	}

	ok := h.login(testPassword)
	if ok.StatusCode != http.StatusOK || h.cookie == "" {
		t.Fatalf("login = %d, cookie %q", ok.StatusCode, h.cookie)
	}
	for _, c := range ok.Cookies() {
		if c.Name == cookieName && (!c.HttpOnly || c.SameSite != http.SameSiteLaxMode) {
			t.Errorf("session cookie is not HttpOnly/Lax: %+v", c)
		}
	}
	if resp := h.do(http.MethodGet, "/auth/session", nil, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("session check = %d", resp.StatusCode)
	}
}

func TestUnauthorizedBodyIsMachineReadable(t *testing.T) {
	// A 401 mid-sync must be recognisable so the client can prompt for a
	// re-login instead of discarding its queue (plan section 4.3).
	h := newHarness(t)
	resp := h.do(http.MethodGet, "/api/changes?since=0", nil, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	body := decode[errorBody](t, resp)
	if body.Code != "no_session" {
		t.Fatalf("error code = %q, want no_session", body.Code)
	}
}

func TestLoginRateLimited(t *testing.T) {
	h := newHarness(t)
	var last *http.Response
	for i := 0; i < 12; i++ {
		last = h.login("wrong")
	}
	if last.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("after 12 bad logins status = %d, want 429", last.StatusCode)
	}
}

func TestFileLifecycleAndPreconditions(t *testing.T) {
	h := newHarness(t)
	h.login(testPassword)

	// A write with no precondition is refused outright.
	if resp := h.putFile("a.md", []byte("x"), nil); resp.StatusCode != http.StatusPreconditionRequired {
		t.Fatalf("unconditional PUT = %d, want 428", resp.StatusCode)
	}

	create := h.putFile("notes/a.md", []byte("# one"), map[string]string{"If-None-Match": "*"})
	if create.StatusCode != http.StatusOK {
		t.Fatalf("create = %d", create.StatusCode)
	}
	meta := decode[vault.FileMeta](t, create)
	if meta.Hash != vault.HashBytes([]byte("# one")) {
		t.Fatalf("returned hash does not match the body")
	}

	// Creating the same path again must fail rather than clobber.
	if resp := h.putFile("notes/a.md", []byte("# clobber"), map[string]string{"If-None-Match": "*"}); resp.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("duplicate create = %d, want 412", resp.StatusCode)
	}

	get := h.do(http.MethodGet, "/api/file?path=notes%2Fa.md", nil, nil)
	if get.StatusCode != http.StatusOK {
		t.Fatalf("get = %d", get.StatusCode)
	}
	body, _ := io.ReadAll(get.Body)
	get.Body.Close()
	if string(body) != "# one" {
		t.Fatalf("content = %q", body)
	}
	if get.Header.Get("ETag") != `"`+meta.Hash+`"` {
		t.Fatalf("ETag = %q", get.Header.Get("ETag"))
	}

	// Stale If-Match loses, and the response carries the current hash so the
	// client can write a conflict copy without another round trip.
	stale := h.putFile("notes/a.md", []byte("# two"), map[string]string{"If-Match": `"deadbeef"`})
	if stale.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("stale write = %d, want 412", stale.StatusCode)
	}
	if stale.Header.Get("ETag") != `"`+meta.Hash+`"` {
		t.Errorf("412 did not carry the current ETag: %q", stale.Header.Get("ETag"))
	}

	update := h.putFile("notes/a.md", []byte("# two"), map[string]string{"If-Match": `"` + meta.Hash + `"`})
	if update.StatusCode != http.StatusOK {
		t.Fatalf("update = %d", update.StatusCode)
	}
	updated := decode[vault.FileMeta](t, update)

	// Delete needs the current hash too.
	if resp := h.do(http.MethodDelete, "/api/file?path=notes%2Fa.md", nil, map[string]string{"If-Match": `"stale"`}); resp.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("stale delete = %d, want 412", resp.StatusCode)
	}
	if resp := h.do(http.MethodDelete, "/api/file?path=notes%2Fa.md", nil, map[string]string{"If-Match": `"` + updated.Hash + `"`}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", resp.StatusCode)
	}
	if resp := h.do(http.MethodGet, "/api/file?path=notes%2Fa.md", nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("get after delete = %d", resp.StatusCode)
	}
}

func TestPathTraversalRejected(t *testing.T) {
	h := newHarness(t)
	h.login(testPassword)
	for _, p := range []string{"../escape.md", "/etc/passwd", "a/../../b.md"} {
		resp := h.putFile(p, []byte("no"), map[string]string{"If-None-Match": "*"})
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("PUT %q = %d, want 400", p, resp.StatusCode)
		}
	}
	if resp := h.putFile(".git/config", []byte("no"), map[string]string{"If-None-Match": "*"}); resp.StatusCode != http.StatusForbidden {
		t.Errorf("PUT into .git = %d, want 403", resp.StatusCode)
	}
}

func TestSnapshotChangesAndSearch(t *testing.T) {
	h := newHarness(t)
	h.login(testPassword)

	h.putFile("a.md", []byte("the pi runs cloudflared"), map[string]string{"If-None-Match": "*"})
	h.putFile("b.md", []byte("shopping list"), map[string]string{"If-None-Match": "*"})

	snap := decode[struct {
		Head  int64            `json:"head"`
		Files []vault.FileMeta `json:"files"`
	}](t, h.do(http.MethodGet, "/api/snapshot", nil, nil))
	if len(snap.Files) != 2 || snap.Head != 2 {
		t.Fatalf("snapshot = %+v", snap)
	}

	page := decode[struct {
		Head    int64          `json:"head"`
		Changes []index.Change `json:"changes"`
		More    bool           `json:"more"`
	}](t, h.do(http.MethodGet, "/api/changes?since=1", nil, nil))
	if len(page.Changes) != 1 || page.Changes[0].Path != "b.md" || page.More {
		t.Fatalf("changes = %+v", page)
	}

	hits := decode[struct {
		Hits []index.SearchHit `json:"hits"`
	}](t, h.do(http.MethodGet, "/api/search?q=cloudflared", nil, nil))
	if len(hits.Hits) != 1 || hits.Hits[0].Path != "a.md" {
		t.Fatalf("search = %+v", hits.Hits)
	}
}

func TestExternalWriteIsJournalled(t *testing.T) {
	// Obsidian writing the vault directly: the file never goes through the API,
	// but a Refresh must journal it (plan section 6).
	h := newHarness(t)
	h.login(testPassword)

	path := filepath.Join(h.vault.Root(), "obsidian.md")
	if err := os.WriteFile(path, []byte("written by obsidian"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.svc.Refresh("obsidian.md")

	snap := decode[struct {
		Files []vault.FileMeta `json:"files"`
	}](t, h.do(http.MethodGet, "/api/snapshot", nil, nil))
	found := false
	for _, f := range snap.Files {
		if f.Path == "obsidian.md" {
			found = true
		}
	}
	if !found {
		t.Fatalf("external write missing from the manifest: %+v", snap.Files)
	}
	hits := decode[struct {
		Hits []index.SearchHit `json:"hits"`
	}](t, h.do(http.MethodGet, "/api/search?q=obsidian", nil, nil))
	if len(hits.Hits) != 1 {
		t.Errorf("external write was not indexed for search: %+v", hits.Hits)
	}
}

func TestAttachmentsRoundTrip(t *testing.T) {
	h := newHarness(t)
	h.login(testPassword)

	png := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3}
	if resp := h.putFile("img/pasted.png", png, map[string]string{"If-None-Match": "*"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("attachment upload = %d", resp.StatusCode)
	}
	get := h.do(http.MethodGet, "/api/file?path=img%2Fpasted.png", nil, nil)
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
	h.login(testPassword)
	resp := h.putFile("big.bin", make([]byte, (1<<20)+1), map[string]string{"If-None-Match": "*"})
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize upload = %d, want 413", resp.StatusCode)
	}
}
