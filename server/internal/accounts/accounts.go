// Package accounts owns identity: who exists, which vaults there are, and who
// may open which one.
package accounts

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"quartz/internal/auth"

	_ "modernc.org/sqlite"
)

var (
	ErrNoSuchUser  = errors.New("no such user")
	ErrUserExists  = errors.New("user already exists")
	ErrNoSuchVault = errors.New("no such vault")
	ErrVaultExists = errors.New("a vault with that name already exists")
	ErrNotAMember  = errors.New("not a member of that vault")
	ErrBadName     = errors.New("names may use letters, digits, dots, dashes and underscores")
	ErrLastOwner   = errors.New("a vault must keep an owner")
)

type Kind string

const (
	Private Kind = "private"
	Shared  Kind = "shared"
)

type Role string

const (
	Owner  Role = "owner"
	Member Role = "member"
)

type User struct {
	Name    string    `json:"name"`
	Created time.Time `json:"created"`
}

type Vault struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Kind    Kind      `json:"kind"`
	Root    string    `json:"-"` // a filesystem path never leaves the server
	Owner   string    `json:"owner"`
	Created time.Time `json:"created"`
	Role    Role      `json:"role,omitempty"`
}

type Store struct {
	db *sql.DB
	mu sync.Mutex
	// decoy is a real argon2id hash of a random string, verified against when
	// the user does not exist so that a wrong name costs the same as a wrong
	// password. Minted at startup so it is always well-formed.
	decoy string
}

var namePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// ValidName is deliberately strict: a name becomes both a URL path segment and
// a directory name.
func ValidName(name string) bool {
	return namePattern.MatchString(name) && name != "." && name != ".."
}

func Open(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	decoyToken, _, err := auth.NewToken()
	if err != nil {
		db.Close()
		return nil, err
	}
	decoy, err := auth.HashPassword(decoyToken)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db, decoy: decoy}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// DB exposes the handle for tests and for one-off maintenance queries.
func (s *Store) DB() *sql.DB { return s.db }

// --- users ---------------------------------------------------------------

func (s *Store) CreateUser(name, password string) error {
	if !ValidName(name) {
		return ErrBadName
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err = s.db.Exec(`INSERT INTO users (name, password_hash, created) VALUES (?, ?, ?)`,
		name, hash, time.Now().UnixMilli())
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrUserExists
	}
	return err
}

// CreateUserWithHash registers a user from an existing argon2id hash, which is
// how the single-user deployment is carried over from its .env file.
func (s *Store) CreateUserWithHash(name, hash string) error {
	if !ValidName(name) {
		return ErrBadName
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`INSERT INTO users (name, password_hash, created) VALUES (?, ?, ?)`,
		name, hash, time.Now().UnixMilli())
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrUserExists
	}
	return err
}

func (s *Store) SetPassword(name, password string) error {
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	res, err := s.db.Exec(`UPDATE users SET password_hash = ? WHERE name = ?`, hash, name)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoSuchUser
	}
	return nil
}

// Verify checks a password. It always runs the hash comparison, even for an
// unknown user, so a wrong name and a wrong password take the same time.
func (s *Store) Verify(name, password string) (bool, error) {
	var hash string
	err := s.db.QueryRow(`SELECT password_hash FROM users WHERE name = ?`, name).Scan(&hash)
	unknown := errors.Is(err, sql.ErrNoRows)
	switch {
	case unknown:
		hash = s.decoy
	case err != nil:
		return false, err
	}
	ok, verifyErr := auth.VerifyPassword(password, hash)
	if unknown {
		return false, nil
	}
	return ok, verifyErr
}

func (s *Store) UserExists(name string) (bool, error) {
	var one int
	err := s.db.QueryRow(`SELECT 1 FROM users WHERE name = ?`, name).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(`SELECT name, created FROM users ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		var created int64
		if err := rows.Scan(&u.Name, &created); err != nil {
			return nil, err
		}
		u.Created = time.UnixMilli(created)
		out = append(out, u)
	}
	return out, rows.Err()
}

// DeleteUser removes an account and its memberships. Vault directories are
// left on disk: deleting someone's notes is a separate, deliberate act.
func (s *Store) DeleteUser(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`DELETE FROM users WHERE name = ?`, name)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoSuchUser
	}
	if _, err := tx.Exec(`DELETE FROM memberships WHERE user = ?`, name); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM sessions WHERE user = ?`, name); err != nil {
		return err
	}
	return tx.Commit()
}

