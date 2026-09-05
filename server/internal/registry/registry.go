// Package registry holds one running vault per registered vault: its own
// directory, index, git repo, watcher and change journal.
//
// Vaults are opened on demand, so a vault created from the admin CLI starts
// serving without restarting the server.
package registry

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"

	"quartz/internal/accounts"
	"quartz/internal/config"
	"quartz/internal/gitstore"
	"quartz/internal/index"
	"quartz/internal/service"
	"quartz/internal/vault"
)

type running struct {
	svc    *service.Service
	idx    *index.Index
	git    *gitstore.Store
	cancel context.CancelFunc
}

type Registry struct {
	cfg      config.Config
	accounts *accounts.Store
	log      *slog.Logger
	ctx      context.Context

	mu    sync.Mutex
	open  map[string]*running
	fatal error
}

func New(ctx context.Context, cfg config.Config, store *accounts.Store, log *slog.Logger) *Registry {
	return &Registry{cfg: cfg, accounts: store, log: log, ctx: ctx, open: map[string]*running{}}
}

// Service returns the running vault, opening it the first time it is asked for.
func (r *Registry) Service(vaultID string) (*service.Service, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if existing, ok := r.open[vaultID]; ok {
		return existing.svc, nil
	}
	meta, err := r.accounts.Vault(vaultID)
	if err != nil {
		return nil, err
	}
	started, err := r.start(meta)
	if err != nil {
		return nil, err
	}
	r.open[vaultID] = started
	return started.svc, nil
}

func (r *Registry) start(meta accounts.Vault) (*running, error) {
	if err := os.MkdirAll(meta.Root, 0o755); err != nil {
		return nil, err
	}
	v, err := vault.Open(meta.Root, r.cfg.MaxFileBytes)
	if err != nil {
		return nil, err
	}
	idx, err := index.Open(r.cfg.IndexPath(meta.ID))
	if err != nil {
		return nil, err
	}

	log := r.log.With("vault", meta.ID)
	var git *gitstore.Store
	if r.cfg.GitEnabled {
		git, err = gitstore.New(v.Root(), r.cfg.GitDebounce, log)
	} else {
		git, err = gitstore.NewDisabled(v.Root(), log)
	}
	if err != nil {
		idx.Close()
		return nil, err
	}

	ctx, cancel := context.WithCancel(r.ctx)
	svc := service.New(v, idx, git, log)
	if err := svc.Start(ctx); err != nil {
		cancel()
		idx.Close()
		return nil, err
	}
	log.Info("vault open", "root", v.Root(), "kind", meta.Kind)
	return &running{svc: svc, idx: idx, git: git, cancel: cancel}, nil
}

// OpenAll warms every registered vault at startup, so a change made while the
// server was down is journalled without waiting for someone to ask for it.
func (r *Registry) OpenAll() error {
	vaults, err := r.accounts.AllVaults()
	if err != nil {
		return err
	}
	for _, v := range vaults {
		if _, err := r.Service(v.ID); err != nil {
			return fmt.Errorf("opening vault %s: %w", v.ID, err)
		}
	}
	return nil
}

// Close flushes pending commits and stops every watcher.
func (r *Registry) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	var firstErr error
	for id, running := range r.open {
		running.cancel()
		if err := running.git.Close(); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("closing git for %s: %w", id, err)
		}
		if err := running.idx.Close(); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("closing index for %s: %w", id, err)
		}
		delete(r.open, id)
	}
	return firstErr
}
