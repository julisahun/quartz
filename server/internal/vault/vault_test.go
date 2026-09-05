package vault

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCleanPathRejectsTraversal(t *testing.T) {
	bad := []string{
		"", "/etc/passwd", "../outside.md", "notes/../../outside.md",
		"notes/./a.md", "notes//a.md", "notes/", "C:/notes.md",
		"notes\\a.md", "a\x00.md", ".",
	}
	for _, p := range bad {
		if _, err := CleanPath(p); err == nil {
			t.Errorf("CleanPath(%q) accepted a bad path", p)
		}
	}
	good := []string{"a.md", "notes/a.md", "notes/sub/b.png", ".obsidian/app.json", "notes/..hidden.md"}
	for _, p := range good {
		if got, err := CleanPath(p); err != nil || got != p {
			t.Errorf("CleanPath(%q) = %q, %v; want it accepted unchanged", p, got, err)
		}
	}
}

func TestIgnored(t *testing.T) {
	ignored := []string{
		".git/config", "notes/.git/x", ".obsidian/workspace.json",
		".obsidian/workspace-mobile.json", ".DS_Store", "notes/.DS_Store",
		".quartz-tmp-123", ".quartz-sync.json", ".trash/old.md",
	}
	for _, p := range ignored {
		if !Ignored(p) {
			t.Errorf("Ignored(%q) = false, want true", p)
		}
	}
	kept := []string{"a.md", ".obsidian/app.json", ".obsidian/plugins/x/main.js", "img/pic.png"}
	for _, p := range kept {
		if Ignored(p) {
			t.Errorf("Ignored(%q) = true, want false", p)
		}
	}
}

func TestSymlinkEscapeIsRejected(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("no"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	v, err := Open(root, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.Resolve("escape/secret.md"); err != ErrBadPath {
		t.Fatalf("Resolve through a symlink returned %v, want ErrBadPath", err)
	}
}

func TestWriteReadDeleteScan(t *testing.T) {
	v, err := Open(t.TempDir(), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	meta, err := v.Write("notes/hello.md", []byte("# hi"))
	if err != nil {
		t.Fatal(err)
	}
	if meta.Hash != HashBytes([]byte("# hi")) {
		t.Fatalf("hash mismatch")
	}
	data, read, err := v.Read("notes/hello.md")
	if err != nil || string(data) != "# hi" || read.Hash != meta.Hash {
		t.Fatalf("Read = %q, %+v, %v", data, read, err)
	}

	files, err := v.Scan()
	if err != nil || len(files) != 1 || files[0].Path != "notes/hello.md" {
		t.Fatalf("Scan = %+v, %v", files, err)
	}

	if err := v.Delete("notes/hello.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := v.Stat("notes/hello.md"); err != ErrNotFound {
		t.Fatalf("Stat after delete = %v", err)
	}
	// The now-empty directory should be gone too.
	if _, err := os.Stat(filepath.Join(v.Root(), "notes")); !os.IsNotExist(err) {
		t.Errorf("empty directory was left behind")
	}
}

func TestScanSkipsIgnored(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "a.md"), "a")
	mustWrite(t, filepath.Join(root, ".git", "HEAD"), "ref")
	mustWrite(t, filepath.Join(root, ".obsidian", "app.json"), "{}")
	mustWrite(t, filepath.Join(root, ".obsidian", "workspace.json"), "{}")

	v, err := Open(root, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	files, err := v.Scan()
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, f := range files {
		got[f.Path] = true
	}
	if !got["a.md"] || !got[".obsidian/app.json"] {
		t.Errorf("Scan missed synced files: %v", got)
	}
	if got[".git/HEAD"] || got[".obsidian/workspace.json"] {
		t.Errorf("Scan included ignored files: %v", got)
	}
}

func TestConflictPath(t *testing.T) {
	when := time.Date(2026, 9, 5, 14, 30, 5, 0, time.UTC)
	got := ConflictPath("notes/todo.md", "macbook", when)
	want := "notes/todo (conflict macbook 2026-09-05 143005).md"
	if got != want {
		t.Errorf("ConflictPath = %q, want %q", got, want)
	}
}

func TestWriteRejectsOversize(t *testing.T) {
	v, err := Open(t.TempDir(), 8)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.Write("big.md", make([]byte, 9)); err != ErrTooLarge {
		t.Fatalf("Write oversize = %v, want ErrTooLarge", err)
	}
}

func mustWrite(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}
