package gitstore

import (
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestShowReturnsAnOlderVersion(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir, 0, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	write := func(body string) {
		if err := os.WriteFile(filepath.Join(dir, "note.md"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := s.commitNow("edit"); err != nil {
			t.Fatal(err)
		}
	}
	write("first")
	write("second")

	log, err := s.Log("note.md", 10)
	if err != nil || len(log) != 2 {
		t.Fatalf("log = %v, %v; want two entries", log, err)
	}
	oldest := strings.Fields(log[1])[0]
	got, err := s.Show(oldest, "note.md")
	if err != nil || string(got) != "first" {
		t.Fatalf("Show(%s) = %q, %v; want first", oldest, got, err)
	}

	for _, rev := range []string{"--output=/tmp/x", "HEAD", "", "zzzz"} {
		if _, err := s.Show(rev, "note.md"); !errors.Is(err, ErrNoRevision) {
			t.Errorf("Show(%q) = %v, want ErrNoRevision", rev, err)
		}
	}
	if _, err := s.Show(oldest, "missing.md"); !errors.Is(err, ErrNoRevision) {
		t.Errorf("missing path = %v, want ErrNoRevision", err)
	}
}
