# Decisions

Answers to the open questions in `~/.claude/plans/selfhosted-notes-initial-plan.md`
(section 8), settled on 2026-09-05. Recorded here so they are not silently
re-opened later.

| # | Question | Decision | Notes |
|---|---|---|---|
| 1 | Search in scope? | **Yes**, FTS5 from the start | The SQLite index is there anyway, so it costs one virtual table. Server-side from M1; the UI lands in M2. |
| 2 | Attachments and pasted images? | **Yes, v1** | Binary files ride the same `/api/file` endpoints. Paste handling in the editor is the real work, not the server. |
| 3 | Encryption at rest? | **No** | Plaintext `.md` on the Pi's SD card is what lets Obsidian keep working on the same vault — the plan's whole safety net. Protection is the Cloudflare tunnel, the home LAN, and a single account. Revisit if the vault ever leaves the house. |
| 4 | Single user forever? | **No — reversed 2026-09-06** | See below. The original plan assumed one user; it is now several people sharing vaults with each other. |
| 5 | Name and repo | **`quartz`** | `julisahun/quartz`, following `aegis` / `pirdle` / `pergamino`. |
| 6 | Vault on `home-lab` if repaired? | **No — the Pi** | `home-lab` is out of scope entirely. This workload never outgrows the Pi. |

## Multiple people (2026-09-06)

The app is for a handful of people (2–5), not only its author. That reversed
open question 4 and produced three more decisions:

| Question | Decision | Notes |
|---|---|---|
| Private or shared? | **Both — reversed 2026-09-07** | Every account owned a private vault; shared vaults have members. See "No private vaults" below: there is one kind now. |
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

## Reading a real vault (2026-09-06)

Everything until now was built against a vault of a dozen notes. Pointed at a
real one — a D&D campaign, a few hundred notes, four folders deep, frontmatter
on a third of them — four things were wrong at once. Two of them turned out to
be one bug each in the editor's oldest assumptions; the rest is new work.

| Question | Decision | Notes |
|---|---|---|
| Why did clicks land a line low? | **Vertical margins in the editor theme** | CodeMirror measures every block with `getBoundingClientRect()`, which excludes margins, so `margin-top` on a heading line adds space its height map cannot see and every click below that heading is off by the accumulated drift. Padding does the same job inside the box that is measured. `theme.test.ts` fails the build if a margin comes back. |
| The note list, in a deep vault? | **A real tree, open by default** | The flat list grouped by full path had headings longer than the titles under them. Folders open until closed, closing is remembered per vault, and opening a note opens the folders it is in — but only when the note changes, so closing the folder you are working in does not spring back open. |
| A second way to open a note? | **⌘P, fuzzy, over the path** | Names and paths only, matched on the device: it never waits on the server, which is the whole point of a switcher. The sidebar's box stays what it was — the server's FTS over what is *inside* the notes. Two boxes because they answer two different questions. |
| Ctrl-P on a Mac too? | **No** | It is CodeMirror's emacs "up a line" inside the editor. ⌘P on a Mac, Ctrl-P everywhere else. |
| Why did a table further down not render at all? | **The preview ignored the parser finishing** | CodeMirror parses a screenful and does the rest in the background; the transaction carrying the finished tree changes neither the document nor the selection, which were the only two things the decoration field watched. Everything past the first screen of a long note stayed raw markdown until a keystroke happened to rebuild it. The field now watches the tree as well. |
| Frontmatter? | **Rendered as properties** | It was not neutral before, it was wrong: `---` parsed as a horizontal rule, the YAML as a paragraph, and the closing `---` turned that paragraph into a setext heading — a note's metadata set in 24pt. It now renders as a key/value table and gives the YAML back when the cursor moves into it. |
| Which YAML? | **A subset, and honest about it** | Scalars, lists, inline `[a, b]` and block scalars (`>-`, `\|`) cover everything Obsidian writes. Anything else is shown as the lines it was written on rather than guessed at. A real YAML parser is a dependency and a second definition of what a note is. |
| Found how? | **By scanning the document, not from the parse** | The markdown parser sees one line at a time and cannot look ahead for the closing `---`; and a block that is not closed yet is not frontmatter, it is a note someone has just started typing. The nodes inside the range are then skipped, since every reading the parser has of them is wrong. |
| Markup inside table cells? | **Rendered** | Half of this vault's tables are `[[wikilinks]]`, and a cell reading `[[medalla-del-tratado\|Medalla]]` is a table you cannot read. Cells get a small second renderer — emphasis, code, links, tags, one level of nesting — and anything it does not recognise stays the text it is. The links carry the same `data-` attributes the editor's own click handler already follows. |
| `#tags`? | **Yes: a node, an index, and a filter** | Parsed into a real syntax node like `[[wikilinks]]`, so a tag inside a fence is never seen at all. The vault index collects them in the same pass that builds the backlinks, so tags cost no extra read. Clicking one filters the note list. |
| What counts as a tag? | **Obsidian's rule** | Start of a line or after whitespace, so `https://host/#anchor` and `[text](#heading)` are not tags; unicode letters, digits, `_`, `-` and `/`; never all digits, which keeps "issue #1" out. Frontmatter `tags:` counts as well, and shows as the same chips. |
| Where are tags answered? | **The local index, never the server** | FTS5 strips the `#`, so asking the server for `#objeto` would also match every note saying "objeto". The index is exact, works offline, and knows how many notes carry each tag. |
| Syntax highlighting in fences? | **Ten languages, chosen by hand** | `@codemirror/language-data` knows a hundred and loads each from its own chunk — but the service worker precaches every chunk in the build, which is what makes the app work offline, so lazy loading would become "download all hundred on install", on a phone. Ten costs ~130 KiB of precache. A fence in anything else is still legible, just uncoloured. |

