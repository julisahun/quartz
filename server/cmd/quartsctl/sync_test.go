package main

import (
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"quarts/internal/auth"
	"quarts/internal/config"
	"quarts/internal/gitstore"
	"quarts/internal/httpapi"
	"quarts/internal/index"
	"quarts/internal/service"
	"quarts/internal/vault"
)

const password = "hunter2-hunter2"

// startServer boots the real server stack against a temporary vault.
func startServer(t *testing.T) (*httptest.Server, *service.Service, string) {
	t.Helper()
	dir := t.TempDir()
	vaultDir := filepath.Join(dir, "vault")

	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		VaultDir:     vaultDir,
		IndexDB:      filepath.Join(dir, "index.sqlite"),
		User:         "juli",
		PasswordHash: hash,
		SessionTTL:   time.Hour,
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
	srv := httptest.NewServer(httpapi.New(cfg, svc, idx, log).Router())
	t.Cleanup(srv.Close)
	return srv, svc, v.Root()
}

// device is one synced folder: a laptop, a phone, or the CLI mirror.
type device struct {
	t   *testing.T
	dir string
	s   *syncer
}

func newDevice(t *testing.T, srv *httptest.Server, name string) *device {
	t.Helper()
	dir := t.TempDir()
	st, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.Server, st.User, st.Device = srv.URL, "juli", name

	cookie, err := newClient(st).login("juli", password)
	if err != nil {
		t.Fatal(err)
	}
	st.Cookie = cookie
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
	srv, _, _ := startServer(t)
	laptop := newDevice(t, srv, "laptop")
	phone := newDevice(t, srv, "phone")

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
	srv, _, _ := startServer(t)
	laptop := newDevice(t, srv, "laptop")
	phone := newDevice(t, srv, "phone")

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
	srv, _, _ := startServer(t)
	laptop := newDevice(t, srv, "laptop")
	phone := newDevice(t, srv, "phone")

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
	srv, svc, root := startServer(t)
	laptop := newDevice(t, srv, "laptop")
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
	srv, _, _ := startServer(t)
	laptop := newDevice(t, srv, "laptop")
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
	srv, _, _ := startServer(t)
	laptop := newDevice(t, srv, "laptop")
	laptop.write("same.md", "identical\n")
	laptop.sync()

	desktop := newDevice(t, srv, "desktop")
	desktop.write("same.md", "identical\n")
	stats := desktop.sync()
	if stats.Conflicts != 0 {
		t.Fatalf("bootstrap produced conflicts: %+v", stats)
	}
	if len(desktop.files()) != 1 {
		t.Fatalf("desktop files = %v", desktop.files())
	}
}
