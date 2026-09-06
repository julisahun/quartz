# Decisions

Answers to the open questions in `~/.claude/plans/selfhosted-notes-initial-plan.md`
(section 8), settled on 2026-09-05. Recorded here so they are not silently
re-opened later.

| # | Question | Decision | Notes |
|---|---|---|---|
| 1 | Search in scope? | **Yes**, FTS5 from the start | The SQLite index is there anyway, so it costs one virtual table. Server-side from M1; the UI lands in M2. |
| 2 | Attachments and pasted images? | **Yes, v1** | Binary files ride the same `/api/file` endpoints. Paste handling in the editor is the real work, not the server. |
| 3 | Encryption at rest? | **No** | Plaintext `.md` on the Pi's SD card is what lets Obsidian keep working on the same vault — the plan's whole safety net. Protection is the Cloudflare tunnel, the home LAN, and a single account. Revisit if the vault ever leaves the house. |
| 4 | Single user forever? | **No — reversed 2026-09-06** | See below. The original plan assumed one user; it is now several people, each with a private vault, plus shared vaults. |
| 5 | Name and repo | **`quartz`** | `julisahun/quartz`, following `aegis` / `pirdle` / `pergamino`. |
| 6 | Vault on `home-lab` if repaired? | **No — the Pi** | `home-lab` is out of scope entirely. This workload never outgrows the Pi. |

## Multiple people (2026-09-06)

The app is for a handful of people (2–5), not only its author. That reversed
open question 4 and produced three more decisions:

| Question | Decision | Notes |
|---|---|---|
| Private or shared? | **Both** | Every account owns a private vault; shared vaults have members. |
| How are accounts made? | **An admin CLI, `quartz-admin`** | No signup endpoint exists, so there is nothing public to attack. Membership changes are CLI-only too. |
| How many people? | **2–5** | No quotas, no email flows. Worth revisiting past ~25. |

What this changed, and what it deliberately did not:

- **A vault became a first-class thing** — its own directory, git repo, change
  journal, index and watcher — and the server holds a registry of them, opened
  on demand. Content routes moved under `/api/v/{vault}/`.
- **Identity moved out of the vault index** into `accounts.sqlite`. A vault
  index must stay disposable; the list of who exists is not.
- **The sync algorithm did not change at all.** Conflict copies, the pending
  queue, the offline behaviour and the editor were untouched, because a vault
  was always the unit of sync — it just belongs to someone now.
- **A vault you cannot open answers 404**, so the API never confirms that
  someone else's vault exists.
- **The existing single-user deployment migrates itself**: with no accounts
  yet, `QUARTZ_USER` / `QUARTZ_PASSWORD_HASH` / `QUARTZ_VAULT` become the first
  account and its vault, adopted where it stands rather than moved.

Not done, and worth knowing before inviting anyone: **the vault directory is
still the only copy of their notes** (one SD card, no off-box backup), and
sharing is managed over SSH rather than in the app.

## The phone UI (2026-09-06)

M6 made the app survive on iOS; this made it pleasant there. Eight questions,
settled in one sitting:

| Question | Decision | Notes |
|---|---|---|
| Drawer or screens on a phone? | **Screens** | The list is the home screen and a note is pushed over it, as a `history` entry, so the PWA's back gesture means something. The drawer is gone; above 46rem both panes show at once, as before. |
| A toolbar above the keyboard? | **Yes, the full strip** | Markdown is punctuation and a phone keyboard buries punctuation two layers down. Undo, bold, italic, heading, bullet, task, quote, code, link, `[[wikilink]]`, indent, outdent, attach — scrolling, with "hide the keyboard" pinned at the end. |
| Keep `prompt()` / `confirm()`? | **No — sheets** | Unstyleable, safe-area-blind, and foreign inside a standalone PWA or the Tauri shell. Same promise-shaped call site, so asking stays a one-liner. |
| How wide do the changes reach? | **Shared** | Touch targets, sheets and menus apply everywhere; only the layout branches on width. One codepath, and the Tauri app gets it too. |
| Where do the actions live? | **A `⋯` sheet per screen** | Vault switch, sync and sign-out on the list; preview toggle, rename and delete on the note. The status bar shrinks to the sync light and the queue count. |
| A picker for attachments? | **Camera, library and files** | Paste and drop are desktop gestures. An unrestricted file input is what makes iOS offer all three. |
| Keep `maximum-scale=1`? | **No** | Blocking pinch-zoom fails WCAG 1.4.4 and takes magnification away from the people who need it. Every field is at least 16px instead, which is what actually stops iOS zooming on focus. |
| Which gestures? | **Back, pull-to-sync, swipe-to-delete** | The back swipe is gated to the left edge so it cannot fight text selection. The delete swipe only *reveals* the button — the vault is one SD card. |