Not done: the properties table is read-only — editing a property means editing
the YAML, which is one click away and is what Obsidian's source mode does too.
There is no tag pane, and no renaming a tag across the vault.

## PDFs (2026-09-06)

The vault turned out to hold 102 of them — handouts, maps, player sheets —
filed in `mundo/`, `assets/` and `players/*/` rather than in `attachments/`.
They already synced and already sat in IndexedDB on every device. They were
simply invisible: the list filtered to `.md`, and opening one landed on "that
is an attachment, not a note". The bytes were paid for; only the reading was
missing.

| Question | Decision | Notes |
|---|---|---|
| Which viewer? | **The browser's own** | `pdf.js` would add several hundred KiB to what the service worker precaches — on every install, on a phone — to avoid one tap on the one platform that lacks a viewer. A frame over a blob URL costs nothing and is the same viewer the person already trusts. |
| And where there is none? | **Hand it to one** | `navigator.pdfViewerEnabled` is the browser saying whether a frame will work. iOS says no — it renders a PDF as a whole page perfectly well and refuses to scroll one inside a page — so there the pane offers `Open` and `Save a copy` instead of a dead grey rectangle. WebKitGTK on Linux lands in the same place. |
| Which files are listed? | **Notes and PDFs** | Not every attachment: `attachments/` fills with pasted screenshots that belong to the note embedding them, not to the list. A handout does not belong to a note — it is why the folder exists. |
| `![[handout.pdf]]`? | **A card** | A scrolling document inside a scrolling note is poor on a desktop and unusable on a phone. The card carries the same `data-wikilink` every other link uses, so clicking it opens the file in the pane and nothing new had to learn about clicks. |
| ⌘P and search? | **⌘P yes, search no** | A handout is looked up by its name exactly like a note. Reading the text *inside* a PDF is a different project — extraction, an index, and a second definition of what search means. |
| What does opening one cost? | **Nothing it did not already** | `open()` used to read every file it was given and decode it as UTF-8, so opening a PDF filled the editor buffer with rubbish and memory with a copy of it. A file that is not a note is now opened by path, and its bytes go from the store to the viewer without passing through a string. |

Two things this found on the way, both older than the feature:

- **A blob had no type.** `blobUrl()` handed back `new Blob([bytes])` with no
  MIME type at all. An `<img>` sniffs its own bytes and never noticed; a PDF
  frame or a download would have shown an empty page.
- **`[[carta.pdf]]` resolved to nothing.** The resolver appended `.md` to every
  target that did not already end in it, so a link naming a file looked for
  `carta.pdf.md`. Image embeds had been quietly relying on a fallback to the
  raw path, which only worked at the vault root. A target carrying its own
  extension is now tried as the file it says it is — after the note reading, so
  a note called `Acto 3.1` still wins its own name.

Renaming a PDF now offers to update the links to it, which meant the index had
to keep what it deliberately throws away: a link to an attachment is still not
a *mention* for the backlinks strip, but it is still a link, and a rename that
broke a handout silently would be worse than the strip being noisy.

Not done: no text extraction, so search does not see inside a PDF; no page
number in a link (`[[handout.pdf#page=3]]`); and no thumbnail in the tree.

## Changing a password (2026-09-06)

"Let people reset their password" is two features wearing one name. **Changing**
one needs the session you already hold; **recovering** one needs a trust anchor
from outside the app entirely, because the person asking cannot prove anything
inside it. Only the first is built.

