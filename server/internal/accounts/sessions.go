package accounts

import (
	"database/sql"
	"errors"
	"time"
)

type Session struct {
	TokenHash string
	User      string
	Device    string
	Created   time.Time
	Expires   time.Time
	LastSeen  time.Time
}

func (s *Store) CreateSession(tokenHash, user, device string, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	_, err := s.db.Exec(
		`INSERT INTO sessions (token_hash, user, device, created, expires, last_seen) VALUES (?, ?, ?, ?, ?, ?)`,
		tokenHash, user, device, now.UnixMilli(), now.Add(ttl).UnixMilli(), now.UnixMilli())
	return err
}

func (s *Store) LookupSession(tokenHash string) (Session, bool, error) {
	var sess Session
	var created, expires, lastSeen int64
	err := s.db.QueryRow(
		`SELECT token_hash, user, device, created, expires, last_seen FROM sessions WHERE token_hash = ?`,
		tokenHash).Scan(&sess.TokenHash, &sess.User, &sess.Device, &created, &expires, &lastSeen)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, false, nil
	}
	if err != nil {
		return Session{}, false, err
	}
	sess.Created = time.UnixMilli(created)
	sess.Expires = time.UnixMilli(expires)
	sess.LastSeen = time.UnixMilli(lastSeen)
	if time.Now().After(sess.Expires) {
		return Session{}, false, nil
	}
	return sess, true, nil
}

// TouchSession slides the expiry forward, called at most once a day per
// session so a device that syncs constantly does not write on every request.
func (s *Store) TouchSession(tokenHash string, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	_, err := s.db.Exec(`UPDATE sessions SET expires = ?, last_seen = ? WHERE token_hash = ?`,
		now.Add(ttl).UnixMilli(), now.UnixMilli(), tokenHash)
	return err
}

func (s *Store) DeleteSession(tokenHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (s *Store) PurgeExpiredSessions() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM sessions WHERE expires < ?`, time.Now().UnixMilli())
	return err
}

// DeleteSessionsFor drops every session a user holds except one. A password
// change is the moment someone acts on "that password may have leaked", so the
// other devices go — but not the device doing the changing, which would
// otherwise sign itself out mid-request.
func (s *Store) DeleteSessionsFor(user, keepTokenHash string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	res, err := s.db.Exec(`DELETE FROM sessions WHERE user = ? AND token_hash <> ?`, user, keepTokenHash)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}
