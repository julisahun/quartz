// Package config loads the server configuration from the environment.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Addr string // listen address, loopback only in production

	VaultDir  string // the store of record: plain .md files, a git repo
	IndexDB   string // rebuildable SQLite index (change journal + FTS)
	WebDir    string // optional: built PWA served from the same origin
	DevOrigin string // optional: extra CORS origin for `npm run dev`

	User         string // single user (see DECISIONS.md)
	PasswordHash string // argon2id PHC string, from quartz-passwd

	SessionTTL   time.Duration
	SecureCookie bool

	GitEnabled  bool
	GitDebounce time.Duration

	MaxFileBytes int64
}

func Load() (Config, error) {
	c := Config{
		Addr:         env("QUARTZ_ADDR", "127.0.0.1:8086"),
		VaultDir:     env("QUARTZ_VAULT", "/srv/quartz/vault"),
		IndexDB:      env("QUARTZ_INDEX", "/srv/quartz/index.sqlite"),
		WebDir:       env("QUARTZ_WEB_DIR", ""),
		DevOrigin:    env("QUARTZ_DEV_ORIGIN", ""),
		User:         env("QUARTZ_USER", "juli"),
		PasswordHash: os.Getenv("QUARTZ_PASSWORD_HASH"),
		SecureCookie: envBool("QUARTZ_SECURE_COOKIE", true),
		GitEnabled:   envBool("QUARTZ_GIT", true),
		MaxFileBytes: int64(envInt("QUARTZ_MAX_FILE_MB", 64)) << 20,
	}

	// Long sliding TTL: an offline launch must never bounce you to a login
	// you cannot reach (plan section 4.3).
	ttlDays := envInt("QUARTZ_SESSION_TTL_DAYS", 90)
	c.SessionTTL = time.Duration(ttlDays) * 24 * time.Hour

	debounce := envInt("QUARTZ_GIT_DEBOUNCE_SECONDS", 30)
	c.GitDebounce = time.Duration(debounce) * time.Second

	if c.PasswordHash == "" {
		return c, fmt.Errorf("QUARTZ_PASSWORD_HASH is not set (generate one with quartz-passwd)")
	}
	return c, nil
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
