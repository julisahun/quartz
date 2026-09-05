// Package index maintains the change journal and search index.
//
// This SQLite database is an *index*, never the source of truth: deleting it
// and rescanning the vault must produce an equivalent state (plan section 4.2).
// The only rows that are not derivable from the vault are sessions, and losing
// those merely forces a re-login.
package index

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"quartz/internal/vault"

	_ "modernc.org/sqlite"
)

type Op string

const (
	OpPut Op = "put"
	OpDel Op = "del"
)

type Change struct {
	Seq     int64  `json:"seq"`
	Path    string `json:"path"`
	Op      Op     `json:"op"`
	Hash    string `json:"hash,omitempty"`
	Size    int64  `json:"size,omitempty"`
	ModTime int64  `json:"mtime,omitempty"`
	TS      int64  `json:"ts"`
}

type SearchHit struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
}

type Index struct {
	db    *sql.DB
	epoch string
	mu    sync.Mutex // serialises writers; SQLite allows only one anyway
}

func Open(dbPath string) (*Index, error) {
	if dir := filepath.Dir(dbPath); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(1)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // one writer, tiny workload; avoids SQLITE_BUSY entirely
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	ix := &Index{db: db}
	if err := ix.loadEpoch(); err != nil {
		db.Close()
		return nil, err
	}
	return ix, nil
}

// loadEpoch reads (or mints) the journal epoch: an id for this particular
// database. Rebuilding the index restarts the sequence numbers, which would
// silently make every client's cursor point at the wrong place — so clients
// compare epochs and fall back to the manifest when it changes.
func (ix *Index) loadEpoch() error {
	err := ix.db.QueryRow(`SELECT value FROM meta WHERE key = 'epoch'`).Scan(&ix.epoch)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return err
	}
	ix.epoch = hex.EncodeToString(buf)
	_, err = ix.db.Exec(`INSERT INTO meta (key, value) VALUES ('epoch', ?)`, ix.epoch)
	return err
}

// Epoch identifies this index. A client seeing a new one re-reads the manifest.
func (ix *Index) Epoch() string { return ix.epoch }

func (ix *Index) Close() error { return ix.db.Close() }

// Head returns the newest sequence number: the client's sync cursor target.
func (ix *Index) Head() (int64, error) {
	var head sql.NullInt64
	if err := ix.db.QueryRow(`SELECT MAX(seq) FROM changes`).Scan(&head); err != nil {
		return 0, err
	}
	return head.Int64, nil
}

