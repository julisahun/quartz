package main

import (
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"quartz/internal/accounts"
	"quartz/internal/config"
	"quartz/internal/httpapi"
	"quartz/internal/provision"
	"quartz/internal/registry"
	"quartz/internal/service"
)

const password = "hunter2-hunter2"

// testServer is the real server stack over a temporary data directory.
type testServer struct {
	t     *testing.T
	http  *httptest.Server
	store *accounts.Store
	reg   *registry.Registry
	cfg   config.Config
}

func startServer(t *testing.T) *testServer {
	t.Helper()
	cfg := config.Config{
		DataDir:      t.TempDir(),
		SessionTTL:   time.Hour,
		MaxFileBytes: 1 << 20,
		GitEnabled:   false,
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

	srv := httptest.NewServer(httpapi.New(cfg, store, reg, log).Router())
	t.Cleanup(srv.Close)

	ts := &testServer{t: t, http: srv, store: store, reg: reg, cfg: cfg}
	ts.account("juli")
	return ts
}

// account creates a user, and a vault named after them, unless they exist already.
func (ts *testServer) account(name string) {
	ts.t.Helper()
	if exists, err := ts.store.UserExists(name); err != nil {
		ts.t.Fatal(err)
	} else if exists {
		return
	}
	if err := ts.store.CreateUser(name, password); err != nil {
		ts.t.Fatal(err)
	}
	if err := provision.NewVault(ts.store, ts.cfg, name, name, name); err != nil {
		ts.t.Fatal(err)
	}
}

func (ts *testServer) service(vaultID string) *service.Service {
	ts.t.Helper()
	svc, err := ts.reg.Service(vaultID)
	if err != nil {
		ts.t.Fatal(err)
	}
	return svc
}

// device is one synced folder: a laptop, a phone, or the CLI mirror.
type device struct {
	t   *testing.T
	dir string
	s   *syncer
}

// newDevice signs a user in and binds the folder to one of their vaults.
func newDevice(t *testing.T, ts *testServer, name string) *device {
	return newDeviceAs(t, ts, name, "juli", "")
}

func newDeviceAs(t *testing.T, ts *testServer, name, user, vaultID string) *device {
	t.Helper()
	ts.account(user)
	dir := t.TempDir()
	st, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.Server, st.User, st.Device = ts.http.URL, user, name

	cookie, vaults, err := newClient(st).login(user, password)
	if err != nil {
		t.Fatal(err)
	}
	st.Cookie = cookie
	chosen, err := chooseVault(vaults, vaultID, user)
	if err != nil {
		t.Fatal(err)
	}
	st.Vault = chosen
	if err := st.save(); err != nil {
		t.Fatal(err)
	}
	v, err := localVault(dir)
	if err != nil {
		t.Fatal(err)
	}
	return &device{t: t, dir: dir, s: &syncer{c: newClient(st), st: st, dir: dir, v: v}}
}

func (d *device) sync() syncStats {
	d.t.Helper()
	stats, err := d.s.run()
	if err != nil {
		d.t.Fatalf("%s: sync failed: %v", d.s.st.Device, err)
	}
	return stats
}

func (d *device) write(path, body string) {
	d.t.Helper()
	if _, err := d.s.v.Write(path, []byte(body)); err != nil {
		d.t.Fatal(err)
	}
}

func (d *device) read(path string) string {
	d.t.Helper()
	data, _, err := d.s.v.Read(path)
	if err != nil {
		d.t.Fatalf("%s: reading %s: %v", d.s.st.Device, path, err)
	}
	return string(data)
}

func (d *device) files() []string {
	d.t.Helper()
	metas, err := d.s.v.Scan()
	if err != nil {
		d.t.Fatal(err)
	}
	out := make([]string, 0, len(metas))
	for _, m := range metas {
		out = append(out, m.Path)
	}
	return out
}

func TestSyncRoundTripBetweenDevices(t *testing.T) {
	ts := startServer(t)
	laptop := newDevice(t, ts, "laptop")
	phone := newDevice(t, ts, "phone")

	laptop.write("notes/todo.md", "- milk\n")
	if stats := laptop.sync(); stats.Pushed != 1 {
		t.Fatalf("laptop push = %+v", stats)
	}
	if stats := phone.sync(); stats.Pulled != 1 {
		t.Fatalf("phone pull = %+v", stats)
	}
	if got := phone.read("notes/todo.md"); got != "- milk\n" {
		t.Fatalf("phone content = %q", got)
	}

	// Edit on the phone, and it comes back to the laptop.
	phone.write("notes/todo.md", "- milk\n- bread\n")
	phone.sync()
	laptop.sync()
	if got := laptop.read("notes/todo.md"); got != "- milk\n- bread\n" {
		t.Fatalf("laptop content after phone edit = %q", got)
	}
}

func TestOfflineEditsOnBothDevicesKeepBoth(t *testing.T) {
	// The plan's milestone-3 acceptance: edit the same note offline on two
	// devices, reconnect, and both versions survive with a conflict copy.
	ts := startServer(t)
	laptop := newDevice(t, ts, "laptop")
	phone := newDevice(t, ts, "phone")

	laptop.write("todo.md", "shared base\n")
	laptop.sync()
	phone.sync()

	// Both go offline and edit.
	laptop.write("todo.md", "laptop version\n")
	phone.write("todo.md", "phone version\n")

	// The laptop reconnects first and wins the race.
	if stats := laptop.sync(); stats.Pushed != 1 || stats.Conflicts != 0 {
		t.Fatalf("laptop sync = %+v", stats)
	}
	// The phone reconnects second and must not lose its edit.
	stats := phone.sync()
	if stats.Conflicts != 1 {
		t.Fatalf("phone sync = %+v, want 1 conflict", stats)
	}

	if got := phone.read("todo.md"); got != "laptop version\n" {
		t.Errorf("phone adopted %q, want the server version", got)
	}
	var conflict string
	for _, p := range phone.files() {
		if strings.Contains(p, "conflict") {
			conflict = p
		}
	}
	if conflict == "" {
		t.Fatalf("no conflict copy on the phone: %v", phone.files())
	}
	if got := phone.read(conflict); got != "phone version\n" {
		t.Errorf("conflict copy holds %q, want the phone's edit", got)
	}
	if !strings.HasPrefix(conflict, "todo (conflict phone ") || !strings.HasSuffix(conflict, ".md") {
		t.Errorf("conflict copy is named %q", conflict)
	}

	// The conflict copy reaches the other device too, so it is visible in
	// Obsidian rather than hidden on one machine.
	laptop.sync()
	if got := laptop.read(conflict); got != "phone version\n" {
		t.Errorf("laptop did not receive the conflict copy: %q", got)
	}
}

func TestDeleteSyncsAndLosesToEdit(t *testing.T) {
	ts := startServer(t)
	laptop := newDevice(t, ts, "laptop")
	phone := newDevice(t, ts, "phone")

	laptop.write("gone.md", "temporary\n")
	laptop.write("stays.md", "keep\n")
	laptop.sync()
	phone.sync()

	// A plain delete propagates.
	if err := os.Remove(filepath.Join(laptop.dir, "gone.md")); err != nil {
		t.Fatal(err)
	}
	laptop.sync()
	phone.sync()
	for _, p := range phone.files() {
		if p == "gone.md" {
			t.Fatalf("delete did not propagate: %v", phone.files())
		}
	}

	// Deletion loses to a concurrent edit (plan section 4.4).
	phone.write("stays.md", "edited on the phone\n")
	phone.sync()
	if err := os.Remove(filepath.Join(laptop.dir, "stays.md")); err != nil {
		t.Fatal(err)
	}
	stats := laptop.sync()
	if stats.Conflicts != 1 {
		t.Fatalf("laptop delete-vs-edit = %+v, want 1 conflict", stats)
	}
	if got := laptop.read("stays.md"); got != "edited on the phone\n" {
		t.Errorf("the edited file was not resurrected: %q", got)
	}
}

func TestObsidianWriteReachesDevices(t *testing.T) {
	// Something writes the vault directly, behind the server's back.
	ts := startServer(t)
	svc := ts.service("juli")
	root := svc.Vault.Root()
	laptop := newDevice(t, ts, "laptop")
	laptop.sync()

	if err := os.WriteFile(filepath.Join(root, "from-obsidian.md"), []byte("typed in obsidian\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	svc.Refresh("from-obsidian.md") // what the fsnotify watcher does

	if stats := laptop.sync(); stats.Pulled != 1 {
		t.Fatalf("laptop sync = %+v, want the external write pulled", stats)
	}
	if got := laptop.read("from-obsidian.md"); got != "typed in obsidian\n" {
		t.Errorf("content = %q", got)
	}
}

func TestSyncIsIdempotent(t *testing.T) {
	ts := startServer(t)
	laptop := newDevice(t, ts, "laptop")
	laptop.write("a.md", "one\n")
	laptop.sync()

	for i := 0; i < 3; i++ {
		stats := laptop.sync()
		if stats.Pushed+stats.Pulled+stats.Deleted+stats.Conflicts != 0 {
			t.Fatalf("repeat sync %d did work: %+v", i, stats)
		}
	}
}

func TestBootstrapAdoptsIdenticalFiles(t *testing.T) {
	// A device that already holds a copy of the vault (say, an Obsidian folder
	// synced by other means) must not produce a conflict for identical files.
	ts := startServer(t)
	laptop := newDevice(t, ts, "laptop")
	laptop.write("same.md", "identical\n")
	laptop.sync()

	desktop := newDevice(t, ts, "desktop")
	desktop.write("same.md", "identical\n")
	stats := desktop.sync()
	if stats.Conflicts != 0 {
		t.Fatalf("bootstrap produced conflicts: %+v", stats)
	}
	if len(desktop.files()) != 1 {
		t.Fatalf("desktop files = %v", desktop.files())
	}
}

func TestVaultsAreIsolatedBetweenAccounts(t *testing.T) {
	// Two people, a vault each, one server: neither mirror ever sees
	// the other's notes.
	ts := startServer(t)
	julis := newDeviceAs(t, ts, "juli-laptop", "juli", "")
	marias := newDeviceAs(t, ts, "maria-laptop", "maria", "")

	julis.write("private.md", "juli's thoughts\n")
	julis.sync()
	marias.write("private.md", "maria's thoughts\n")
	marias.sync()

	if got := julis.read("private.md"); got != "juli's thoughts\n" {
		t.Errorf("juli's mirror holds %q", got)
	}
	if got := marias.read("private.md"); got != "maria's thoughts\n" {
		t.Errorf("maria's mirror holds %q", got)
	}
	if julis.s.st.Vault == marias.s.st.Vault {
		t.Fatal("both devices bound to the same vault")
	}
	for _, p := range julis.files() {
		if strings.Contains(p, "conflict") {
			t.Errorf("juli got a conflict copy from another account: %v", julis.files())
		}
	}
}

func TestAVaultSyncsBetweenAccounts(t *testing.T) {
	ts := startServer(t)
	ts.account("maria")
	if err := provision.NewVault(ts.store, ts.cfg, "casa", "Casa", "juli"); err != nil {
		t.Fatal(err)
	}
	if err := ts.store.AddMember("casa", "maria", accounts.Member); err != nil {
		t.Fatal(err)
	}

	julis := newDeviceAs(t, ts, "juli-laptop", "juli", "casa")
	marias := newDeviceAs(t, ts, "maria-phone", "maria", "casa")

	julis.write("shopping.md", "- bread\n")
	julis.sync()
	if stats := marias.sync(); stats.Pulled != 1 {
		t.Fatalf("maria's sync = %+v", stats)
	}
	if got := marias.read("shopping.md"); got != "- bread\n" {
		t.Fatalf("maria sees %q", got)
	}

	// And an edit of hers comes back to juli.
	marias.write("shopping.md", "- bread\n- milk\n")
	marias.sync()
	julis.sync()
	if got := julis.read("shopping.md"); got != "- bread\n- milk\n" {
		t.Fatalf("juli sees %q", got)
	}
}

func TestChoosingAVault(t *testing.T) {
	vaults := []vaultInfo{
		{ID: "juli", Owner: "juli", Role: "owner"},
		{ID: "casa", Owner: "juli", Role: "owner"},
	}
	// Two vaults, both hers: there is no "the account's own" to fall back on
	// any more, and guessing would sync the wrong folder without saying so.
	if _, err := chooseVault(vaults, "", "juli"); err == nil {
		t.Error("two owned vaults were resolved without -vault")
	}
	if got, err := chooseVault(vaults, "casa", "juli"); err != nil || got != "casa" {
		t.Errorf("explicit = %q, %v", got, err)
	}
	// One of the two is hers, so there is nothing to ask about.
	mixed := []vaultInfo{
		{ID: "casa", Owner: "juli", Role: "member"},
		{ID: "marias", Owner: "maria", Role: "owner"},
	}
	if got, err := chooseVault(mixed, "", "maria"); err != nil || got != "marias" {
		t.Errorf("only one owned = %q, %v", got, err)
	}
	if _, err := chooseVault(vaults, "someone-else", "juli"); err == nil {
		t.Error("a vault the account cannot open was accepted")
	}
	// A member with only one option.
	guest := []vaultInfo{{ID: "casa", Owner: "juli", Role: "member"}}
	if got, err := chooseVault(guest, "", "maria"); err != nil || got != "casa" {
		t.Errorf("single option = %q, %v", got, err)
	}
	if _, err := chooseVault(nil, "", "nobody"); err == nil {
		t.Error("an account with no vaults was accepted")
	}
}
