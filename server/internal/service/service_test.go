package service

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"quarts/internal/gitstore"
	"quarts/internal/index"
	"quarts/internal/vault"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	dir := t.TempDir()
	v, err := vault.Open(filepath.Join(dir, "vault"), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	idx, err := index.Open(filepath.Join(dir, "index.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { idx.Close() })

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if os.Getenv("QUARTS_TEST_LOG") != "" {
		log = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
	}
	git, err := gitstore.New(v.Root(), 100*time.Millisecond, log)
	if err != nil {
		t.Skipf("git unavailable: %v", err)
	}
	t.Cleanup(func() { git.Close() })
	return New(v, idx, git, log)
}

// waitFor polls until cond holds, so the test tracks the watcher's own
// debounce rather than a fixed sleep.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func (s *Service) hasPath(p string) bool {
	_, ok, err := s.Index.FileMeta(p)
	return err == nil && ok
}

func TestWatcherJournalsExternalWrites(t *testing.T) {
	// The two-writer problem: Obsidian writes the vault directly and the
	// server must notice without being told (plan section 6).
	svc := newTestService(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.Start(ctx); err != nil {
		t.Fatal(err)
	}

	notes := filepath.Join(svc.Vault.Root(), "notes")
	if err := os.MkdirAll(notes, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(notes, "external.md"), []byte("typed in obsidian"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the external write to be journalled", func() bool { return svc.hasPath("notes/external.md") })

	// An external delete is journalled too.
	if err := os.Remove(filepath.Join(notes, "external.md")); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the external delete to be journalled", func() bool { return !svc.hasPath("notes/external.md") })
}

func TestWatcherIgnoresNoise(t *testing.T) {
	svc := newTestService(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.Start(ctx); err != nil {
		t.Fatal(err)
	}

	obsidian := filepath.Join(svc.Vault.Root(), ".obsidian")
	if err := os.MkdirAll(obsidian, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(obsidian, "workspace.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(obsidian, "app.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the settings file to be journalled", func() bool { return svc.hasPath(".obsidian/app.json") })
	if svc.hasPath(".obsidian/workspace.json") {
		t.Error("per-device workspace file was journalled")
	}
}

func TestVaultChangesAreCommitted(t *testing.T) {
	// The milestone-1 acceptance: a change lands in the vault and in git log.
	svc := newTestService(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.Start(ctx); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Write("note.md", []byte("# hello"), "", true); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the commit", func() bool {
		entries, err := svc.Git.Log("note.md", 5)
		return err == nil && len(entries) > 0
	})

	entries, err := svc.Git.Log("", 10)
	if err != nil || len(entries) == 0 {
		t.Fatalf("git log = %v, %v", entries, err)
	}
	if !strings.Contains(entries[0], "quarts:") {
		t.Errorf("unexpected commit subject: %q", entries[0])
	}

	// A deleted note stays recoverable from history — the M0 acceptance.
	meta, err := svc.Vault.Stat("note.md")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete("note.md", meta.Hash); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the delete commit", func() bool {
		entries, err := svc.Git.Log("note.md", 5)
		return err == nil && len(entries) >= 2
	})
}

func TestReconcileOnStartupCatchesOfflineEdits(t *testing.T) {
	svc := newTestService(t)

	// Something wrote the vault while the server was not running.
	if err := os.WriteFile(filepath.Join(svc.Vault.Root(), "offline.md"), []byte("written while down"), 0o644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.Start(ctx); err != nil {
		t.Fatal(err)
	}
	if !svc.hasPath("offline.md") {
		t.Fatal("startup reconciliation missed a file written while the server was down")
	}
}

func TestWriteRejectsStalePrecondition(t *testing.T) {
	svc := newTestService(t)
	if _, err := svc.Write("a.md", []byte("one"), "", true); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Write("a.md", []byte("two"), "", true); err != vault.ErrConflict {
		t.Fatalf("re-create = %v, want ErrConflict", err)
	}
	if _, err := svc.Write("a.md", []byte("two"), "stale", false); err != vault.ErrConflict {
		t.Fatalf("stale update = %v, want ErrConflict", err)
	}
	meta, _ := svc.Vault.Stat("a.md")
	if _, err := svc.Write("a.md", []byte("two"), meta.Hash, false); err != nil {
		t.Fatalf("current update = %v", err)
	}
}