| Question | Decision | Notes |
|---|---|---|
| Change, or recover? | **Change only** | `POST /auth/password` needs a session *and* the current password. A forgotten password is still `quartz-admin user passwd` over SSH — recovery keeps requiring shell access, exactly as account creation does. |
| Email a reset link? | **No** | There is no address to send to: `users` is `(name, password_hash, created)`. Adding one, plus SMTP on the Pi, is precisely the machinery "no email flows" was decided against above. |
| Is this a new public surface? | **No** | It is the promotion argument applied to something smaller: an authenticated account acting on what it owns. Nothing here answers to a caller without a session. |
| Does it end the other sessions? | **Yes, and it is a checkbox** | Defaulted on. A session outlives the password it was opened with, so a change that left every device signed in would mean less than it appears to. The caller's own session is kept — signing yourself out of the device in your hand is never what was asked. |
| Its own rate limit? | **No, login's** | Checking the current password is the same oracle logging in is, so it draws on the same budget rather than being handed a fresh one. The budget is reset the moment the current password verifies, so a typo in the *new* field costs nothing. |

- **The CLI still says "existing sessions stay valid", on purpose.** An admin
  correcting a typo is not a person acting on "that password may have leaked",
  and the two should not do the same thing. The difference is the point.
- **Eight characters, because that is what `quartz-admin` and `quartz-passwd`
  already ask for.** A password set in the app and one set over SSH are held to
  one rule, and the server holds it — the sheet checks too, only to save a
  round trip.
- **Revoking is safe because a 401 has never meant "drop the queue".** A device
  signed out mid-edit keeps its pending work and asks for a password; that
  property was built for expiring sessions and this reuses it unchanged.
- **The sheet submits, rather than collecting and closing.** Every other dialog
  hands back a value, but this one can be refused by the server — a wrong
  current password, one too short — and a fresh sheet would throw away three
  filled fields to say so.

## No private vaults (2026-09-07)

`Private` was never a configuration of a vault: it *meant* "the one every
account is given when it is created". Once folders could be promoted, that
became the odd one out — a promoted folder registers with a membership list
holding only its owner, so the automatic vault was an empty directory nobody
published to, and the switcher had already stopped grouping by kind.

| Question | Decision | Notes |
|---|---|---|
| Keep two kinds? | **No** | A vault is a directory with a membership list. An account owning one vault holds the same kind of thing as an account sharing five. |
| What does an account start with? | **Nothing** | `quartz-admin user add` creates the account alone. Publishing a folder is what makes a vault, which is also the only way one gets notes in it. |
| What replaces the deletion rule? | **"Would this strand anyone else?"** | `DeleteUser` asked `kind = 'private'`; it now unregisters a vault the account owned iff no one else is a member. |
| Drop the `kind` column? | **Not yet** | It stays `NOT NULL`, written and never read, so an existing `accounts.sqlite` opens unchanged. Dropping it is a migration, and that file is the one thing here with no rebuild path. |

What fell out of it:

- **The old rule was wrong, not just redundant.** A vault its owner had never
  shared was `shared` in the schema, so deleting the account *kept* it and
  reported it as needing a new owner — when there was nobody to give it to.
  Asking about membership deletes it, and hands back its root so `-purge` can
  take the notes too.
- **`vault remove` stopped being a special case.** It used to refuse a private
  vault whose owner still existed ("remove the account instead"); it now
  refuses any vault other people are still in, which is the thing actually
  worth refusing.
- **`quartzctl` has no default vault to guess.** With no "your own" to fall
  back on, it takes the only vault, or the only one you own, and otherwise
  insists on `-vault` — syncing the wrong folder silently was the alternative.
- **A new account's first screen is an empty one.** It offers to open a folder
  and to sign out, because an account that owns nothing would otherwise be
  signed in to a blank window with no way forward and no way back.

## Files, or not (2026-09-07)

The shell cloned every synced vault the moment it was opened. Not by decision:
`root()` resolved an id it did not recognise to a directory under the vaults
base and created it, so selecting a vault made a folder appear whether or not
anybody wanted notes on that machine. A vault nobody ever used still got a
directory, and a stray note in it.

| Question | Decision | Notes |
|---|---|---|
| Who decides? | **The user, once per vault** | Asked when a synced vault is first opened. The shell can hold a vault either way and only its owner knows which; a default would be a guess with somebody's disk space. |
| What are the answers? | **In the app, or as files** | "In the app" is IndexedDB in the webview, exactly what a browser tab does — it syncs and works offline, but no folder exists. "As files" is a folder you pick. |
| Is being unasked a state? | **Yes** | `folder` / `app` / `unset`. Dismissing the question settles nothing and it comes back, which beats cloning notes on a shrug. |
| Un-clone? | **No** | Once the notes are files, going back means deleting them or leaving two stores over one folder. Cloning later is offered; the reverse is refused. |
| Where does the answer live? | **`settings.json`** | A vault kept in the app has no folder, so its answer cannot live in one. This is also why the choice survives moving vault identity into `.quartz/`. |

