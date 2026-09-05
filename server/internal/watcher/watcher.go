// Package watcher reports filesystem changes inside the vault.
//
// This is load-bearing, not an add-on: Obsidian writes the same vault directly,
// so the server's own journal cannot be the only source of truth
// (plan section 6, the two-writer problem).
package watcher

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type Watcher struct {
	root     string
	ignore   func(rel string) bool
	onChange func(rel string)
	debounce time.Duration
	log      *slog.Logger

	mu     sync.Mutex
	timers map[string]*time.Timer
}

func New(root string, debounce time.Duration, log *slog.Logger, ignore func(string) bool, onChange func(string)) *Watcher {
	return &Watcher{
		root:     root,
		ignore:   ignore,
		onChange: onChange,
		debounce: debounce,
		log:      log,
		timers:   map[string]*time.Timer{},
	}
}

// Start registers the watches synchronously and then processes events in the
// background until the context is cancelled.
//
// Registration has to be synchronous: the caller reconciles the index against
// the disk right after this returns, and anything written in between would
// otherwise fall in the gap between the two — seen by neither.
func (w *Watcher) Start(ctx context.Context) error {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	if err := w.addTree(fsw, w.root); err != nil {
		fsw.Close()
		return err
	}
	go func() {
		defer fsw.Close()
		w.loop(ctx, fsw)
	}()
	return nil
}

// loop consumes events until the context is cancelled. Editors write via
// rename and temp files, so every event kind is treated the same way: mark the
// path dirty and let the caller re-stat it once things go quiet.
func (w *Watcher) loop(ctx context.Context, fsw *fsnotify.Watcher) {
	for {
		select {
		case <-ctx.Done():
			w.stopTimers()
			return

		case event, ok := <-fsw.Events:
			if !ok {
				return
			}
			rel, err := filepath.Rel(w.root, event.Name)
			if err != nil {
				continue
			}
			rel = filepath.ToSlash(rel)
			if rel == "." || w.ignore(rel) {
				continue
			}
			// A new directory needs its own watch, and may already contain
			// files (an unzip, a git checkout, a whole folder moved in).
			if fi, err := os.Stat(event.Name); err == nil && fi.IsDir() {
				if event.Op&(fsnotify.Create|fsnotify.Rename) != 0 {
					if err := w.addTree(fsw, event.Name); err != nil {
						w.log.Warn("watch subtree failed", "path", rel, "err", err)
					}
					w.scanInto(event.Name)
				}
				continue
			}
			if event.Op&fsnotify.Chmod != 0 && event.Op&^fsnotify.Chmod == 0 {
				continue // metadata only
			}
			w.schedule(rel)

		case err, ok := <-fsw.Errors:
			if !ok {
				return
			}
			w.log.Warn("watcher error", "err", err)
		}
	}
}

func (w *Watcher) addTree(fsw *fsnotify.Watcher, dir string) error {
	return filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // a directory that vanished mid-walk is not fatal
		}
		if !d.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(w.root, p)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if rel != "." && w.ignore(rel) {
			return filepath.SkipDir
		}
		return fsw.Add(p)
	})
}

// scanInto reports every file inside a directory that appeared wholesale.
func (w *Watcher) scanInto(dir string) {
	_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(w.root, p)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if !w.ignore(rel) {
			w.schedule(rel)
		}
		return nil
	})
}

func (w *Watcher) schedule(rel string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if t, ok := w.timers[rel]; ok {
		t.Stop()
	}
	w.timers[rel] = time.AfterFunc(w.debounce, func() {
		w.mu.Lock()
		delete(w.timers, rel)
		w.mu.Unlock()
		w.onChange(rel)
	})
}

func (w *Watcher) stopTimers() {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, t := range w.timers {
		t.Stop()
	}
	w.timers = map[string]*time.Timer{}
}
