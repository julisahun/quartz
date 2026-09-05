package index

import (
	"path/filepath"
	"testing"

	"quartz/internal/vault"
)

func openTestIndex(t *testing.T) *Index {
	t.Helper()
	ix, err := Open(filepath.Join(t.TempDir(), "index.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ix.Close() })
	return ix
}

func put(t *testing.T, ix *Index, path, body string) Change {
	t.Helper()
	meta := vault.FileMeta{Path: path, Hash: vault.HashBytes([]byte(body)), Size: int64(len(body)), ModTime: 1}
	ch, ok, err := ix.RecordPut(meta, []byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatalf("RecordPut(%q) was a no-op", path)
	}
	return ch
}

func TestJournalSequenceAndSnapshot(t *testing.T) {
	ix := openTestIndex(t)
	put(t, ix, "a.md", "alpha")
	put(t, ix, "b.md", "beta")

	changes, head, err := ix.Changes(0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 2 || changes[0].Seq != 1 || changes[1].Seq != 2 || head != 2 {
		t.Fatalf("Changes = %+v, head %d", changes, head)
	}

	later, _, err := ix.Changes(1, 0)
	if err != nil || len(later) != 1 || later[0].Path != "b.md" {
		t.Fatalf("Changes(since=1) = %+v, %v", later, err)
	}

	snap, err := ix.Snapshot()
	if err != nil || len(snap) != 2 {
		t.Fatalf("Snapshot = %+v, %v", snap, err)
	}
}

func TestRecordPutIsIdempotent(t *testing.T) {
	ix := openTestIndex(t)
	put(t, ix, "a.md", "alpha")

	// The same bytes again — this is the server's own write coming back via
	// fsnotify, and must not produce a second journal entry.
	meta := vault.FileMeta{Path: "a.md", Hash: vault.HashBytes([]byte("alpha")), Size: 5, ModTime: 2}
	if _, ok, err := ix.RecordPut(meta, []byte("alpha")); err != nil || ok {
		t.Fatalf("duplicate RecordPut recorded a change (ok=%v, err=%v)", ok, err)
	}
	if head, _ := ix.Head(); head != 1 {
		t.Fatalf("head = %d, want 1", head)
	}
}

func TestDeleteRemovesFromManifestAndSearch(t *testing.T) {
	ix := openTestIndex(t)
	put(t, ix, "a.md", "alpha content")

	if _, ok, err := ix.RecordDelete("a.md"); err != nil || !ok {
		t.Fatalf("RecordDelete = %v, %v", ok, err)
	}
	if snap, _ := ix.Snapshot(); len(snap) != 0 {
		t.Fatalf("manifest still holds %+v", snap)
	}
	if hits, _ := ix.Search("alpha", 0); len(hits) != 0 {
		t.Fatalf("search still returns %+v", hits)
	}
	// Deleting again is a no-op, not an error.
	if _, ok, err := ix.RecordDelete("a.md"); err != nil || ok {
		t.Fatalf("second RecordDelete = %v, %v", ok, err)
	}
}

func TestSearch(t *testing.T) {
	ix := openTestIndex(t)
	put(t, ix, "notes/pi.md", "The Raspberry Pi runs cloudflared and the tunnel")
	put(t, ix, "notes/food.md", "arroz con leche receta")
	put(t, ix, "img/pic.png", "not markdown, must not be indexed")

	hits, err := ix.Search("cloudflared", 0)
	if err != nil || len(hits) != 1 || hits[0].Path != "notes/pi.md" {
		t.Fatalf("Search(cloudflared) = %+v, %v", hits, err)
	}
	if hits[0].Snippet == "" {
		t.Errorf("expected a snippet, got none")
	}

	// Prefix matching on the word still being typed.
	if hits, _ := ix.Search("tunn", 0); len(hits) != 1 {
		t.Errorf("prefix search returned %+v", hits)
	}
	// Diacritics folded: "receta" should be findable as typed either way.
	if hits, _ := ix.Search("leche", 0); len(hits) != 1 {
		t.Errorf("accent-folded search returned %+v", hits)
	}
	// Title matches count, and binaries never appear.
	if hits, _ := ix.Search("pic", 0); len(hits) != 0 {
		t.Errorf("binary file was indexed: %+v", hits)
	}
	// A query of only punctuation must not explode.
	if hits, err := ix.Search("*()", 0); err != nil || len(hits) != 0 {
		t.Errorf("junk query = %+v, %v", hits, err)
	}
}

func TestReconcileCatchesOfflineChanges(t *testing.T) {
	ix := openTestIndex(t)
	put(t, ix, "a.md", "alpha")
	put(t, ix, "gone.md", "bye")

	// What the disk looks like after Obsidian edited one file and deleted
	// another while the server was down.
	files := []vault.FileMeta{
		{Path: "a.md", Hash: vault.HashBytes([]byte("alpha edited")), Size: 12, ModTime: 9},
		{Path: "new.md", Hash: vault.HashBytes([]byte("fresh")), Size: 5, ModTime: 9},
	}
	bodies := map[string]string{"a.md": "alpha edited", "new.md": "fresh"}
	n, err := ix.Reconcile(files, func(p string) ([]byte, error) { return []byte(bodies[p]), nil })
	if err != nil || n != 3 {
		t.Fatalf("Reconcile = %d, %v; want 3 changes", n, err)
	}
	snap, _ := ix.Snapshot()
	if len(snap) != 2 {
		t.Fatalf("manifest = %+v", snap)
	}
	if hits, _ := ix.Search("fresh", 0); len(hits) != 1 {
		t.Errorf("new file was not indexed for search")
	}
}

func TestEpochIsStableButNewPerDatabase(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "index.sqlite")

	first, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	epoch := first.Epoch()
	if epoch == "" {
		t.Fatal("no epoch was minted")
	}
	first.Close()

	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Epoch() != epoch {
		t.Errorf("epoch changed on reopen: %q then %q", epoch, reopened.Epoch())
	}
	reopened.Close()

	// A rebuilt index is a different journal, and must say so.
	if err := removeAll(path); err != nil {
		t.Fatal(err)
	}
	rebuilt, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer rebuilt.Close()
	if rebuilt.Epoch() == epoch {
		t.Error("a rebuilt index kept the old epoch, so clients cannot notice")
	}
}

func TestSessions(t *testing.T) {
	ix := openTestIndex(t)
	if err := ix.CreateSession("hash1", "macbook", 3600e9); err != nil {
		t.Fatal(err)
	}
	if s, ok, err := ix.LookupSession("hash1"); err != nil || !ok || s.Device != "macbook" {
		t.Fatalf("LookupSession = %+v, %v, %v", s, ok, err)
	}
	if _, ok, _ := ix.LookupSession("nope"); ok {
		t.Fatal("unknown token was accepted")
	}
	if err := ix.DeleteSession("hash1"); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := ix.LookupSession("hash1"); ok {
		t.Fatal("deleted session still resolves")
	}
}

func TestIndexIsRebuildable(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "index.sqlite")
	ix, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	put(t, ix, "a.md", "alpha")
	ix.Close()

	// Delete the index entirely and rebuild from a scan: the manifest must
	// come back (sequence numbers restart, which clients handle via snapshot).
	if err := removeAll(path); err != nil {
		t.Fatal(err)
	}
	rebuilt, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer rebuilt.Close()
	files := []vault.FileMeta{{Path: "a.md", Hash: vault.HashBytes([]byte("alpha")), Size: 5, ModTime: 1}}
	if _, err := rebuilt.Reconcile(files, func(string) ([]byte, error) { return []byte("alpha"), nil }); err != nil {
		t.Fatal(err)
	}
	snap, _ := rebuilt.Snapshot()
	if len(snap) != 1 || snap[0].Path != "a.md" {
		t.Fatalf("rebuilt manifest = %+v", snap)
	}
}