What fell out of it:

- **"Folder-backed" stopped being a property of the platform.** `isFolderBacked`
  answered `isDesktop() || …`, and `createVaultStore` short-circuited on the
  same thing, so the shell could not have held a vault any other way. Both now
  answer for the vault.
- **Cloning takes a path.** Pointing it at a folder that already holds the
  notes is the second-machine case, and reconcile already adopted what matched
  and conflicted only what differed — so this needed no sync work at all.
- **Eviction detection started mattering on the desktop.** It was a browser
  problem while every desktop vault was a folder; a vault kept in the app is
  in the webview's store, which can be cleared like any other.
- **The question is asked by the UI and answered into the store**, through an
  injected asker rather than an import. Everywhere else the UI asks and the
  store does — but boot opens a vault before anything is on screen, so the
  store hands the question back up rather than reaching down into the dialogs.

## Files that never arrived (2026-09-07)

talaisa loaded partway on the phone and stayed that way. One line did it:
`pull` advanced the sync cursor to the journal's `head` rather than to the last
entry it had actually applied, so the first short page of a catch-up declared
the whole journal consumed. The server pages at 5000 entries, entries count
edits rather than files, and nothing prunes them — so a device a fortnight
behind skipped everything past the first page and had no way to find out: its
cursor said it was caught up.

The damage came in three shapes, only one of which looked like a missing file.
A file whose entries all fell in the gap never arrived. One edited in the gap
sat there silently out of date. One deleted in the gap stayed on the device —
and stayed writable, so editing it pushed it back to the server under "an edit
beats a delete", and a note deleted on the laptop came back for everybody.

| Question | Decision | Notes |
|---|---|---|
| Where does the cursor come from? | **The last entry applied** | Read off the page, never from `head`. A server that miscounts `head` or `more` now costs a round trip rather than a file. |
| How does a fix reach damage already done? | **A repair marker** | A store flag; a device whose value is stale reconciles against the manifest once. The journal cannot describe its own gaps, so nothing else could have found them. |
| Is `reconcile` a repair tool? | **It is now** | It answered only for the files the manifest listed, and read any local difference as a two-writer conflict. Neither holds for a device that is merely behind. |
| Can the manifest delete anything? | **No** | It says what the server has, never what was deleted. A vault recreated under a new root, an index rebuilt over an empty directory and a restore from an older backup all look identical to a mass deletion. Only a journal entry deletes. |
| Rebuild `index.sqlite` to heal instead? | **No** | It does force every device to reconcile, but until this change reconcile turned every out-of-date file into a conflict copy and pushed it — the workaround littered the vault it was meant to repair. |

What fell out of it:

- **Reconcile is two-way.** It has to answer for local files the manifest does
  not list, or it cannot repair anything — and the answer is to offer them back
  rather than to drop them. Clearing the base hash is what does it: the file
  stops claiming to be confirmed and the push step creates it. The first
  version of this deleted them instead, which would have taken 135 files off
  a real disk; see the correction below.
- **An out-of-date file is not a conflict.** `local.hash === local.baseHash`
  over a non-empty base means the server confirmed those bytes once and has
  moved on since; there is nothing local at stake. Only an unpushed or locally
  edited difference is a genuine two-writer conflict — which is also what made
  a rebuilt index deposit a sidecar next to every file on every device.
- **A pending delete survives a rebuilt index.** Reconcile used to download the
  file back over the tombstone, undoing a delete that had not been pushed yet.
  It now follows the same rule as the journal path.
- **The fake server pages.** `FakeApi.changes` returned `more: false`
  unconditionally, which is the whole reason no test caught this. It now
  computes `more` exactly as the Go handler does, and takes a page limit.
- **The slowness is untouched.** Files are still fetched one request per
  journal entry, awaited one at a time — which is what let a device fall
  thousands of entries behind to begin with, but is a separate change.

## Its own first fix was the worse bug (2026-09-07)

The change above shipped with `reconcileMissing` deleting local files the
manifest did not list. Deployed against the real thing it would have deleted
135 of talasia's 143 files out of `~/Documents/quartz/talasia`, because the
premise was wrong: a manifest is evidence of what the server holds and never
evidence that anything was deleted.

