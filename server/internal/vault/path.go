package vault

import (
	"errors"
	"path"
	"strings"
)

var (
	ErrBadPath  = errors.New("invalid path")
	ErrIgnored  = errors.New("path is not synced")
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("hash mismatch")
	ErrTooLarge = errors.New("file too large")
)

// CleanPath validates a client-supplied vault path and returns it in canonical
// slash-separated relative form. Path handling is the main attack surface of
// this server (plan section 4.3), so the rules are deliberately strict:
// no absolute paths, no NUL bytes, no "." or ".." segments, no backslashes,
// no leading/trailing slashes, no empty segments.
func CleanPath(p string) (string, error) {
	if p == "" {
		return "", ErrBadPath
	}
	if strings.ContainsRune(p, 0) {
		return "", ErrBadPath
	}
	if strings.ContainsRune(p, '\\') {
		return "", ErrBadPath
	}
	if strings.HasPrefix(p, "/") {
		return "", ErrBadPath
	}
	// Windows-style drive letters and UNC paths.
	if len(p) >= 2 && p[1] == ':' {
		return "", ErrBadPath
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return "", ErrBadPath
		}
	}
	cleaned := path.Clean(p)
	if cleaned != p {
		return "", ErrBadPath
	}
	if len(cleaned) > 1024 {
		return "", ErrBadPath
	}
	return cleaned, nil
}

// Ignored reports whether a vault-relative path is excluded from sync.
//
// .obsidian/ syncs so settings follow you between devices, except the files
// that churn per-device and would generate constant journal noise
// (plan section 4.1).
func Ignored(p string) bool {
	if p == "" {
		return true
	}
	segs := strings.Split(p, "/")
	for _, seg := range segs {
		switch seg {
		case ".git", ".trash", ".obsidian-tmp":
			return true
		}
		// Everything the client and server keep for themselves — temp files
		// during an atomic write, the CLI's sync state — is reserved.
		if strings.HasPrefix(seg, ".quartz") {
			return true
		}
	}
	switch segs[len(segs)-1] {
	case ".DS_Store", "Thumbs.db":
		return true
	}
	if segs[0] == ".obsidian" {
		switch segs[len(segs)-1] {
		case "workspace.json", "workspace-mobile.json", "cache", "workspace":
			return true
		}
		// Obsidian's per-device caches and plugin data blobs.
		if strings.HasSuffix(p, ".cache") || strings.Contains(p, "/cache/") {
			return true
		}
	}
	return false
}

// IsMarkdown reports whether the path is a note (indexed for search).
func IsMarkdown(p string) bool {
	return strings.HasSuffix(strings.ToLower(p), ".md")
}