// --- vaults ---------------------------------------------------------------

func (s *Store) CreateVault(v Vault) error {
	if !ValidName(v.ID) {
		return ErrBadName
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(
		`INSERT INTO vaults (id, name, kind, root, owner, created) VALUES (?, ?, ?, ?, ?, ?)`,
		v.ID, v.Name, string(v.Kind), v.Root, v.Owner, time.Now().UnixMilli())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return ErrVaultExists
		}
		return err
	}
	if _, err := tx.Exec(
		`INSERT INTO memberships (user, vault_id, role) VALUES (?, ?, 'owner')`,
		v.Owner, v.ID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Vault(id string) (Vault, error) {
	var v Vault
	var created int64
	var kind string
	err := s.db.QueryRow(
		`SELECT id, name, kind, root, owner, created FROM vaults WHERE id = ?`, id).
		Scan(&v.ID, &v.Name, &kind, &v.Root, &v.Owner, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return Vault{}, ErrNoSuchVault
	}
	if err != nil {
		return Vault{}, err
	}
	v.Kind = Kind(kind)
	v.Created = time.UnixMilli(created)
	return v, nil
}

func (s *Store) AllVaults() ([]Vault, error) {
	rows, err := s.db.Query(`SELECT id, name, kind, root, owner, created FROM vaults ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanVaults(rows)
}

// VaultsFor lists what a user may open, with the role they hold.
func (s *Store) VaultsFor(user string) ([]Vault, error) {
	rows, err := s.db.Query(`
		SELECT v.id, v.name, v.kind, v.root, v.owner, v.created, m.role
		FROM vaults v
		JOIN memberships m ON m.vault_id = v.id
		WHERE m.user = ?
		ORDER BY v.kind DESC, v.name`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Vault{}
	for rows.Next() {
		var v Vault
		var created int64
		var kind, role string
		if err := rows.Scan(&v.ID, &v.Name, &kind, &v.Root, &v.Owner, &created, &role); err != nil {
			return nil, err
		}
		v.Kind = Kind(kind)
		v.Role = Role(role)
		v.Created = time.UnixMilli(created)
		out = append(out, v)
	}
	return out, rows.Err()
}

// Access returns the role a user holds in a vault. This is the only
// authorisation check in the system, so every handler goes through it.
func (s *Store) Access(user, vaultID string) (Role, error) {
	var role string
	err := s.db.QueryRow(
		`SELECT role FROM memberships WHERE user = ? AND vault_id = ?`, user, vaultID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotAMember
	}
	if err != nil {
		return "", err
	}
	return Role(role), nil
}

func (s *Store) AddMember(vaultID, user string, role Role) error {
	if exists, err := s.UserExists(user); err != nil {
		return err
	} else if !exists {
		return ErrNoSuchUser
	}
	if _, err := s.Vault(vaultID); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`
		INSERT INTO memberships (user, vault_id, role) VALUES (?, ?, ?)
		ON CONFLICT(user, vault_id) DO UPDATE SET role = excluded.role`,
		user, vaultID, string(role))
	return err
}

func (s *Store) RemoveMember(vaultID, user string) error {
	vault, err := s.Vault(vaultID)
	if err != nil {
		return err
	}
	if vault.Owner == user {
		return ErrLastOwner
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	res, err := s.db.Exec(`DELETE FROM memberships WHERE user = ? AND vault_id = ?`, user, vaultID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotAMember
	}
	return nil
}

func (s *Store) Members(vaultID string) (map[string]Role, error) {
	rows, err := s.db.Query(`SELECT user, role FROM memberships WHERE vault_id = ? ORDER BY user`, vaultID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Role{}
	for rows.Next() {
		var user, role string
		if err := rows.Scan(&user, &role); err != nil {
			return nil, err
		}
		out[user] = Role(role)
	}
	return out, rows.Err()
}

func scanVaults(rows *sql.Rows) ([]Vault, error) {
	out := []Vault{}
	for rows.Next() {
		var v Vault
		var created int64
		var kind string
		if err := rows.Scan(&v.ID, &v.Name, &kind, &v.Root, &v.Owner, &created); err != nil {
			return nil, err
		}
		v.Kind = Kind(kind)
		v.Created = time.UnixMilli(created)
		out = append(out, v)
	}
	return out, rows.Err()
}
