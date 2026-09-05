package main

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"

	"quartz/internal/index"
	"quartz/internal/vault"
)

type syncer struct {
	c   *client
	st  *state
	dir string
	v   *vault.Vault
}

type syncStats struct {
	Pulled    int
	Pushed    int
	Deleted   int
	Conflicts int
}

func (s *syncer) run() (syncStats, error) {
	var stats syncStats

	// First run: reconcile against the full manifest rather than the journal,
	// which this device has never read.
	if !s.st.Bootstrapped {
		if err := s.bootstrap(&stats); err != nil {
			return stats, err
		}
	}
	if err := s.pull(&stats); err != nil {
		return stats, err
	}
	if err := s.push(&stats); err != nil {
		return stats, err
	}
	return stats, s.st.save()
}

func (s *syncer) bootstrap(stats *syncStats) error {
	snap, err := s.c.snapshot()
	if err != nil {
		return err
	}
	for _, f := range snap.Files {
		local, err := s.v.Stat(f.Path)
		switch {
		case errors.Is(err, vault.ErrNotFound):
			if err := s.download(f.Path); err != nil {
				return err
			}
			stats.Pulled++
		case err != nil:
			return err
		case local.Hash == f.Hash:
			// Same bytes on both sides: adopt the server's version as the base.
			s.st.Files[f.Path] = fileRecord{BaseHash: f.Hash}
		default:
			// Same path, different bytes, and no shared history to merge from.
			// Keep both: the local copy becomes a conflict file, the server's
			// version becomes the local one.
			data, _, err := s.v.Read(f.Path)
			if err != nil {
				return err
			}
			conflict := vault.ConflictPath(f.Path, s.st.Device, time.Now())
			if _, err := s.v.Write(conflict, data); err != nil {
				return err
			}
			if err := s.download(f.Path); err != nil {
				return err
			}
			stats.Conflicts++
			fmt.Fprintf(os.Stderr, "conflict: %s already existed here with different content (copy at %s)\n", f.Path, conflict)
		}
	}
	s.st.Cursor = snap.Head
	s.st.Epoch = snap.Epoch
	s.st.Bootstrapped = true
	return nil
}

// pull applies remote changes to clean files and leaves dirty ones alone; the
// push step turns those into conflicts (plan section 4.4).
func (s *syncer) pull(stats *syncStats) error {
	for {
		page, err := s.c.changes(s.st.Cursor)
		if err != nil {
			return err
		}
		if page.Epoch != "" && s.st.Epoch != "" && page.Epoch != s.st.Epoch {
			// The server rebuilt its index from the vault. Our cursor points
			// into a journal that no longer exists, so start from the manifest.
			fmt.Fprintln(os.Stderr, "the server rebuilt its index; reconciling from the manifest")
			s.st.Cursor = 0
			return s.bootstrap(stats)
		}
		s.st.Epoch = page.Epoch
		for _, ch := range page.Changes {
			if err := s.applyChange(ch, stats); err != nil {
				return err
			}
			s.st.Cursor = ch.Seq
		}
		s.st.Cursor = page.Head
		if !page.More {
			return nil
		}
	}
}

func (s *syncer) applyChange(ch index.Change, stats *syncStats) error {
	rec, tracked := s.st.Files[ch.Path]
	local, statErr := s.v.Stat(ch.Path)
	exists := statErr == nil

	// Two kinds of pending local work, both of which pull must leave alone:
	// an edit, and a delete that has not been pushed yet.
	locallyEdited := exists && (!tracked || local.Hash != rec.BaseHash)
	locallyDeleted := !exists && tracked

	switch ch.Op {
	case index.OpPut:
		if exists && local.Hash == ch.Hash {
			s.st.Files[ch.Path] = fileRecord{BaseHash: ch.Hash}
			return nil
		}
		if locallyEdited {
			return nil // the push step resolves this as a conflict
		}
		if locallyDeleted && ch.Hash == rec.BaseHash {
			return nil // our pending delete still stands; push will send it
		}
		// Clean, or a remote edit that outranks our pending delete —
		// deletion loses to edit (plan section 4.4).
		if err := s.download(ch.Path); err != nil {
			return err
		}
		if locallyDeleted {
			// Undoing someone's delete is worth saying out loud.
			stats.Conflicts++
			fmt.Fprintf(os.Stderr, "restored %s: it was edited elsewhere after you deleted it\n", ch.Path)
		} else {
			stats.Pulled++
		}
	case index.OpDel:
		if locallyEdited {
			return nil // our edit beats the delete; push re-creates the file
		}
		if exists {
			if err := s.v.Delete(ch.Path); err != nil && !errors.Is(err, vault.ErrNotFound) {
				return err
			}
			stats.Deleted++
		}
		delete(s.st.Files, ch.Path)
	}
	return nil
}

