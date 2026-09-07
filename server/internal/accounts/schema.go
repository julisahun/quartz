package accounts

// Accounts, vaults, memberships and sessions live in their own database.
//
// They cannot live in a vault's index.sqlite: that file is an index, and
// deleting it must be a recoverable act (the server rebuilds it by rescanning
// the vault). Losing the list of who exists is not recoverable, so identity
// gets a database of its own.
const schema = `
CREATE TABLE IF NOT EXISTS users (
  name          TEXT PRIMARY KEY,
  password_hash TEXT    NOT NULL,
  created       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vaults (
  id      TEXT PRIMARY KEY,          -- also the path segment in the API
  name    TEXT    NOT NULL,
  -- Vestigial. It told a private vault — the one every account used to get
  -- automatically — from a shared one. Every vault now has a membership list,
  -- so there is only one kind and nothing reads this back; it stays NOT NULL
  -- so a database written before the change opens unchanged.
  kind    TEXT    NOT NULL,
  root    TEXT    NOT NULL,
  owner   TEXT    NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  user     TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  role     TEXT NOT NULL,            -- 'owner' | 'member'
  PRIMARY KEY (user, vault_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user       TEXT    NOT NULL,
  device     TEXT    NOT NULL DEFAULT '',
  created    INTEGER NOT NULL,
  expires    INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user);
`
