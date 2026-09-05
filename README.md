# quartz

A self-hosted notes app over a plain folder of markdown files. Obsidian keeps
working on the same vault, which is the point: it is the fallback while the
editor is still being built.

Three musts: markdown editing, offline editing, sync across devices.
Non-goals: graph view, plugins, canvas, publishing, multi-user, real-time
collaboration, CRDT merge, Dataview queries, themes, a native mobile app.

## How it fits together

```
  iOS PWA ─┐
laptop PWA ├─ same frontend ─┐
Tauri app ─┘                 │  HTTPS (session cookie)
                             ▼
              cloudflared @ Pi ──► 127.0.0.1:8086  quartz (Go, systemd)
                                          │
                                          ├─ /srv/quartz/vault   ← plain .md, a git repo
                                          ├─ fsnotify watcher    ← catches Obsidian's writes
                                          └─ index.sqlite        ← change journal + search
                                          
              Obsidian (desktop/mobile) ──┘  writes the same vault directly
```

The vault is the store of record. SQLite is an index and is disposable: delete
it and the server rebuilds it by rescanning the vault on startup.

## Layout

```
server/           Go server and the CLI sync client
  internal/vault      path safety, atomic writes, scanning
  internal/index      change journal, manifest, FTS5 search, sessions
  internal/watcher    fsnotify, so Obsidian's writes are seen
  internal/gitstore   debounced commits of the vault
  internal/service    the coordinator; the only thing that mutates the vault
  internal/httpapi    the API in "API" below
  cmd/quartzctl       folder sync client (milestone 1's acceptance test)
  cmd/quartz-passwd   argon2id hash generator for QUARTZ_PASSWORD_HASH
web/              the PWA (milestones 2–4, 6)
desktop/          Tauri shell (milestone 5)
deploy/           systemd unit, cloudflared snippet, Pi checklist
```

## API

| | |
|---|---|
| `POST /auth/login` | sets an HttpOnly session cookie |
| `POST /auth/logout` | clears it |
| `GET /auth/session` | 200 while signed in |
| `GET /api/snapshot` | full manifest `{head, files:[{path,hash,size,mtime}]}` |
| `GET /api/changes?since=<seq>` | journal entries after a cursor, plus `head` and `more` |
| `GET /api/file?path=<p>` | contents, `ETag: "<hash>"` |
| `PUT /api/file?path=<p>` | needs `If-Match: "<hash>"` or `If-None-Match: *` → 200 / 412 / 428 |
| `DELETE /api/file?path=<p>` | needs `If-Match: "<hash>"` → 204 / 412 |
| `GET /api/search?q=<q>` | FTS5 hits with snippets |
| `GET /api/history?path=<p>` | recent commits touching a path |

A `401` means "sign in again". It never means "throw away unsent edits" —
clients keep their pending queue and prompt for a re-login.

## Sync in one paragraph

Each client tracks a cursor into the change journal and, per file, the hash the
server last confirmed. **Pull:** apply remote changes to files that are clean;
leave dirty ones alone. **Push:** `PUT` each dirty file with `If-Match`. A 412
means the server moved on, so the local buffer is written to
`note (conflict <device> <date>).md`, that copy is pushed as a new file, and the
server's version becomes the local one. Both survive, and both show up in
Obsidian. Deletes use the same precondition; a delete that loses to an edit is
dropped and the file comes back.

## Running it locally

```bash
cd server
export QUARTZ_VAULT=$PWD/../vault-dev
export QUARTZ_INDEX=$PWD/../vault-dev-index.sqlite
export QUARTZ_PASSWORD_HASH="$(go run ./cmd/quartz-passwd -stdin <<< 'devpassword')"
export QUARTZ_SECURE_COOKIE=false      # plain http on localhost
export QUARTZ_DEV_ORIGIN=http://localhost:5173   # for `npm run dev`
go run .
```

Then sync a folder against it:

```bash
go run ./cmd/quartzctl login -server http://127.0.0.1:8086 -user juli -dir /tmp/mirror
go run ./cmd/quartzctl watch -dir /tmp/mirror
```

Tests: `go test ./...` (add `-race` before pushing).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `QUARTZ_ADDR` | `127.0.0.1:8086` | listen address |
| `QUARTZ_VAULT` | `/srv/quartz/vault` | the vault |
| `QUARTZ_INDEX` | `/srv/quartz/index.sqlite` | rebuildable index |
| `QUARTZ_WEB_DIR` | *(unset)* | serve the built PWA from here |
| `QUARTZ_USER` | `juli` | the only account |
| `QUARTZ_PASSWORD_HASH` | *(required)* | argon2id PHC string |
| `QUARTZ_SESSION_TTL_DAYS` | `90` | sliding session lifetime |
| `QUARTZ_SECURE_COOKIE` | `true` | set false for plain-http local dev |
| `QUARTZ_GIT` | `true` | commit vault changes |
| `QUARTZ_GIT_DEBOUNCE_SECONDS` | `30` | quiet period before committing |
| `QUARTZ_MAX_FILE_MB` | `64` | attachment size limit |
| `QUARTZ_DEV_ORIGIN` | *(unset)* | extra CORS origin for the Vite dev server |

## The web app

`web/` is one frontend for all three shells. Everything it stores goes through
`src/vault/types.ts` — the seam — so the browser (IndexedDB) and the desktop
(a real folder) differ in one file and nothing else.

```bash
cd web
npm install
npm run dev        # proxies /api and /auth to 127.0.0.1:8086
npm test           # sync engine, live preview, path helpers
npm run build
```

Live preview is a CodeMirror 6 StateField that hides markup and puts it back on
the line you are editing. Constructs were added one at a time: headings,
emphasis, inline code, lists, checkboxes, links, `[[wikilinks]]`, image embeds,
blockquotes, code fences, horizontal rules, tables. Code fences keep their
visible-but-dimmed ``` markers rather than disappearing, which keeps the
cursor's path through a fence obvious.

The desktop shell is in [`desktop/`](desktop/README.md).

## Where each milestone stands

| | | |
|---|---|---|
| M0 | Safety net | vault is a git repo, deleted notes recoverable; off-box backup still open |
| M1 | Server + sync | done — API, watcher, journal, git, `quartzctl` |
| M2 | Read-only client | done — PWA, offline reads, FTS5 search |
| M3 | Editing + sync | done — pending queue, `If-Match` push, conflict sidecars |
| M4 | Live preview | done for the construct list above |
| M5 | Tauri desktop | shell builds and the seam is swapped; signing and updates are not set up |
| M6 | iOS hardening | persistent storage, eviction recovery, keyboard-aware scrolling; the escape hatch has not been needed |

Deployment lives in [`deploy/README.md`](deploy/README.md).
Open questions and their answers are in [`DECISIONS.md`](DECISIONS.md).
