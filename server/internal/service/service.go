// Package service is the coordinator: it is the only place that mutates the
// vault, and it keeps the index and git in step with whatever happens on disk —
// whether the write came through the API or from Obsidian.
package service

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"quartz/internal/gitstore"
	"quartz/internal/index"
	"quartz/internal/vault"
	"quartz/internal/watcher"
)

type Service struct {
	Vault *vault.Vault
	Index *index.Index
	Git   *gitstore.Store

	log *slog.Logger
	mu  sync.Mutex // serialises check-then-write; the workload is tiny
}

func New(v *vault.Vault, ix *index.Index, git *gitstore.Store, log *slog.Logger) *Service {
	return &Service{Vault: v, Index: ix, Git: git, log: log}
}

// Start begins watching the vault and reconciles the index against the disk.
//
// Order matters: the watcher is registered first so that a write landing
// during reconciliation still produces an event. Reconciliation is what
// catches everything written while the server was down.
func (s *Service) Start(ctx context.Context) error {
	w := watcher.New(s.Vault.Root(), 400*time.Millisecond, s.log, vault.Ignored, s.Refresh)
	if err := w.Start(ctx); err != nil {
		return err
	}
	n, err := s.reconcile()
	if err != nil {
		return err
	}
	s.log.Info("index reconciled with vault", "changes", n)
	return nil
}

func (s *Service) reconcile() (int, error) {
	files, err := s.Vault.Scan()
	if err != nil {
		return 0, err
	}
	return s.Index.Reconcile(files, func(p string) ([]byte, error) {
		data, _, err := s.Vault.Read(p)
		return data, err
	})
}

// Refresh re-reads one path and journals whatever it finds. Called by the
// watcher for every change, including the server's own writes — RecordPut is
// idempotent, so those are absorbed rather than double-journalled.
func (s *Service) Refresh(rel string) {
	if vault.Ignored(rel) {
		return
	}
	meta, err := s.Vault.Stat(rel)
	switch {
	case errors.Is(err, vault.ErrNotFound):
		if _, ok, err := s.Index.RecordDelete(rel); err != nil {
			s.log.Error("journal delete failed", "path", rel, "err", err)
		} else if ok {
			s.log.Info("external delete", "path", rel)
			s.Git.Touch()
		}
		return
	case err != nil:
		s.log.Warn("stat failed", "path", rel, "err", err)
		return
	}

	var body []byte
	if vault.IsMarkdown(rel) {
		if data, _, err := s.Vault.Read(rel); err == nil {
			body = data
		}
	}
	if _, ok, err := s.Index.RecordPut(meta, body); err != nil {
		s.log.Error("journal put failed", "path", rel, "err", err)
	} else if ok {
		s.log.Info("change journalled", "path", rel, "size", meta.Size)
		s.Git.Touch()
	}
}

// Write applies a conditional write. Exactly one precondition applies:
// ifMatch is the hash the client believes the server holds, or mustNotExist
// says the client believes there is no such file yet.
func (s *Service) Write(path string, data []byte, ifMatch string, mustNotExist bool) (vault.FileMeta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, err := s.Vault.Stat(path)
	exists := err == nil
	if err != nil && !errors.Is(err, vault.ErrNotFound) {
		return vault.FileMeta{}, err
	}

	switch {
	case mustNotExist && exists:
		return current, vault.ErrConflict
	case !mustNotExist && !exists:
		return vault.FileMeta{}, vault.ErrConflict
	case !mustNotExist && current.Hash != ifMatch:
		return current, vault.ErrConflict
	}

	meta, err := s.Vault.Write(path, data)
	if err != nil {
		return vault.FileMeta{}, err
	}
	var body []byte
	if vault.IsMarkdown(path) {
		body = data
	}
	if _, _, err := s.Index.RecordPut(meta, body); err != nil {
		return meta, err
	}
	s.Git.Touch()
	return meta, nil
}

// Delete removes a file if the client's view of it is current.
func (s *Service) Delete(path, ifMatch string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, err := s.Vault.Stat(path)
	if errors.Is(err, vault.ErrNotFound) {
		// Already gone: make sure the journal agrees, then treat as success.
		if _, _, err := s.Index.RecordDelete(path); err != nil {
			return err
		}
		return nil
	}
	if err != nil {
		return err
	}
	if current.Hash != ifMatch {
		return vault.ErrConflict
	}
	if err := s.Vault.Delete(path); err != nil {
		return err
	}
	if _, _, err := s.Index.RecordDelete(path); err != nil {
		return err
	}
	s.Git.Touch()
	return nil
}

// Read returns file contents with the metadata the API turns into an ETag.
func (s *Service) Read(path string) ([]byte, vault.FileMeta, error) {
	return s.Vault.Read(path)
}