## Backlinks (2026-09-06)

`[[note references]]` were the plan's one nice-to-have (§1). Backlinks are the
half that makes them worth writing; the graph view stays a non-goal.

| Question | Decision | Notes |
|---|---|---|
| Computed where? | **On the client, from the local vault** | Every note is already on the device, so backlinks work offline like the rest of the app, and link resolution has one implementation (`buildResolver`), shared with the editor. A server-side `links` table would need a second copy of Obsidian's resolution rules in Go — and a backlink that disagreed with the link you clicked would open the wrong note. |
| What counts as a link? | **`[[wikilinks]]` and `![[embeds]]`** | Exactly what the editor already parses, so what the panel counts and what a click follows cannot drift. Markdown `[text](note.md)` links are not counted: nothing in the vault writes them, and they would need a second scanner. A link to an attachment is not a mention of a note, and a note does not link to itself. |
| Unlinked mentions? | **No** | Obsidian's second list — notes containing the title as plain text. It costs a full-text scan per note opened and is noise for any short title. Search already answers that question, and better. |
| Where does it show? | **A collapsible strip under the editor** | One codepath for the phone and the desktop, and where Obsidian puts it. Collapsed it is a single row, `3 linked mentions`; expanded it lists the notes with the line each link is written on. Open or closed is remembered. |
| A note nothing links to? | **Show nothing at all** | On a phone the strip would cost a row of the editor to say "0", and in a young vault most notes have no inbound links yet. |
| Rewrite links on rename? | **Yes — reversed the same day** | It was deferred as its own piece of work, and then done. See below. |

## Renaming (2026-09-06)

Backlinks made this possible — knowing who points at a note is most of the
work — and a rename that silently breaks every link to it was not worth
keeping once the panel made the breakage visible.

| Question | Decision | Notes |
|---|---|---|
| Automatic, or ask? | **Ask — but only when there is something to ask** | A note nothing links to is renamed on the spot, as before. When something does link to it, a sheet says how many notes and offers "rename and update them" or "rename only". Rewriting other people's notes is not a side effect to discover afterwards. |
| What does dismissing mean? | **Cancel the whole rename** | The sheet is a three-way question and the third answer is "actually, don't". Treating a dismiss as a quiet "rename only" would make a shrug into a decision about someone's links. |
| How is a link rewritten? | **In the shape it was written in** | `[[Pi setup]]` becomes `[[Pi]]`, `[[notes/Pi setup.md]]` becomes `[[notes/Pi.md]]`. `#headings`, `\|display text` and the `!` of an embed are kept; the display text is the author's words, not ours. A rename should read as a change of name, not as someone reformatting your prose. |
| A new name that is ambiguous? | **Widen the link to the full path** | If another note already answers to the new basename, `[[Name]]` would resolve to a stranger. The link becomes `[[folder/Name]]` instead, which is the only form that still means what it meant. |
| Links inside code? | **Left alone** | Reading and rewriting share one walk over the note (`scan`), so a `[[link]]` in a fence is invisible to both. It cannot be counted in the panel and then quietly rewritten anyway. |
| The conflict risk? | **Accepted** | One rename can dirty N notes, and each is pushed with `If-Match` like any other edit — so each can lose to another device and produce a conflict copy. That is the sync model working, not a new hazard, and both versions survive either way. |

