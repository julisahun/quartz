package provision

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"quartz/internal/accounts"
	"quartz/internal/config"
)

func setup(t *testing.T) (*accounts.Store, config.Config) {
	t.Helper()
	cfg := config.Config{DataDir: t.TempDir()}
	store, err := accounts.Open(cfg.AccountsDB())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store, cfg
}

func TestANewAccountOwnsNothing(t *testing.T) {
	store, _ := setup(t)
	if err := store.CreateUser("maria", "a good password"); err != nil {
		t.Fatal(err)
	}
	// Creating an account used to create a vault named after it. Nothing is
	// automatic now: a vault arrives when a folder is published.
	if vaults, err := store.VaultsFor("maria"); err != nil || len(vaults) != 0 {
		t.Fatalf("vaults for a new account = %+v, %v", vaults, err)
	}
}

func TestNewVaultBelongsToItsOwner(t *testing.T) {
	store, cfg := setup(t)
	if err := store.CreateUser("maria", "a good password"); err != nil {
		t.Fatal(err)
	}
	if err := NewVault(store, cfg, "maria", "maria", "maria"); err != nil {
		t.Fatal(err)
	}
	vault, err := store.Vault("maria")
	if err != nil {
		t.Fatal(err)
	}
	if vault.Owner != "maria" {
		t.Fatalf("vault = %+v", vault)
	}
	if _, err := os.Stat(vault.Root); err != nil {
		t.Fatalf("vault directory was not created: %v", err)
	}
	if role, err := store.Access("maria", "maria"); err != nil || role != accounts.Owner {
		t.Fatalf("owner access = %v, %v", role, err)
	}
}

func TestNewVaultNeedsAnExistingOwner(t *testing.T) {
	store, cfg := setup(t)
	if err := NewVault(store, cfg, "casa", "Casa", "nobody"); err != accounts.ErrNoSuchUser {
		t.Fatalf("unknown owner = %v", err)
	}
	if err := store.CreateUser("juli", "a good password"); err != nil {
		t.Fatal(err)
	}
	if err := NewVault(store, cfg, "casa", "Casa", "juli"); err != nil {
		t.Fatal(err)
	}
	// One namespace for every vault, and that namespace is the URL.
	if err := NewVault(store, cfg, "casa", "Clash", "juli"); err != accounts.ErrVaultExists {
		t.Fatalf("name clash = %v, want ErrVaultExists", err)
	}
}

func TestLegacyDeploymentIsCarriedOverInPlace(t *testing.T) {
	store, cfg := setup(t)

	// A single-user deployment: a vault directory with notes in it, and
	// credentials in the environment.
	legacyVault := filepath.Join(t.TempDir(), "vault")
	if err := os.MkdirAll(legacyVault, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacyVault, "existing.md"), []byte("older note"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg.LegacyUser = "juli"
	cfg.LegacyVaultDir = legacyVault
	cfg.LegacyPasswordHash = hashOf(t, "the old password")

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := FromLegacyEnv(store, cfg, log); err != nil {
		t.Fatal(err)
	}

	// The account works with the password it already had.
	if ok, err := store.Verify("juli", "the old password"); err != nil || !ok {
		t.Fatalf("the carried-over password does not work: %v, %v", ok, err)
	}
	// And the notes were adopted where they stand, not moved or copied.
	vault, err := store.Vault("juli")
	if err != nil {
		t.Fatal(err)
	}
	if vault.Root != legacyVault {
		t.Fatalf("vault root = %q, want the existing directory %q", vault.Root, legacyVault)
	}
	if _, err := os.Stat(filepath.Join(legacyVault, "existing.md")); err != nil {
		t.Fatalf("the existing note is gone: %v", err)
	}

	// Running again changes nothing, so it is safe on every boot.
	if err := FromLegacyEnv(store, cfg, log); err != nil {
		t.Fatal(err)
	}
	users, err := store.ListUsers()
	if err != nil || len(users) != 1 {
		t.Fatalf("users = %+v, %v", users, err)
	}
}

func TestLegacyBootstrapSkippedOnceAccountsExist(t *testing.T) {
	store, cfg := setup(t)
	if err := store.CreateUser("maria", "a good password"); err != nil {
		t.Fatal(err)
	}
	cfg.LegacyUser = "juli"
	cfg.LegacyPasswordHash = hashOf(t, "irrelevant")

	if err := FromLegacyEnv(store, cfg, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil {
		t.Fatal(err)
	}
	if exists, _ := store.UserExists("juli"); exists {
		t.Error("the legacy account was created over an existing installation")
	}
}

func hashOf(t *testing.T, password string) string {
	t.Helper()
	store, _ := setup(t)
	if err := store.CreateUser("tmp", password); err != nil {
		t.Fatal(err)
	}
	var hash string
	if err := store.DB().QueryRow(`SELECT password_hash FROM users WHERE name = 'tmp'`).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	return hash
}