Which is what had gone wrong in the first place, and it was not the cursor.
talasia's server-side vault had been recreated empty, so the manifest listed
11 files while the desktop's `base` map claimed 147 were confirmed — 135 of
those hashes matching the local bytes exactly. `pending()` compares
`base !== hash`, found a match, and offered nothing. The notes sat on one
machine looking perfectly synced, and every other device faithfully showed the
11 the server really had.

| Question | Decision | Notes |
|---|---|---|
| A file the manifest omits | **Offer it back** | `markPushed(path, '')` keeps the bytes and drops only the claim that the server has them, so the push step creates it. |
| Guard the empty-manifest case? | **No longer needed** | It existed only to stop deletion. Nothing deletes on manifest evidence now, and an empty manifest is exactly when refilling matters most. |
| Ghosts, then? | **They come back** | A file deleted on the server that a device never heard about is now re-uploaded rather than dropped. Repairing that is what the journal is for; the manifest cannot tell "deleted" from "lost". |
| Which way to be wrong? | **Toward keeping the note** | Being wrong this way resurrects a deleted note: visible, reversible, and already the house rule for an edit against a delete. The other way deletes somebody's notes off their own disk. |

What fell out of it:

- **The store of record cuts both ways.** The vault is authoritative, so a
  device holding notes the server has never seen is the device that is right.
  Sync had no path for that: `base` could claim a file was confirmed with
  nothing on the server to back it, and no amount of syncing questioned it.
- **The desktop shell bundles `web/dist` at build time**, so it was still
  running the old engine while the PWA had the new one. That is the only
  reason the deleting version never touched the disk — luck, not design.
- **A folder that has lost a file pushes a delete for it.** Two of croma's
  files were on the server and in the Obsidian original but missing from the
  synced folder, so the repair pass would have deleted them upstream. Working
  as designed — a file gone from the folder *is* a delete — but worth knowing
  before a repair pass runs over a folder that was copied incompletely.

## Plugins, after all (2026-09-08)

Plugins were on the non-goal list from the start, next to the graph view. The
reason still holds where it was aimed: a plugin API is a promise not to
refactor, and `state/store.ts` is 900 lines that everything routes through.
Publishing that as a contract for other people's code would make every future
change to it a breaking change, and that tax — not the loader, not the
sandbox — is what a plugin platform actually costs.

So the question was never "an API of what shape". It was two others, and the
answers make this a small feature rather than a large one:

- **Who writes them?** Only me. So this is an in-tree extension registry, and
  the API stays an internal interface that can be refactored at will.
- **Where does the code come from?** The build. Not the server, and not the
  vault — the vault was the tempting one, because it syncs to every device for
  free and it is what Obsidian does, but vaults have membership lists now.
  A plugin in a shared vault is a way for another member to run code on my
  phone, and that is a strange hole to open in an app whose API answers 404
  instead of 403 so as not to admit a vault exists.

Bundled code needs no sandbox, so plugins render real React and there is no
declarative UI vocabulary to invent and then maintain. On iOS the alternatives
were a Worker with no DOM or a sandboxed iframe with a postMessage bridge, and
the vocabulary either one needs is most of the work in a real plugin platform.

What the app itself gained is deliberately not plugin-shaped: a command
registry, named UI slots, and one `readNote` on the store. All three are
things it wanted anyway — the note actions register as commands too — and the
only file that knows the word "plugin" is `plugins/host.ts`. The test for
whether that stayed true is that `src/plugins/` can be deleted, along with two
lines of `main.tsx`, and nothing else has to change.

Two things fell out of building it:

- **A slot must render its entry as a component, not by calling `render()`.**
  Inlining the call put the plugin's hooks into the *slot's* hook list, so a
  slot gaining or losing an entry would have re-ordered the hooks of whatever
  was still in it — and a throw would have happened in the error boundary's
  own render, the one place a boundary cannot catch. The error-containment
  test found it, which is a fair argument for writing that test first.
- **The plugin takes `Quartz` as an argument**, so every one of them tests
  against a fake vault of three notes with no store, no database and no server
  anywhere near it. That was not the reason for passing it in, but it is the
  best thing about having done so.

## A settings screen, and a marketplace (2026-09-08)

Plugins shipped on, all three of them, on every device — which was the build's
switch mistaken for a person's. Deleting a line in `plugins/index.tsx` is a
developer's way to turn one off, and there was no other. So four questions,
settled in one sitting:

