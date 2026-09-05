package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const stateFile = ".quartz-sync.json"

// state is the client's view of the server: the cursor into the change journal
// and, per file, the hash the server last confirmed (baseHash). Anything on
// disk whose hash differs from baseHash is a local edit waiting to be pushed.
type state struct {
	Server string                `json:"server"`
	User   string                `json:"user"`
	Device string                `json:"device"`
	Cookie string                `json:"cookie"`
	Cursor int64                 `json:"cursor"`
	Files  map[string]fileRecord `json:"files"`

	// Epoch identifies the server's index. When it changes the index was
	// rebuilt, sequence numbers restarted, and our cursor is meaningless.
	Epoch string `json:"epoch"`

	// Bootstrapped records that the full manifest has been reconciled once.
	// The cursor cannot stand in for this: syncing against an empty server
	// legitimately leaves the cursor at 0, and re-running the bootstrap would
	// resurrect deleted files and re-push stale content.
	Bootstrapped bool `json:"bootstrapped"`

	dir string
}

type fileRecord struct {
	BaseHash string `json:"baseHash"`
}

func loadState(dir string) (*state, error) {
	st := &state{dir: dir, Files: map[string]fileRecord{}}
	data, err := os.ReadFile(filepath.Join(dir, stateFile))
	if os.IsNotExist(err) {
		return st, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, st); err != nil {
		return nil, err
	}
	if st.Files == nil {
		st.Files = map[string]fileRecord{}
	}
	st.dir = dir
	return st, nil
}

func (s *state) save() error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(s.dir, stateFile+".tmp")
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(s.dir, stateFile))
}
