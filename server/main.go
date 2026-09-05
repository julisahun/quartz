// Command quarts is the notes server: it owns a vault of plain markdown files,
// journals every change (whoever made it), and serves the sync API and the PWA.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"quarts/internal/config"
	"quarts/internal/gitstore"
	"quarts/internal/httpapi"
	"quarts/internal/index"
	"quarts/internal/service"
	"quarts/internal/vault"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	v, err := vault.Open(cfg.VaultDir, cfg.MaxFileBytes)
	if err != nil {
		return err
	}
	idx, err := index.Open(cfg.IndexDB)
	if err != nil {
		return err
	}
	defer idx.Close()

	var git *gitstore.Store
	if cfg.GitEnabled {
		git, err = gitstore.New(v.Root(), cfg.GitDebounce, log)
		if err != nil {
			return err
		}
		defer git.Close()
	} else {
		git, err = gitstore.NewDisabled(v.Root(), log)
		if err != nil {
			return err
		}
	}

	svc := service.New(v, idx, git, log)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := svc.Start(ctx); err != nil {
		return err
	}
	go housekeeping(ctx, idx, log)

	api := httpapi.New(cfg, svc, idx, log)
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       5 * time.Minute, // attachments over a slow phone link
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       2 * time.Minute,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("quarts listening", "addr", cfg.Addr, "vault", v.Root(), "git", cfg.GitEnabled)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Info("shutting down")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Warn("shutdown was not clean", "err", err)
	}
	// Flush any debounced commit so nothing is left uncommitted on restart.
	return git.Close()
}

func housekeeping(ctx context.Context, idx *index.Index, log *slog.Logger) {
	t := time.NewTicker(6 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := idx.PurgeExpiredSessions(); err != nil {
				log.Warn("session purge failed", "err", err)
			}
		}
	}
}