| Question | Decision | Notes |
|---|---|---|
| Where does the way in go? | **The bottom bar, beside the sync light** | It is the one bar that renders at both widths, so one gear serves the phone and the desktop. Beside the light rather than out at the end, so it does not move as the actions beside a note come and go. |
| What do the three bundled plugins start as? | **All off** | Being on the catalogue makes a plugin available, not running. An app that grows behaviour on update is one nobody chose — and the cost is real and accepted: the three vanish from devices that had them until they are turned back on. |
| What moves into it? | **The account** | Change password, sign out, sign in. Vault actions — switch, sync now, forget folder, keep as files — stay in the `⋯` sheet, because they act on the vault in front of you and that is where it is visible. |
| How does the marketplace read? | **Store-shaped** | A search field, installed above available, `Install` / `Remove`. The rows are a catalogue — name, author, version, a sentence — so the shape people already know how to read is the right one, with a footer saying the code ships with the app. |

The word "marketplace" promises a place code comes *from*, and this one does
not have that yet: bundling was decided in "Plugins, after all" above, and a
plugin in a shared vault is still a way for another member to run code on my
phone. So the shape is the store's and the footer is honest — these ship with
Quartz, "install" costs no download, and the list grows when the app does.

Four things fell out of building it:

- **The screen state had to become a stack.** It was one `pushed` boolean,
  which cannot answer "back to where": the gear is on the status bar, so
  settings opens over a note, and it has to come back to that note rather than
  to the list. `ui/screens.ts` came out of `app.tsx` to be tested, since
  `history` and the phone's back gesture ride on it.
- **Settings covers the app rather than replacing it.** Unmounting the two
  panes would throw away CodeMirror's undo history and cursor while somebody
  read a preference. It is `position: absolute` over the grid, with the panes
  behind it `inert`.
- **The marketplace registers itself into a fourth slot.** A settings screen
  with a hardcoded plugins block would have put plugin awareness into app code
  and broken the invariant that `src/plugins/` is deletable. So
  `settings.sections` is a slot like the other three, `SettingsView` renders it
  without knowing plugins exist, and the invariant was re-checked by actually
  removing the directory: it compiles, and 257 of the tests still pass.
- **The preference keeps ids it does not recognise.** A build without a plugin
  cannot start it, but it must not be the reason a choice about it is lost —
  downgrade, launch, upgrade, and it should still be on. That also gave
  `uninstall` a job for a plugin that is not in the catalogue at all.

Two things the screen picked up on the way, because it was the first place they
could go: this device's **name**, which is not only bookkeeping — it is in the
middle of every conflict copy's filename, read by a person choosing between two
versions — and the desktop build's **server address**, which until now could
only be set from the devtools console.

## Folders you can rename (2026-09-08)

Folders were readable and nothing else: the tree turned paths back into the
tree they came from, and there was no way to change one. Four questions,
settled in one sitting:

| Question | Decision | Notes |
|---|---|---|
| How is it reached? | **A `⋯` on the folder row** | Hover on a desktop, always there on a phone, opening the same sheet everything else uses. The row itself toggles, so the `⋯` is a second button rather than a hit test — a folder's actions must not be reachable only by opening it. A root folder has no row, so `⌘P` carries *New folder…* too. |
| A name that is taken? | **Refused, and said back** | Merging two folders is a different operation with a different blast radius and there is no undo here. The sheet stays up with the reason where the label was, because a taken name is a small correction rather than a reason to start over. |
| What happens to links? | **Only the spelled-out ones move** | A folder rename changes no file's *name*, so `[[Ossian]]` resolves by basename exactly as it did. Rewriting it would be a reformat, not a move. |
| How much folder management? | **Rename, new, delete** | Delete is the one destructive one, so the count is in the question — and it counts *files*, since a folder holds the screenshots pasted into its notes as well as the notes. |

The model is what made this small: **nothing stores a folder.** `dnd` exists
because `dnd/Ossian.md` exists and stops existing when the last file leaves, so
a rename is a set of moves and a delete is a set of deletes. Both stores with
real directories already prune the ones a delete leaves empty — `vault.rs` and
`pruneEmptyDirs` on the server — which was checked rather than assumed, and it
means no folder operation makes or removes a directory anywhere.

Four things fell out of it:

- **A spelled-out link is not broken by the move — it is worse.** The resolver
  falls back to the basename, so `[[dnd/Ossian]]` still finds the note after
  `dnd` becomes `campaign`; it just names a path that is not there, and where
  two notes share a basename the fallback can land on the other one. So those
  are rewritten and bare names are not, which is a narrower and safer
  transformation than the note rename's.
- **Renaming `dnd` to `DND` loses notes if it is done in one pass.** On a
  case-insensitive filesystem the new path is the old file, so the delete that
  follows the write takes what was just written. It goes through a staging name
  that differs by more than case, which is unambiguous on either kind of
  filesystem.
- **A rename moves every file, not every file the tree shows.** The tree lists
  notes and PDFs; a folder also holds the screenshots pasted into its notes,
  and moving only what was on screen would leave those behind, embedded from
  notes that had moved.