func (s *syncer) download(path string) error {
	data, hash, err := s.c.getFile(path)
	if err != nil {
		var ae *apiError
		if errors.As(err, &ae) && ae.Status == http.StatusNotFound {
			return nil // deleted again while we were fetching
		}
		return err
	}
	if _, err := s.v.Write(path, data); err != nil {
		return err
	}
	s.st.Files[path] = fileRecord{BaseHash: hash}
	return nil
}

func (s *syncer) push(stats *syncStats) error {
	files, err := s.v.Scan()
	if err != nil {
		return err
	}
	onDisk := map[string]vault.FileMeta{}
	for _, f := range files {
		onDisk[f.Path] = f
	}

	paths := make([]string, 0, len(onDisk)+len(s.st.Files))
	for p := range onDisk {
		paths = append(paths, p)
	}
	for p := range s.st.Files {
		if _, ok := onDisk[p]; !ok {
			paths = append(paths, p)
		}
	}
	sort.Strings(paths)

	for _, p := range paths {
		meta, present := onDisk[p]
		rec, tracked := s.st.Files[p]

		switch {
		case present && (!tracked || meta.Hash != rec.BaseHash):
			data, _, err := s.v.Read(p)
			if err != nil {
				return err
			}
			if err := s.pushFile(p, data, rec.BaseHash, stats); err != nil {
				return err
			}
		case !present && tracked:
			if err := s.pushDelete(p, rec.BaseHash, stats); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *syncer) pushFile(path string, data []byte, baseHash string, stats *syncStats) error {
	meta, err := s.c.putFile(path, data, baseHash)
	if err == nil {
		s.st.Files[path] = fileRecord{BaseHash: meta.Hash}
		stats.Pushed++
		return nil
	}
	var ae *apiError
	if !errors.As(err, &ae) || ae.Status != http.StatusPreconditionFailed {
		return err
	}

	// The server has something else at this path. Fetch it to find out what.
	serverData, serverHash, getErr := s.c.getFile(path)
	if getErr != nil {
		var ge *apiError
		if errors.As(getErr, &ge) && ge.Status == http.StatusNotFound {
			// It was deleted there while we were editing it here. An edit
			// beats a delete, so put the file back.
			meta, err := s.c.putFile(path, data, "")
			if err != nil {
				return err
			}
			s.st.Files[path] = fileRecord{BaseHash: meta.Hash}
			stats.Pushed++
			fmt.Fprintf(os.Stderr, "restored %s: it was deleted elsewhere but edited here\n", path)
			return nil
		}
		return getErr
	}

	// A genuine two-writer conflict. Keep both versions: the local buffer
	// becomes a conflict copy, the server's version becomes the local file.
	conflict := vault.ConflictPath(path, s.st.Device, time.Now())
	if _, err := s.v.Write(conflict, data); err != nil {
		return err
	}
	copyMeta, err := s.c.putFile(conflict, data, "")
	if err != nil {
		return err
	}
	s.st.Files[conflict] = fileRecord{BaseHash: copyMeta.Hash}

	if _, err := s.v.Write(path, serverData); err != nil {
		return err
	}
	s.st.Files[path] = fileRecord{BaseHash: serverHash}

	stats.Conflicts++
	fmt.Fprintf(os.Stderr, "conflict: kept both versions of %s (copy at %s)\n", path, conflict)
	return nil
}

func (s *syncer) pushDelete(path, baseHash string, stats *syncStats) error {
	err := s.c.deleteFile(path, baseHash)
	if err == nil {
		delete(s.st.Files, path)
		stats.Deleted++
		return nil
	}
	var ae *apiError
	if !errors.As(err, &ae) || ae.Status != http.StatusPreconditionFailed {
		return err
	}
	// Someone edited the file we were deleting: deletion loses to edit.
	if err := s.download(path); err != nil {
		return err
	}
	stats.Conflicts++
	fmt.Fprintf(os.Stderr, "conflict: %s was edited elsewhere, delete dropped\n", path)
	return nil
}

func localVault(dir string) (*vault.Vault, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	return vault.Open(abs, 64<<20)
}