Not done: nothing repairs the links if the app dies halfway through the
rewrite. The notes already written point at the new name, the rest still point
at the old one, and the fix is to rename it back or edit them by hand.

## Folders opened from disk (2026-09-06)

Every vault until now belonged to an account and came from the server. A folder
opened from disk belongs to nobody: it syncs with nothing, is listed only on
the device that opened it, and is the one way to use the app with the Pi
switched off — or with no account at all.

| Question | Decision | Notes |
|---|---|---|
| Sync it somehow? | **No, never** | A local vault gets a store and a link index but no `SyncEngine` at all, so no code path exists that could push a private folder to the server. "It syncs with nothing" is a property of the wiring rather than a flag that could be set wrong. |
| Where can one be opened? | **The desktop shell, and Chromium** | The shell uses a native picker, a browser the File System Access API. Safari and Firefox implement only the Origin Private File System — a sandbox the browser owns, not a picker onto your own directories — so on iOS there is no such thing, and the UI is gated on `foldersSupported()` rather than on being the desktop. |
| One implementation or two? | **One, over two bridges** | `FolderVaultStore` holds the folder semantics; Tauri commands and the File System Access API supply the same `FolderBridge` underneath. A folder means one thing in both. The ignore list is the only rule copied by hand, into a third place beside the server's and the shell's. |
| What identifies a folder? | **The path, where there is one** | The shell derives an id from the path, so opening the same folder twice reopens it. A browser is never told where a folder is, so the id is random and sameness is decided by `isSameEntry`. Both produce `local-<12 hex>`, and nothing above the bridge knows which answered. |
| A permission that lapses? | **Ask on the click, never on launch** | A directory handle survives a restart in IndexedDB; its permission usually does not. `requestPermission` only works while a click is still fresh, so launch picks a vault it can already open, and a folder needing re-granting says so rather than coming back empty. |
| Forgetting one? | **Off the list, nothing deleted** | The confirmation carries the whole weight of this, so it says where the notes stay. |
| A folder already under the vaults base? | **Refused** | It is a synced vault already, and two stores writing one directory would fight. |

Not done: a folder from disk has no safety net. A synced vault is a git repo
the server commits to; this is worth exactly what your own backups make of it.
Nothing says so beyond the docs. In a browser it is also only as durable as
the handle in IndexedDB — site data cleared means the folder has to be picked
again, though nothing in it is lost.

## Syncing a folder (2026-09-06)

Opening folders from disk left two species of vault that could never meet: one
made by `quartz-admin` that could only ever sync, one opened from disk that
could only ever stay put. That was an artifact of building accounts first and
folders last, not a position. This collapses them.

There is one kind of vault: a folder of notes. Sync is a property it may gain.

| Question | Decision | Notes |
|---|---|---|
| Two kinds, or one? | **One, with or without sync** | A vault opens local and stays local until asked otherwise. What used to be a "server vault" is just a vault that has been promoted, seen from a device that has synced it. |
| How does one gain sync? | **Promotion, by its owner, deliberately** | Never from the same menu as opening a folder: "this leaves your machine" earns its own step. |
| Who can promote? | **The signed-in account, for a vault it owns** | This reverses "vault changes are CLI-only" from the multiple-people decision above. An authenticated account creating a vault it owns is a far smaller surface than a signup endpoint — but it is a reversal, made on purpose. Adding *other accounts* to a vault stays CLI-only. |
| Available to whom? | **The account, everywhere** | No device logic. Promotion is not "share from this laptop"; it makes the vault one of the things `/api/vaults` lists for that user, and any device they sign into can sync it. |
| Copy, or reach back to the device? | **The Pi takes its own copy** | Promotion uploads once and the server owns a copy from then on, with its own git repo, index and watcher like any other vault. No device has to be reachable for another device to sync — the server is the store of record, exactly as it already was. |
| Un-sync? | **Not for now** | Nothing demotes a vault or takes it off the server. The answer is the CLI, over SSH. Worth revisiting only once something actually wants it; deciding it badly now would be worse than leaving it out. |

