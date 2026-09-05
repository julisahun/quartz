// Package config loads the server configuration from the environment.
package config

import (
	"os"
	"path/filepath"
	"strconv"
	"time"
)

type Config struct {
	Addr string // listen address, loopback only in production

	DataDir   string // everything the server owns lives under here
	WebDir    string // optional: built PWA served from the same origin
	DevOrigin string // optional: extra CORS origin for `npm run dev`

	// Carried over from the single-user deployment: when the accounts
	// database is empty and these are set, the first user and their private
	// vault are created from them, so an upgrade needs no manual steps.
	LegacyVaultDir     string
	LegacyUser         string
	LegacyPasswordHash string

	SessionTTL   time.Duration
	SecureCookie bool

	GitEnabled  bool
	GitDebounce time.Duration

	MaxFileBytes int64
}

func Load() (Config, error) {
	c := Config{
		Addr:               env("QUARTZ_ADDR", "127.0.0.1:8086"),
		DataDir:            env("QUARTZ_DATA", "/srv/quartz"),
		WebDir:             env("QUARTZ_WEB_DIR", ""),
		DevOrigin:          env("QUARTZ_DEV_ORIGIN", ""),
		LegacyVaultDir:     os.Getenv("QUARTZ_VAULT"),
		LegacyUser:         os.Getenv("QUARTZ_USER"),
		LegacyPasswordHash: os.Getenv("QUARTZ_PASSWORD_HASH"),
		SecureCookie:       envBool("QUARTZ_SECURE_COOKIE", true),
		GitEnabled:         envBool("QUARTZ_GIT", true),
		MaxFileBytes:       int64(envInt("QUARTZ_MAX_FILE_MB", 64)) << 20,
	}

	// Long sliding TTL: an offline launch must never bounce you to a login
	// you cannot reach (plan section 4.3).
	ttlDays := envInt("QUARTZ_SESSION_TTL_DAYS", 90)
	c.SessionTTL = time.Duration(ttlDays) * 24 * time.Hour

	debounce := envInt("QUARTZ_GIT_DEBOUNCE_SECONDS", 30)
	c.GitDebounce = time.Duration(debounce) * time.Second

	return c, nil
}

// AccountsDB holds users, vaults, memberships and sessions. Unlike a vault
// index it is not rebuildable, so it is the one file worth backing up
// separately from the notes themselves.
func (c Config) AccountsDB() string { return filepath.Join(c.DataDir, "accounts.sqlite") }

// VaultsDir is where new vaults are created.
func (c Config) VaultsDir() string { return filepath.Join(c.DataDir, "vaults") }

// IndexPath keeps a vault's index outside the vault itself: anything inside
// would sync to every client and show up in Obsidian.
func (c Config) IndexPath(vaultID string) string {
	return filepath.Join(c.DataDir, "index", vaultID+".sqlite")
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}
