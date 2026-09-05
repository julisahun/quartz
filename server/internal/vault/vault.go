// Package vault owns the store of record: plain files on disk under a single
// root directory. Every read and write in the server goes through here so the
// path rules in path.go cannot be bypassed.
package vault

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type FileMeta struct {
	Path    string `json:"path"`
	Hash    string `json:"hash"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"mtime"` // unix milliseconds
}

type Vault struct {
	root     string
	maxBytes int64
}

func Open(root string, maxBytes int64) (*Vault, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	// Resolve the root once so symlink checks below compare like with like.
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return nil, err
	}
	if maxBytes <= 0 {
		maxBytes = 64 << 20
	}
	return &Vault{root: resolved, maxBytes: maxBytes}, nil
}

func (v *Vault) Root() string { return v.root }

// Resolve turns a vault-relative path into an absolute one, confirming that
// after symlink resolution the target still lives under the vault root.
func (v *Vault) Resolve(p string) (string, error) {
	clean, err := CleanPath(p)
	if err != nil {
		return "", err
	}
	if Ignored(clean) {
		return "", ErrIgnored
	}
	abs := filepath.Join(v.root, filepath.FromSlash(clean))

	// The file itself may not exist yet, so walk up to the nearest existing
	// ancestor and resolve that.
	probe := abs
	for {
		resolved, err := filepath.EvalSymlinks(probe)
		if err == nil {
			if !underRoot(v.root, resolved) {
				return "", ErrBadPath
			}
			break
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(probe)
		if parent == probe {
			return "", ErrBadPath
		}
		probe = parent
	}
	return abs, nil
}

func underRoot(root, p string) bool {
	if p == root {
		return true
	}
	return strings.HasPrefix(p, root+string(os.PathSeparator))
}

// RelPath turns an absolute path (as reported by the watcher) back into a
// vault-relative one.
func (v *Vault) RelPath(abs string) (string, error) {
	rel, err := filepath.Rel(v.root, abs)
	if err != nil {
		return "", err
	}
	rel = filepath.ToSlash(rel)
	if strings.HasPrefix(rel, "..") {
		return "", ErrBadPath
	}
	return rel, nil
}

func (v *Vault) Stat(p string) (FileMeta, error) {
	abs, err := v.Resolve(p)
	if err != nil {
		return FileMeta{}, err
	}
	return v.statAbs(abs, p)
}

func (v *Vault) statAbs(abs, rel string) (FileMeta, error) {
	fi, err := os.Stat(abs)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return FileMeta{}, ErrNotFound
		}
		return FileMeta{}, err
	}
	if fi.IsDir() {
		return FileMeta{}, ErrNotFound
	}
	hash, err := hashFile(abs)
	if err != nil {
		return FileMeta{}, err
	}
	return FileMeta{
		Path:    rel,
		Hash:    hash,
		Size:    fi.Size(),
		ModTime: fi.ModTime().UnixMilli(),
	}, nil
}

func (v *Vault) Read(p string) ([]byte, FileMeta, error) {
	abs, err := v.Resolve(p)
	if err != nil {
		return nil, FileMeta{}, err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, FileMeta{}, ErrNotFound
		}
		return nil, FileMeta{}, err
	}
	fi, err := os.Stat(abs)
	if err != nil {
		return nil, FileMeta{}, err
	}
	clean, _ := CleanPath(p)
	return data, FileMeta{
		Path:    clean,
		Hash:    HashBytes(data),
		Size:    fi.Size(),
		ModTime: fi.ModTime().UnixMilli(),
	}, nil
}

// Write replaces a file atomically (temp file in the same directory, then
// rename) so a reader — Obsidian included — never sees a half-written note.
func (v *Vault) Write(p string, data []byte) (FileMeta, error) {
	if int64(len(data)) > v.maxBytes {
		return FileMeta{}, ErrTooLarge
	}
	abs, err := v.Resolve(p)
	if err != nil {
		return FileMeta{}, err
	}
	dir := filepath.Dir(abs)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return FileMeta{}, err
	}
	tmp, err := os.CreateTemp(dir, ".quarts-tmp-*")
	if err != nil {
		return FileMeta{}, err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return FileMeta{}, err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return FileMeta{}, err
	}
	if err := tmp.Close(); err != nil {
		return FileMeta{}, err
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		return FileMeta{}, err
	}
	if err := os.Rename(tmpName, abs); err != nil {
		return FileMeta{}, err
	}
	clean, _ := CleanPath(p)
	fi, err := os.Stat(abs)
	if err != nil {
		return FileMeta{}, err
	}
	return FileMeta{
		Path:    clean,
		Hash:    HashBytes(data),
		Size:    fi.Size(),
		ModTime: fi.ModTime().UnixMilli(),
	}, nil
}

func (v *Vault) Delete(p string) error {
	abs, err := v.Resolve(p)
	if err != nil {
		return err
	}
	if err := os.Remove(abs); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}
	v.pruneEmptyDirs(filepath.Dir(abs))
	return nil
}

// pruneEmptyDirs removes directories left empty by a delete, stopping at the
// vault root. Obsidian does the same, and it keeps the tree tidy.
func (v *Vault) pruneEmptyDirs(dir string) {
	for underRoot(v.root, dir) && dir != v.root {
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) > 0 {
			return
		}
		if err := os.Remove(dir); err != nil {
			return
		}
		dir = filepath.Dir(dir)
	}
}

// Scan walks the vault and returns every synced file. This is what makes the
// SQLite index disposable: it can always be rebuilt from the disk.
func (v *Vault) Scan() ([]FileMeta, error) {
	var out []FileMeta
	err := filepath.WalkDir(v.root, func(abs string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, relErr := v.RelPath(abs)
		if relErr != nil {
			return nil
		}
		if rel == "." {
			return nil
		}
		if d.IsDir() {
			if Ignored(rel) {
				return fs.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() || Ignored(rel) {
			return nil
		}
		meta, err := v.statAbs(abs, rel)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				return nil // raced with a delete
			}
			return err
		}
		out = append(out, meta)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

// ConflictPath builds the sidecar name used when a push loses a race:
// "note (conflict <device> <ISO date>).md" (plan section 4.4).
func ConflictPath(p, device string, when time.Time) string {
	ext := filepath.Ext(p)
	base := strings.TrimSuffix(p, ext)
	device = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			return r
		default:
			return '-'
		}
	}, device)
	return fmt.Sprintf("%s (conflict %s %s)%s", base, device, when.UTC().Format("2006-01-02 150405"), ext)
}

func HashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func hashFile(abs string) (string, error) {
	f, err := os.Open(abs)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", ErrNotFound
		}
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
