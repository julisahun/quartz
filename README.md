# Quartz

A self-hosted notes app over plain folders of markdown files. Obsidian keeps
working on the same folders, which is the point: it is the fallback while the
editor is still being built.

Three musts: markdown editing, offline editing, sync across devices. A vault is
a folder of markdown files with a membership list; an account makes one by
publishing a folder, and can share it with other accounts.
Non-goals: graph view, canvas, publishing, real-time collaboration, CRDT
merge, a Dataview query language, themes, a native mobile app.

## How it fits together

```
  iOS PWA ─┐
laptop PWA ├─ same frontend ─┐
Tauri app ─┘                 │  HTTPS (session cookie)
                             ▼
              cloudflared @ Pi ──► 127.0.0.1:8086  Quartz (Go, systemd)
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
  src/plugins         what is bundled on top of it — the only plugin-aware code
desktop/          Tauri shell (milestone 5)
deploy/           systemd unit, cloudflared snippet, Pi checklist
```

## API

| | |
|---|---|
| `POST /auth/login` | sets an HttpOnly session cookie, returns `{user, vaults}` |
| `POST /auth/logout` | clears it |
| `GET /auth/session` | who you are and what you may open |
| `POST /auth/password` | changes your own password: `{current, next, signOutOthers}` → `{signedOut}` |
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
quartz-admin user add maria                        # the account only; it owns nothing yet
quartz-admin vault create casa -owner juli -name "Casa"
quartz-admin vault share casa maria                # maria can now open it
quartz-admin vault list
quartz-admin user remove maria                     # keeps her notes; -purge deletes them
```

A vault takes the id you give it, and all of them share one namespace — the
same one the API uses as a path segment. An account starts out owning nothing:
publishing a folder from the app is what creates a vault, so a new account's
first screen is an empty one offering to open a folder. Run the CLI as the user
the service runs as, so the directories it creates are owned correctly.

A signed-in account can change **its own** password in the app — `password…` in
the status bar, or the phone's `⋯` menu — which asks for the current one and
offers to sign the account's other devices out. That is a change, not a
recovery: it needs the password you already have. Someone who has *forgotten*
theirs still needs `quartz-admin user passwd`, because there is no reset link
and no address to send one to.

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
`campaigns/marea-baja/objects/acero-del-manantial`. Typing `>` turns it into
the command list instead. The search box above the
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

## Plugins

Plugins were a non-goal for a long time, and for a good reason: a plugin API is
a promise not to refactor, and nothing here was finished enough to make one.
What changed is the shape. These are **compiled in, not installed** — there is
no loader, no sandbox and no registry, `web/src/plugins/index.ts` lists what
ships, and turning one off is deleting a line.

That is what keeps the cost near zero. Bundled code needs no CSP relaxation,
works offline and on iOS like the rest of the app, and renders real React
instead of through some declarative vocabulary invented to keep a Worker at
arm's length. It is also why the API is a convention rather than a wall: a
plugin can import any module in the tree, and the small surface only marks
what is meant to keep working.

**The app does not know plugins exist.** It gained three general mechanisms
instead, each of which it wanted anyway:

| | |
|---|---|
| `state/commands.ts` | the command registry — ⌘P behind `>`; the note actions register into it too |
| `ui/Slot.tsx` | named places (`sidebar.sections`, `status.items`, `note.panels`) that render whatever is in them |
| `readNote(path)` | one method on the store: a note's text |

`src/plugins/host.ts` is the only file that knows what a plugin is. Delete
`src/plugins/` and the two lines in `main.tsx` that start it, and nothing else
in the tree has to change — which is the measure of whether this stayed
honest, so there is a test that checks it.

A plugin is an id, a name, and a `setup(q)` that registers things:

```tsx
export const wordCount: QuartzPlugin = {
  id: 'word-count',
  name: 'Word count',
  setup(q) {
    q.ui.statusItem({ id: 'count', render: () => <Count q={q} /> })
  },
}
```

`q` is the whole surface — `q.vault` to read and write notes, `q.commands` to
add one to ⌘P, `q.ui` for the slots, the notice strip and the sheets. Everything
a plugin registers is namespaced by its id and undone by the host's teardown,
so two plugins may both call their command `today`. A plugin that throws on the
way up does not stop the others, and one that throws while rendering costs its
own slot and nothing else.

Three ship:

| | |
|---|---|
| **By property** | a sidebar section grouping notes by a frontmatter property, discovered from the notes that have one. Scans only while it is open |
| **Daily note** | `Open today's note` / `Open yesterday's note`, writing `journal/YYYY-MM-DD.md` from a template |
| **Word count** | how long the open note is, from the editor's buffer rather than the last save |

The rule they are held to: **a plugin must not make notes worse in Obsidian.**
Nothing here invents syntax or writes a sidecar file. The property panel is a
query that lives in the sidebar rather than inside a note precisely so there is
nothing to go stale in the other editor — which is what the vault being the
store of record costs, and buys.

## Folders opened from disk

Any folder can be opened as a vault of its own: no account, no server, no
sync, and listed only on the device that opened it. It is the one way to use
Quartz with the Pi switched off, and the login screen offers it, so a machine
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
| M7 | Multiple people | vaults with membership lists, admin CLI; membership changes are CLI-only for now |

Deployment lives in [`deploy/README.md`](deploy/README.md).
Open questions and their answers are in [`DECISIONS.md`](DECISIONS.md).
