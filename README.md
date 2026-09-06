# quartz

A self-hosted notes app over plain folders of markdown files. Obsidian keeps
working on the same folders, which is the point: it is the fallback while the
editor is still being built.

Three musts: markdown editing, offline editing, sync across devices. Each
account gets a private vault, and vaults can be shared with other accounts.
Non-goals: graph view, plugins, canvas, publishing, real-time collaboration,
CRDT merge, Dataview queries, themes, a native mobile app.

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
server/           Go server, admin CLI and the CLI sync client
  internal/accounts   users, vaults, memberships, sessions — the only DB that matters
  internal/provision  creating accounts and vaults; the single-user migration
  internal/registry   one running vault per registered vault, opened on demand
  internal/vault      path safety, atomic writes, scanning
  internal/index      change journal, manifest, FTS5 search (one per vault)
  internal/watcher    fsnotify, so Obsidian's writes are seen
  internal/gitstore   debounced commits of a vault
  internal/service    the coordinator; the only thing that mutates a vault
  internal/httpapi    the API in "API" below
  cmd/quartz-admin    accounts and vaults (there is no signup endpoint)
  cmd/quartzctl       folder sync client (milestone 1's acceptance test)
  cmd/quartz-passwd   argon2id hash generator, for a hand-written .env
web/              the PWA (milestones 2–4, 6)
desktop/          Tauri shell (milestone 5)
deploy/           systemd unit, cloudflared snippet, Pi checklist
```

## API

| | |
|---|---|
| `POST /auth/login` | sets an HttpOnly session cookie, returns `{user, vaults}` |
| `POST /auth/logout` | clears it |
| `GET /auth/session` | who you are and what you may open |
| `GET /api/vaults` | `[{id, name, kind, owner, role}]` |
| `GET /api/v/{vault}/snapshot` | full manifest `{head, epoch, files:[…]}` |
| `GET /api/v/{vault}/changes?since=<seq>` | journal entries after a cursor, plus `head`, `epoch`, `more` |
| `GET /api/v/{vault}/file?path=<p>` | contents, `ETag: "<hash>"` |
| `PUT /api/v/{vault}/file?path=<p>` | needs `If-Match: "<hash>"` or `If-None-Match: *` → 200 / 412 / 428 |
| `DELETE /api/v/{vault}/file?path=<p>` | needs `If-Match: "<hash>"` → 204 / 412 |
| `GET /api/v/{vault}/search?q=<q>` | FTS5 hits with snippets |
| `GET /api/v/{vault}/history?path=<p>` | recent commits touching a path |
| `GET /api/v/{vault}/members` | who else can open this vault |

Every content route is under a vault, and a vault you are not a member of
answers **404**, not 403: whether someone else's vault exists is not something
this API tells you.

A `401` means "sign in again". It never means "throw away unsent edits" —
clients keep their pending queue and prompt for a re-login.

`epoch` identifies a vault's index. If the index is ever rebuilt the sequence
numbers restart, and clients notice the new epoch and reconcile from the
manifest instead of trusting a cursor that now means nothing.

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
export QUARTZ_DATA=$PWD/../data-dev
export QUARTZ_SECURE_COOKIE=false                # plain http on localhost
export QUARTZ_DEV_ORIGIN=http://localhost:5173   # for `npm run dev`

echo devpassword | go run ./cmd/quartz-admin user add juli
go run .
```

Then sync a folder against it:

```bash
go run ./cmd/quartzctl login -server http://127.0.0.1:8086 -user juli -dir /tmp/mirror
go run ./cmd/quartzctl watch -dir /tmp/mirror
```

## Accounts

There is no signup endpoint: accounts exist because someone with shell access
created them.

```bash
quartz-admin user add maria                        # creates maria + her private vault
quartz-admin vault create casa -owner juli -name "Casa"
quartz-admin vault share casa maria                # maria can now open it
quartz-admin vault list
quartz-admin user remove maria                     # keeps her notes; -purge deletes them
```

A private vault is addressed by its owner's name; shared vaults take the id you
give them, from the same namespace. Run the CLI as the user the service runs as,
so the directories it creates are owned correctly.

Tests: `go test ./...` (add `-race` before pushing).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `QUARTZ_ADDR` | `127.0.0.1:8086` | listen address |
| `QUARTZ_DATA` | `/srv/quartz` | accounts, vaults and indexes live under here |
| `QUARTZ_WEB_DIR` | *(unset)* | serve the built PWA from here |
| `QUARTZ_USER`, `QUARTZ_PASSWORD_HASH`, `QUARTZ_VAULT` | *(unset)* | only used once: with no accounts yet, these become the first account and its vault |
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

Below 46rem the layout is one screen at a time: the note list is the home
screen and a note is pushed over it as a history entry, so the back gesture of
a standalone PWA works. Above it, list and editor sit side by side as before.
The phone screens carry their own top bars — the actions live in a `⋯` sheet
rather than in the status bar, which shrinks to the sync light — and the editor
gets a scrolling markdown toolbar above the keyboard. Asking anything (a new
note's title, a rename, a delete) goes through `ui/dialogs.tsx` instead of
`prompt()`/`confirm()`. Swipe in from the left edge to go back, pull the list
down to sync, swipe a row left to uncover its delete.

Under the editor sits what links here: `3 linked mentions`, expanding to those
notes and the line each link is written on. The link map is built on the device
from the local vault, through the same `[[link]]` resolution the editor follows,
so backlinks are right offline and on a phone with no signal — and a note
nothing points at shows no strip at all.

Renaming a note takes its links with it. When something links to the note, the
rename asks first — "4 notes link to Pi setup" — and offers to update them or
to leave them; dismissing the sheet cancels the rename. Each link keeps the
shape it was written in, `#headings` and `|display text` included, and widens
to a full path only when the new name would otherwise be ambiguous.

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
| M7 | Multiple people | private vault per account, shared vaults, admin CLI; membership changes are CLI-only for now |

Deployment lives in [`deploy/README.md`](deploy/README.md).
Open questions and their answers are in [`DECISIONS.md`](DECISIONS.md).
