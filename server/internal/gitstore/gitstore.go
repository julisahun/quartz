// Package gitstore keeps the vault under git. Commits are debounced so a burst
// of edits becomes one commit; at ~60 KB of markdown this is effectively free
// and buys infinite history plus an audit trail for conflict copies
// (plan section 4.1).
package gitstore

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const vaultGitignore = `# Managed by quartz: per-device churn that must not be versioned.
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/cache
.trash/
.DS_Store
Thumbs.db
.quartz-tmp-*
`

type Store struct {
	dir      string
	debounce time.Duration
	log      *slog.Logger

	mu       sync.Mutex
	timer    *time.Timer
	pending  bool
	closed   bool
	disabled bool
}

func New(dir string, debounce time.Duration, log *slog.Logger) (*Store, error) {
	s := &Store{dir: dir, debounce: debounce, log: log}
	if err := s.ensureRepo(); err != nil {
		return nil, err
	}
	return s, nil
}

// NewDisabled returns a store that journals nothing. Used by tests and by
// QUARTZ_GIT=false, so the rest of the server needs no nil checks.
func NewDisabled(dir string, log *slog.Logger) (*Store, error) {
	return &Store{dir: dir, log: log, disabled: true}, nil
}

func (s *Store) ensureRepo() error {
	if _, err := s.run("rev-parse", "--git-dir"); err != nil {
		if _, err := s.run("init", "-b", "master"); err != nil {
			return fmt.Errorf("git init: %w", err)
		}
		s.log.Info("initialised vault git repo", "dir", s.dir)
	}
	ignore := filepath.Join(s.dir, ".gitignore")
	if _, err := os.Stat(ignore); os.IsNotExist(err) {
		if err := os.WriteFile(ignore, []byte(vaultGitignore), 0o644); err != nil {
			return err
		}
	}
	return s.commitNow("quartz: initial vault snapshot")
}

// Touch schedules a commit once the vault has been quiet for the debounce
// period. Repeated calls push the deadline out.
func (s *Store) Touch() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.disabled {
		return
	}
	s.pending = true
	if s.timer != nil {
		s.timer.Stop()
	}
	s.timer = time.AfterFunc(s.debounce, func() {
		if err := s.Flush(); err != nil {
			s.log.Error("vault commit failed", "err", err)
		}
	})
}

// Flush commits any pending change immediately.
func (s *Store) Flush() error {
	s.mu.Lock()
	if !s.pending {
		s.mu.Unlock()
		return nil
	}
	s.pending = false
	s.mu.Unlock()
	return s.commitNow("quartz: sync " + time.Now().UTC().Format(time.RFC3339))
}

func (s *Store) Close() error {
	s.mu.Lock()
	if s.timer != nil {
		s.timer.Stop()
	}
	s.closed = true
	s.mu.Unlock()
	return s.Flush()
}

func (s *Store) commitNow(message string) error {
	if _, err := s.run("add", "-A"); err != nil {
		return err
	}
	// Nothing staged: a no-op commit would only add noise.
	if _, err := s.run("diff", "--cached", "--quiet"); err == nil {
		return nil
	}
	out, err := s.run("commit", "-m", message)
	if err != nil {
		return fmt.Errorf("git commit: %w (%s)", err, out)
	}
	s.log.Info("committed vault", "message", message)
	return nil
}

// Log returns the recent history of a path (or of the whole vault when empty).
func (s *Store) Log(path string, limit int) ([]string, error) {
	if s.disabled {
		return []string{}, nil
	}
	args := []string{"log", fmt.Sprintf("-%d", limit), "--pretty=format:%h %ad %s", "--date=iso-strict"}
	if path != "" {
		args = append(args, "--", path)
	}
	out, err := s.run(args...)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(out) == "" {
		return []string{}, nil
	}
	return strings.Split(strings.TrimSpace(out), "\n"), nil
}

func (s *Store) run(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	full := append([]string{
		"-C", s.dir,
		"-c", "user.name=quartz",
		"-c", "user.email=quartz@sigint-pm.uk",
		"-c", "commit.gpgsign=false",
	}, args...)
	cmd := exec.CommandContext(ctx, "git", full...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		return stdout.String() + stderr.String(), err
	}
	return stdout.String(), nil
}