// Snapshot returns the full manifest, used for a first sync or a reconciliation.
func (ix *Index) Snapshot() ([]vault.FileMeta, error) {
	rows, err := ix.db.Query(`SELECT path, hash, size, mtime FROM files ORDER BY path`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []vault.FileMeta{}
	for rows.Next() {
		var m vault.FileMeta
		if err := rows.Scan(&m.Path, &m.Hash, &m.Size, &m.ModTime); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (ix *Index) FileMeta(p string) (vault.FileMeta, bool, error) {
	var m vault.FileMeta
	err := ix.db.QueryRow(`SELECT path, hash, size, mtime FROM files WHERE path = ?`, p).
		Scan(&m.Path, &m.Hash, &m.Size, &m.ModTime)
	if errors.Is(err, sql.ErrNoRows) {
		return vault.FileMeta{}, false, nil
	}
	if err != nil {
		return vault.FileMeta{}, false, err
	}
	return m, true, nil
}

// Changes returns journal entries after the given cursor, plus the head seq.
func (ix *Index) Changes(since int64, limit int) ([]Change, int64, error) {
	if limit <= 0 || limit > 5000 {
		limit = 5000
	}
	rows, err := ix.db.Query(
		`SELECT seq, path, op, hash, size, mtime, ts FROM changes WHERE seq > ? ORDER BY seq LIMIT ?`,
		since, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Change{}
	for rows.Next() {
		var c Change
		if err := rows.Scan(&c.Seq, &c.Path, &c.Op, &c.Hash, &c.Size, &c.ModTime, &c.TS); err != nil {
			return nil, 0, err
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	head, err := ix.Head()
	if err != nil {
		return nil, 0, err
	}
	return out, head, nil
}

// RecordPut journals a create/update. It is idempotent: if the manifest already
// holds this hash, nothing is written and ok is false. That is what keeps the
// server's own writes from being double-journalled when fsnotify sees them.
func (ix *Index) RecordPut(m vault.FileMeta, body []byte) (Change, bool, error) {
	ix.mu.Lock()
	defer ix.mu.Unlock()

	var existing string
	err := ix.db.QueryRow(`SELECT hash FROM files WHERE path = ?`, m.Path).Scan(&existing)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Change{}, false, err
	}
	if existing == m.Hash {
		return Change{}, false, nil
	}

	tx, err := ix.db.Begin()
	if err != nil {
		return Change{}, false, err
	}
	defer tx.Rollback()

	ts := time.Now().UnixMilli()
	res, err := tx.Exec(
		`INSERT INTO changes (path, op, hash, mtime, size, ts) VALUES (?, 'put', ?, ?, ?, ?)`,
		m.Path, m.Hash, m.ModTime, m.Size, ts)
	if err != nil {
		return Change{}, false, err
	}
	seq, err := res.LastInsertId()
	if err != nil {
		return Change{}, false, err
	}
	if _, err := tx.Exec(
		`INSERT INTO files (path, hash, mtime, size) VALUES (?, ?, ?, ?)
		 ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, mtime = excluded.mtime, size = excluded.size`,
		m.Path, m.Hash, m.ModTime, m.Size); err != nil {
		return Change{}, false, err
	}
	if err := reindexNote(tx, m.Path, body); err != nil {
		return Change{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return Change{}, false, err
	}
	return Change{Seq: seq, Path: m.Path, Op: OpPut, Hash: m.Hash, Size: m.Size, ModTime: m.ModTime, TS: ts}, true, nil
}

// RecordDelete journals a removal. Idempotent in the same way as RecordPut.
func (ix *Index) RecordDelete(p string) (Change, bool, error) {
	ix.mu.Lock()
	defer ix.mu.Unlock()

	var existing string
	err := ix.db.QueryRow(`SELECT hash FROM files WHERE path = ?`, p).Scan(&existing)
	if errors.Is(err, sql.ErrNoRows) {
		return Change{}, false, nil
	}
	if err != nil {
		return Change{}, false, err
	}

	tx, err := ix.db.Begin()
	if err != nil {
		return Change{}, false, err
	}
	defer tx.Rollback()

	ts := time.Now().UnixMilli()
	res, err := tx.Exec(`INSERT INTO changes (path, op, ts) VALUES (?, 'del', ?)`, p, ts)
	if err != nil {
		return Change{}, false, err
	}
	seq, err := res.LastInsertId()
	if err != nil {
		return Change{}, false, err
	}
	if _, err := tx.Exec(`DELETE FROM files WHERE path = ?`, p); err != nil {
		return Change{}, false, err
	}
	if _, err := tx.Exec(`DELETE FROM notes_fts WHERE path = ?`, p); err != nil {
		return Change{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return Change{}, false, err
	}
	return Change{Seq: seq, Path: p, Op: OpDel, TS: ts}, true, nil
}

func reindexNote(tx *sql.Tx, p string, body []byte) error {
	if _, err := tx.Exec(`DELETE FROM notes_fts WHERE path = ?`, p); err != nil {
		return err
	}
	if !vault.IsMarkdown(p) || body == nil {
		return nil
	}
	_, err := tx.Exec(`INSERT INTO notes_fts (path, title, body) VALUES (?, ?, ?)`,
		p, NoteTitle(p), string(body))
	return err
}

// NoteTitle is the display name of a note: its filename without extension.
func NoteTitle(p string) string {
	base := path.Base(p)
	return strings.TrimSuffix(base, path.Ext(base))
}

// Search runs an FTS5 query. The user types plain words, so the query is
// escaped into quoted terms with a prefix match on the last one — typing
// "meet" should find "meeting" before you finish the word.
func (ix *Index) Search(q string, limit int) ([]SearchHit, error) {
	match := ftsQuery(q)
	if match == "" {
		return []SearchHit{}, nil
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := ix.db.Query(`
		SELECT path, title, snippet(notes_fts, 2, '<mark>', '</mark>', '…', 12)
		FROM notes_fts
		WHERE notes_fts MATCH ?
		ORDER BY bm25(notes_fts, 0.0, 8.0, 1.0)
		LIMIT ?`, match, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SearchHit{}
	for rows.Next() {
		var h SearchHit
		if err := rows.Scan(&h.Path, &h.Title, &h.Snippet); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

func ftsQuery(q string) string {
	fields := strings.Fields(q)
	terms := make([]string, 0, len(fields))
	for i, f := range fields {
		f = strings.ReplaceAll(f, `"`, "")
		f = strings.TrimFunc(f, func(r rune) bool {
			return strings.ContainsRune("*^:(){}[]", r)
		})
		if f == "" {
			continue
		}
		term := `"` + f + `"`
		if i == len(fields)-1 {
			term += "*" // prefix-match the word still being typed
		}
		terms = append(terms, term)
	}
	return strings.Join(terms, " AND ")
}

// Reconcile brings the index in line with what is actually on disk. It runs at
// startup (catching everything written while the server was down, by Obsidian
// or anyone else) and after a rebuild.
func (ix *Index) Reconcile(files []vault.FileMeta, read func(string) ([]byte, error)) (int, error) {
	onDisk := make(map[string]vault.FileMeta, len(files))
	for _, f := range files {
		onDisk[f.Path] = f
	}
	known, err := ix.Snapshot()
	if err != nil {
		return 0, err
	}
	n := 0
	for _, k := range known {
		if _, still := onDisk[k.Path]; !still {
			if _, ok, err := ix.RecordDelete(k.Path); err != nil {
				return n, err
			} else if ok {
				n++
			}
		}
	}
	for _, f := range files {
		var body []byte
		if vault.IsMarkdown(f.Path) {
			if b, err := read(f.Path); err == nil {
				body = b
			}
		}
		if _, ok, err := ix.RecordPut(f, body); err != nil {
			return n, err
		} else if ok {
			n++
		}
	}
	return n, nil
}
