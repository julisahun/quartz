package index

import (
	"database/sql"
	"errors"
	"time"
)

type Session struct {
	TokenHash string
	Device    string
	Created   time.Time
	Expires   time.Time
	LastSeen  time.Time
}

func (ix *Index) CreateSession(tokenHash, device string, ttl time.Duration) error {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	now := time.Now()
	_, err := ix.db.Exec(
		`INSERT INTO sessions (token_hash, device, created, expires, last_seen) VALUES (?, ?, ?, ?, ?)`,
		tokenHash, device, now.UnixMilli(), now.Add(ttl).UnixMilli(), now.UnixMilli())
	return err
}

// LookupSession returns the session if it exists and has not expired.
func (ix *Index) LookupSession(tokenHash string) (Session, bool, error) {
	var s Session
	var created, expires, lastSeen int64
	err := ix.db.QueryRow(
		`SELECT token_hash, device, created, expires, last_seen FROM sessions WHERE token_hash = ?`,
		tokenHash).Scan(&s.TokenHash, &s.Device, &created, &expires, &lastSeen)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, false, nil
	}
	if err != nil {
		return Session{}, false, err
	}
	s.Created = time.UnixMilli(created)
	s.Expires = time.UnixMilli(expires)
	s.LastSeen = time.UnixMilli(lastSeen)
	if time.Now().After(s.Expires) {
		return Session{}, false, nil
	}
	return s, true, nil
}

// TouchSession slides the expiry forward. Called at most once a day per session
// so a device that syncs constantly does not write on every request.
func (ix *Index) TouchSession(tokenHash string, ttl time.Duration) error {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	now := time.Now()
	_, err := ix.db.Exec(
		`UPDATE sessions SET expires = ?, last_seen = ? WHERE token_hash = ?`,
		now.Add(ttl).UnixMilli(), now.UnixMilli(), tokenHash)
	return err
}

func (ix *Index) DeleteSession(tokenHash string) error {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	_, err := ix.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (ix *Index) PurgeExpiredSessions() error {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	_, err := ix.db.Exec(`DELETE FROM sessions WHERE expires < ?`, time.Now().UnixMilli())
	return err
}
