// Command quartz is the notes server: it owns one vault per user (plus any
// shared vaults), journals every change whoever made it, and serves the sync
// API and the PWA.
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

	"quartz/internal/accounts"
	"quartz/internal/config"
	"quartz/internal/httpapi"
	"quartz/internal/provision"
	"quartz/internal/registry"
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

	store, err := accounts.Open(cfg.AccountsDB())
	if err != nil {
		return err
	}
	defer store.Close()

	if err := provision.FromLegacyEnv(store, cfg, log); err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	reg := registry.New(ctx, cfg, store, log)
	defer reg.Close()
	if err := reg.OpenAll(); err != nil {
		return err
	}
	go housekeeping(ctx, store, log)

	api := httpapi.New(cfg, store, reg, log)
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
		users, _ := store.ListUsers()
		log.Info("quartz listening", "addr", cfg.Addr, "data", cfg.DataDir, "users", len(users), "git", cfg.GitEnabled)
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
	// Flush every vault's debounced commit so nothing is left uncommitted.
	return reg.Close()
}

func housekeeping(ctx context.Context, store *accounts.Store, log *slog.Logger) {
	t := time.NewTicker(6 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := store.PurgeExpiredSessions(); err != nil {
				log.Warn("session purge failed", "err", err)
			}
		}
	}
}
