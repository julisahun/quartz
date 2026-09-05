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

// User creates an account and its private vault. The vault directory is
// created here so the owner's notes have somewhere to land before the server
// ever opens it.
func User(store *accounts.Store, cfg config.Config, name, password string) error {
	if err := store.CreateUser(name, password); err != nil {
		return err
	}
	return privateVault(store, cfg, name, "")
}

// UserWithHash is User for an account carried over from an existing argon2id
// hash, with an optional existing vault directory to adopt in place.
func UserWithHash(store *accounts.Store, cfg config.Config, name, hash, existingRoot string) error {
	if err := store.CreateUserWithHash(name, hash); err != nil {
		return err
	}
	return privateVault(store, cfg, name, existingRoot)
}

func privateVault(store *accounts.Store, cfg config.Config, name, existingRoot string) error {
	root := existingRoot
	if root == "" {
		root = filepath.Join(cfg.VaultsDir(), name)
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	return store.CreateVault(accounts.Vault{
		ID:    name, // a private vault is addressed by its owner's name
		Name:  name,
		Kind:  accounts.Private,
		Root:  root,
		Owner: name,
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
		log.Warn("no accounts yet — create one with: quartz-admin user add <name>")
		return nil
	}
	if err := UserWithHash(store, cfg, cfg.LegacyUser, cfg.LegacyPasswordHash, cfg.LegacyVaultDir); err != nil {
		return err
	}
	log.Info("carried the single-user configuration over to accounts",
		"user", cfg.LegacyUser, "vault", cfg.LegacyVaultDir)
	return nil
}

// SharedVault creates a vault owned by one user that others can be added to.
func SharedVault(store *accounts.Store, cfg config.Config, id, displayName, owner string) error {
	if exists, err := store.UserExists(owner); err != nil {
		return err
	} else if !exists {
		return accounts.ErrNoSuchUser
	}
	if !accounts.ValidName(id) {
		return accounts.ErrBadName
	}
	// A shared vault must not take the name of a private one; the vaults table
	// shares one namespace, so this is enforced by its primary key.
	root := filepath.Join(cfg.VaultsDir(), id)
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	if displayName == "" {
		displayName = id
	}
	return store.CreateVault(accounts.Vault{
		ID:    id,
		Name:  displayName,
		Kind:  accounts.Shared,
		Root:  root,
		Owner: owner,
	})
}

// DeleteVaultData removes a vault's notes. Deliberately separate from removing
// an account: forgetting who someone is should not delete what they wrote.
func DeleteVaultData(store *accounts.Store, cfg config.Config, id string) error {
	vault, err := store.Vault(id)
	if err != nil {
		return err
	}
	if vault.Root == "" || vault.Root == "/" {
		return fmt.Errorf("refusing to delete %q", vault.Root)
	}
	if err := os.RemoveAll(vault.Root); err != nil {
		return err
	}
	return os.Remove(cfg.IndexPath(id))
}