- **"New folder" has to make a note.** An empty folder has nothing to be
  remembered by — it would not survive a launch and would never reach another
  device — so rather than fake one in local state, the folder and its first
  note are created together.

Renaming asks for a **name**, not a path. That is what keeps the operation
honest as a rename: the folder cannot be moved elsewhere, or inside itself, by
typing — which would need a different set of guards and is a different feature.

## Files that arrived from somewhere else (2026-09-08)

A vault kept as a folder has other writers: Obsidian, Finder, `git pull`, a
download, a second device pushing to the server. The app was only ever looking
at one of them. A synced folder did discover changes, but as a side effect —
the push step lists the folder to work out what is pending, so a file dropped
in got sent — while a vault loaded from this machine looked at its folder once,
when it was opened, and never again. Notes added beside it were invisible until
the vault was switched away from and back.

| Question | Decision | Notes |
|---|---|---|
| When does it look again? | **The sync tick it already had, and the window regaining focus** | The tick ran for a loaded vault all along and did nothing with it, because there was no server to talk to; looking at the folder is what the tick is *for* there. Focus matters more than the interval: editing in Obsidian and switching over is the whole point of the folder being a folder, and a window that was never hidden fires no visibility change, so `visibilitychange` alone missed it. |
| Discovered how? | **A fresh listing, and nothing else** | Not a watcher. Both stores already list the vault on every push and every save, so this adds a trigger rather than a mechanism — and a watcher would need one implementation per platform to answer the same question a listing answers. |
| What happens to a file that appeared? | **Nothing special: it is a file with no base hash** | Which is exactly what a note created here looks like, so if the vault is synced the push step sends it without being told to. Discovery and sync are the same pass. |
| And the note on screen? | **Replaced from disk — never over unsaved typing** | The buffer is checked against the file rather than assumed to be it. Unsaved typing wins because it is the one copy nobody else has. A note that is gone from the listing closes: an editor still offering to save it would put it back without saying so. |
| How is that checked cheaply? | **The hash in the listing, against the hash of the buffer** | Hashing a few kilobytes of text beats reading the file every thirty seconds — which on the desktop is the note's bytes through an IPC round trip. On the ordinary tick, where nothing moved, this is a comparison and no read at all. |
| A vault that cannot be read? | **The console, and the last good listing left on screen** | This runs on a timer, so a notice would be the same sentence every thirty seconds. Blanking the note list reads as "your notes are gone", which is worse than a list that is briefly out of date — and choosing the vault still says so properly, which is where a folder that has been moved or unplugged is actually noticed. |

The reverse — a file that *left* — was already answered and is deliberately
asymmetric. A file missing from a folder is a pending delete, because the
folder is the vault; a file missing from the server's manifest is not evidence
of anything, and is offered to the server again. Discovery changes neither.

One thing had to move for this to be safe. A rename deletes the old path
before the new one reaches the screen, and with links to rewrite it holds that
window open for as long as the rewriting takes — from inside it the open note
is simply gone from the listing, so a rescan landing there closed the editor,
and the rename then reopened nothing, because it asked which note was open
*after* moving it. Both renames now read the open path before anything moves,
which is what `deleteFolder` already did. The old code was accidentally safe:
its refresh only ran when something had been pulled, and a rename pulls
nothing.

**What this costs:** both stores read and hash every file to list a vault. The
browser half remembers hashes by size and last-modified, so a rescan is a stat
per file; `vault.rs` does not, so on the desktop it is the whole vault re-read
and re-hashed. That was already the case every thirty seconds for a synced
folder — the push step lists it — and now it is the case for a loaded one too.
The fix if it is ever felt is the memo the browser already has, keyed on size
and mtime, not a watcher.

## A contract, and where the plugins did not go (2026-09-08)

The plugins were nearly moved to a repository of their own, for conceptual
independence. They were not, and the reason is worth writing down because the
question will come back: the independence was never about where the files sit.
The app already does not know plugins exist. A second repository would not have
added to that — it would have added a version number to keep in step with this
one, and made every change to a young API a two-repo dance.

What was actually missing is that the boundary was a comment. `host.ts` claimed
`src/plugins/` could be deleted along with two lines of `main.tsx`; `api.ts`
claimed a plugin needed nothing else. Both were true when written. Neither was
checked, which for a boundary that only matters on the day someone leans on it
is the wrong way round.

