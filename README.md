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
| `POST /api/vaults` | promotes a folder: `{id, name, bytes}` → the new vault, owned by you |
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
| `QUARTZ_MAX_VAULT_MB` | `2048` | the most a folder may be when it is promoted |
| `QUARTZ_DEV_ORIGIN` | *(unset)* | extra CORS origin for the Vite dev server |

## The web app

`web/` is one frontend for all three shells. Everything it stores goes through
`src/vault/types.ts` — the seam — so where a vault actually sits is decided in
one place: IndexedDB for anything synced in a browser, and a real folder both
for the desktop shell and for a folder opened from disk in Chromium.

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
blockquotes, code fences, horizontal rules, tables, `#tags` and YAML
frontmatter. Code fences keep their visible-but-dimmed ``` markers rather than
disappearing, which keeps the cursor's path through a fence obvious, and a
fence with a language on it is highlighted — ten of them are bundled, and the
rest are simply not coloured.

Nothing in the theme uses a vertical margin. CodeMirror measures blocks with
`getBoundingClientRect()`, which does not count margins, so a margin puts its
height map out by that much and clicks start landing a line low. Space is
padding, and `theme.test.ts` keeps it that way.

Frontmatter renders as the properties it is — key on the left, value on the
right, `tags:` as chips — and gives the YAML back when the cursor moves into
it. A block only counts once its closing `---` is there, so a half-typed one is
still an ordinary note. Tables render their cells' markup, links included,
which in a vault where half a table is `[[wikilinks]]` is the difference
between a table and a wall of brackets.

PDFs are listed in the tree beside the notes and open in the pane, through the
browser's own viewer — the vault's handouts are half of why its folders exist.
`![[handout.pdf]]` renders as a card rather than a page inside a page, and
`[[handout.pdf]]` finds the file wherever it is filed. iOS has no viewer it
will scroll inside a frame, so there the card offers to open it whole, which
iOS does perfectly well. Nothing is bundled to do any of this.

The note list is the vault's folders, open by default; closing one is
remembered per vault, and opening a note opens the folders it is in. The line
between the list and the note is a handle — drag it, or hold it and use the
arrow keys, and double-click it to put it back at 17rem. **⌘P**
(Ctrl-P away from a Mac) is the switcher: fuzzy over the whole path, matching
on the device and never waiting on the server, so `mbacero` finds
`campaigns/marea-baja/objects/acero-del-manantial`. The search box above the
list is the other half — it asks the server what is *inside* the notes — and a
query starting with `#` is a tag, answered from the local index instead:
clicking a tag anywhere in the editor puts it there.

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

## Folders opened from disk

Any folder can be opened as a vault of its own: no account, no server, no
sync, and listed only on the device that opened it. It is the one way to use
quartz with the Pi switched off, and the login screen offers it, so a machine
with no account is not a machine with no notes.

The desktop shell opens one through a native picker. Chromium browsers do it
through the File System Access API — Safari and Firefox implement only the
sandbox half of that API and not a picker onto your own folders, so on iOS
there is no such thing and the button is not shown. A browser also has to ask
for the folder again after a restart: the handle survives, the permission does
not, so a folder needing re-granting says so and is opened by choosing it.

Nothing about these reaches the Pi until you ask it to, and nothing commits
them to git. A synced vault has the server's history behind it; a folder from
disk is worth what your own backups make of it.

**Syncing one.** A folder can be published to the server — `sync…` in the
status bar, or the phone's `⋯` menu — which asks what to call it, shows the id
it will take, and then creates a vault of your own and uploads the folder into
it. From then on it is a vault like any other and every device you sign in on
can open it. The folder does not move; it goes on being the copy on that
machine.

The server takes its own copy, so no device has to be reachable for another to
sync. A second device that already holds the same notes adopts every file whose
hash matches rather than conflicting with itself — pointing two machines at one
Obsidian vault is the case this handles, not the case that breaks it.

Nothing in the app un-does this. Removing a vault from the server is
`quartz-admin` over SSH, and a folder that has been promoted can no longer be
forgotten from the list, since that would leave the vault with nowhere to live.

## Where each milestone stands

| | | |
|---|---|---|
| M0 | Safety net | vault is a git repo, deleted notes recoverable; off-box backup still open |
| M1 | Server + sync | done — API, watcher, journal, git, `quartzctl` |
| M2 | Read-only client | done — PWA, offline reads, FTS5 search |
| M3 | Editing + sync | done — pending queue, `If-Match` push, conflict sidecars |
| M4 | Live preview | done for the construct list above |
| M5 | Tauri desktop | shell builds, the seam is swapped, folders open from disk; signing and updates are not set up |
| M6 | iOS hardening | persistent storage, eviction recovery, keyboard-aware scrolling; the escape hatch has not been needed |
| M7 | Multiple people | private vault per account, shared vaults, admin CLI; membership changes are CLI-only for now |

Deployment lives in [`deploy/README.md`](deploy/README.md).
Open questions and their answers are in [`DECISIONS.md`](DECISIONS.md).
