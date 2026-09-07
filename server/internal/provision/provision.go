// Package provision creates accounts and vaults. The server uses it to carry
// a single-user deployment over on first start; the admin CLI uses it for
// everything after that.
package provision

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"quartz/internal/accounts"
	"quartz/internal/config"
)

// NewVault registers a vault owned by one account, with its directory under
// the vaults base. Other people are added to it with the CLI; a vault holding
// only its owner is not a different kind of thing from one holding five.
func NewVault(store *accounts.Store, cfg config.Config, id, displayName, owner string) error {
	return AdoptVault(store, cfg, id, displayName, owner, "")
}

// AdoptVault is NewVault for a directory that already exists somewhere else,
// which is how a single-user deployment's vault is carried over: it is
// registered where it stands rather than moved.
func AdoptVault(store *accounts.Store, cfg config.Config, id, displayName, owner, existingRoot string) error {
	if exists, err := store.UserExists(owner); err != nil {
		return err
	} else if !exists {
		return accounts.ErrNoSuchUser
	}
	if !accounts.ValidName(id) {
		return accounts.ErrBadName
	}
	root := existingRoot
	if root == "" {
		root = filepath.Join(cfg.VaultsDir(), id)
	}
	// Created here so the owner's notes have somewhere to land before the
	// server ever opens it.
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	if displayName == "" {
		displayName = id
	}
	return store.CreateVault(accounts.Vault{
		ID:    id,
		Name:  displayName,
		Root:  root,
		Owner: owner,
	})
}

// FromLegacyEnv carries a single-user deployment over to accounts on first
// start: the .env credentials become the first account, and the vault that was
// already being served is adopted where it stands rather than moved. Doing
// nothing when accounts already exist makes it safe to run on every boot.
func FromLegacyEnv(store *accounts.Store, cfg config.Config, log *slog.Logger) error {
	users, err := store.ListUsers()
	if err != nil {
		return err
	}
	if len(users) > 0 {
		return nil
	}
	if cfg.LegacyUser == "" || cfg.LegacyPasswordHash == "" {
		log.Warn("no accounts yet — create one with: quartz-admin user add <name>, " +
			"then publish a folder from the app")
		return nil
	}
	if err := store.CreateUserWithHash(cfg.LegacyUser, cfg.LegacyPasswordHash); err != nil {
		return err
	}
	if err := AdoptVault(store, cfg, cfg.LegacyUser, cfg.LegacyUser, cfg.LegacyUser, cfg.LegacyVaultDir); err != nil {
		return err
	}
	log.Info("carried the single-user configuration over to accounts",
		"user", cfg.LegacyUser, "vault", cfg.LegacyVaultDir)
	return nil
}

// DeleteVaultData removes a vault's notes and its index. Deliberately separate
// from removing an account: forgetting who someone is should not delete what
// they wrote. The root is passed in because the registration is usually gone
// by the time this is called.
func DeleteVaultData(cfg config.Config, id, root string) error {
	if root == "" || root == "/" || filepath.Dir(root) == root {
		return fmt.Errorf("refusing to delete %q", root)
	}
	if err := os.RemoveAll(root); err != nil {
		return err
	}
	if err := os.Remove(cfg.IndexPath(id)); err != nil && !os.IsNotExist(err) {
		return err
	}
	// The write-ahead log files travel with the database.
	for _, suffix := range []string{"-wal", "-shm"} {
		if err := os.Remove(cfg.IndexPath(id) + suffix); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