| Question | Decision | Notes |
|---|---|---|
| One repo for the plugins, or one each? | **Neither — extract the contract instead** | The unit that has to come out first is `api.ts`, not the plugins. Once `@quartz/plugin-api` is installable, repo topology stops being a question: anyone can depend on it from anywhere. And the answer is asymmetric anyway — my plugins have no reason to split, and someone else's plugin is their own repository by definition, which is not mine to choose. |
| Where does the package live? | **A workspace package in this repo** | Published-shaped but unfrozen. `host.ts` has to satisfy the interface, so while the API is young the two change together constantly, and that should stay one commit that typechecks against every plugin at once. It gets a version number and a real release the day something outside this repo depends on it. |
| Does it import the app's types? | **No — it declares its own** | `Property`, `Backlink`, `TagSummary`, `SearchHit` and `MenuItem` are declared in the package, so installing it brings none of the app's internals. The app keeps its own definitions where they belong, next to the link scanner and the client, and `contract.test.ts` fails to *compile* if the two drift. Same trade for `noteTitle`, `folderOf` and `tagKey`: seven lines said twice, because `noteTitle` has thirteen consumers here and making `Sidebar` import a path helper from the plugin API reads backwards. |
| Does `parseFrontmatter` travel with it? | **No** | It is the editor's parser — `live-preview.ts`, `widgets.ts` and `state/tags.ts` all want it — so it is the app's behaviour rather than the contract's, and a second copy would be a second set of rules for what counts as a top-level key. `fakeQuartz` has no parser and takes one instead; the properties test hands over the real one so that what it asserts is still what the real one does. |
| Does `Section` belong to the contract? | **Yes, and it carries no styles** | `sidebarSection` promises a block that is collapsed until it is opened, and `Section` is what keeps that promise. Its chevrons are inlined rather than imported from `ui/icons`. The `px-section*` class names stay the host's to theme: a package shipping its own CSS would only fight the app it runs in. |
| Plugins loaded at runtime, when someone asks? | **Not yet — and not for want of a loader** | It is feasible and cheap: `setup(q)` receives the API instead of importing it, so `host.ts` would not change, and `startPlugins` already takes its catalogue as an argument. What stops it is the promise. Outside code that loads means an API that cannot move, and this one has had three consumers, all written here — freezing it now freezes whatever is wrong with it in ways nothing has revealed yet. The trigger is the first plugin not worth cutting a release for. |
| Who would decide what is installable? | **The admin the catalogue, the device what runs** | Recorded now because the shape already exists and should not be lost: `enabled.ts` is per-device on purpose, so what runs on my phone stays mine, and a served catalogue would be `quartz-admin` work — which matches an app with no signup endpoint and CLI-only membership. A loaded plugin runs unsandboxed with the whole vault in reach, so an open registry is a different feature, not a bigger version of this one. |

Two leaks turned up the moment the rule was executable, which is the argument
for having written it: `properties` was reaching past `api.ts` into
`state/frontmatter` for a type, and `Section` into `ui/icons` for two chevrons.
Both are closed. The boundary test also asserts that the wire in `main.tsx` is
still there, because otherwise deleting it would be the cheapest way to pass.

Not done: there is no dev loop for a plugin outside `src/plugins/`. Seeing one
run still means editing the `bundled` list by hand, so anyone else's checkout
of this repo is permanently dirty — which is the actual thing blocking somebody
else from writing one, and worth more than any of the above.

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

## Images are files, not attachments (2026-09-09)

Images were openable only as an embed inside a note: `![[mapa.png]]` rendered,
but the file itself was absent from the tree and from ⌘P, and following
`[[mapa.png]]` landed on "mapa.png is an attachment, not a note". The argument
for that was that a pasted screenshot belongs to the note that embeds it.

| Question | Decision | Notes |
|---|---|---|
| Are images listed like PDFs? | **Yes** | It was wrong for the same reason it was wrong for PDFs: a vault holds maps, scans and photographs that no note happens to embed, and a file the app can display but will not list is a file you have to leave for Obsidian. |
| Which extensions? | **Everything the editor inlines** | `png`, `jpe?g`, `gif`, `svg`, `webp`, `avif`, `bmp`. One list, in `state/notes.ts`, which live preview now imports rather than keeping its own copy — a `.webp` that is an attachment while the `.png` beside it is a file is a bug nobody can explain. |
| Do the pasted screenshots show up too? | **Yes, deliberately** | The list offers what the app can display, with no exception to remember. `attach()` writes to `attachments/`, so it is one folder, and closing it is remembered per vault. Excluding it by name was the alternative and is a special case that would have to be explained every time someone filed an image there on purpose. |

`isOpenable` is still the single seam — the tree, ⌘P and the pane all ask it —
so this was one function, a viewer, and an icon. What is left over (an Obsidian
settings file, a `.zip`) is still an attachment and still belongs to the note
that references it.