And the four that came with it:

| Question | Decision | Notes |
|---|---|---|
| What is it called on the server? | **The promotion asks** | One field, pre-filled from the folder's name, and the id derived from it (`slugForVault`) is shown back before anything is created. A name already taken is a 409 saying so — the read routes answer 404 to hide whether a vault exists, but this is a name the user is choosing and "taken" is what they need to hear. |
| What stops a 40 GB folder? | **`QUARTZ_MAX_VAULT_MB`, default 2048** | Checked against the size the client declares, before the vault is created, so an oversize promotion fails with a number instead of half-filling the SD card. It is a guard against a mistake, not against a client that lies — signing in already means being trusted with the disk you write to. |
| Where does the folder end up? | **Exactly where it was** | The shell's folder entry is re-keyed to the server's id and marked synced; `root()` already resolved a vault by that table first, so the path override was mostly already there. Nothing is moved: a promotion is about where notes are published, not about where somebody keeps them. |
| A second device onto an existing copy? | **Adopt what matches, conflict only what differs** | Already how `reconcile()` worked: a local file whose hash equals the server's is marked clean instead of pushed. The case this was feared for — the same Obsidian vault on two machines — was already the case it handled. No change, and `engine.test.ts` covers it. |

Two things fell out of the shape rather than being chosen:

- **A promoted vault is `shared` in the schema**, because "shared" means a vault
  with a membership list and "private" means the one every account gets
  automatically. It holds only its owner until the CLI adds anyone. The switcher
  therefore groups by *owner*, not by kind — filing your own notes under
  "Shared" would be a lie about them.
- **Forgetting a promoted folder is refused.** It would leave a synced vault
  with nowhere to live, and it would quietly re-download somewhere else. With
  no un-syncing, saying no beats half-doing it.

## Decisions taken while building

- **Pure-Go SQLite** (`modernc.org/sqlite`) rather than `mattn/go-sqlite3`, so
  the binary stays CGO-free and cross-compiles to the Pi from a hosted runner.
  FTS5 is compiled in, which is what makes decision 1 free.
- **The server serves the PWA itself** (`QUARTZ_WEB_DIR`) instead of a second
  nginx vhost: one origin for the app and the API means the session cookie and
  the service worker just work, and one cloudflared ingress rule covers both.
- **Preconditions are mandatory on every write.** `If-Match: <hash>` to replace,
  `If-None-Match: *` to create; a request with neither is refused with 428.
  There is no way to blind-write over another device's edit.
- **`.quartz*` is a reserved prefix** in the vault: temp files during atomic
  writes and the CLI's sync state live there and are never synced.
- **The watcher is registered before the startup reconciliation**, not after,
  so a write landing during startup cannot fall between the two.
- **The delete button slides in over the row** rather than the row sliding out
  from under it. Note titles are short: a row that shifts a button's width to
  the left has nothing left to read.
- **Backlinks are parsed with a regular expression**, not the markdown parser.
  A rebuild runs over every note whose hash moved, where standing up a
  CodeMirror parse per note would be pointless. Fenced blocks and backtick
  spans are skipped, so the two still agree on what a link is: `[[like this]]`
  inside a fence is a worked example, not a reference.
- **Parsing is incremental, resolution is not.** A note is re-read only when
  its hash changes, but every link is resolved again on each rebuild — because
  a link's target depends on which notes exist, and creating `Pi setup.md`
  turns every `[[Pi setup]]` written before it into a real link.
- **A rename saves the buffer first.** It used to copy whatever the debounced
  save had last managed to store, so renaming mid-sentence dropped the last
  half-second of typing. What is on screen is what ends up under the new name.
