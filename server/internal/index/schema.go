package index

const schema = `
CREATE TABLE IF NOT EXISTS changes (
  seq   INTEGER PRIMARY KEY AUTOINCREMENT,
  path  TEXT    NOT NULL,
  op    TEXT    NOT NULL,               -- 'put' | 'del'
  hash  TEXT    NOT NULL DEFAULT '',
  mtime INTEGER NOT NULL DEFAULT 0,
  size  INTEGER NOT NULL DEFAULT 0,
  ts    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS changes_path_idx ON changes(path);

-- Current manifest. A cache of what Scan() would return; the disk wins.
CREATE TABLE IF NOT EXISTS files (
  path  TEXT PRIMARY KEY,
  hash  TEXT    NOT NULL,
  mtime INTEGER NOT NULL,
  size  INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  path UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  device     TEXT    NOT NULL DEFAULT '',
  created    INTEGER NOT NULL,
  expires    INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`
