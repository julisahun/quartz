# Quartz desktop

The same web app in a Tauri window, with one difference that matters: the
storage seam is backed by **real folders** instead of IndexedDB. Each one is a
valid Obsidian vault, so both apps can have them open at once.

```
web/src/vault/types.ts        the seam
  ├── idb-store.ts            browser        (IndexedDB)
  └── desktop-store.ts        desktop        (a folder, via tauri-bridge.ts)
                                                    │
                                             src-tauri/src/vault.rs
```

The Rust side re-implements the server's rules — path checks, ignore list,
atomic writes, sha256 — so a file means the same thing in all three places.

## Where things live

| | |
|---|---|
| Vaults kept as files | wherever you cloned them; `~/Documents/quartz/<vault id>` if you did not choose. Recorded in `local` in `settings.json` |
| Vaults kept in the app | nowhere in the filesystem — IndexedDB in the webview's own store. Listed in `app_only` in `settings.json` |
| Opened folders | wherever you picked them; also `local` in `settings.json` |
| Settings | the app config directory (`~/Library/Application Support/uk.sigint-pm.quartz` on macOS) |
| Sync state | `sync-state-<vault>.json` beside the settings — **never inside a vault** |

## Files, or not

Opening a synced vault for the first time asks where it should live on this
machine, and remembers the answer per vault:

- **Keep it in the app** — nothing lands in your filesystem. The notes go to
  IndexedDB in the webview's store, exactly as they do in a browser tab, so
  they sync and work offline but no folder exists to open in Obsidian.
- **Keep it as files…** — a folder, which you pick. It may already hold a copy
  of the notes: that is the same-Obsidian-vault-on-a-second-machine case, and
  reconcile adopts what matches and conflicts only what differs.

Dismissing the question settles nothing: the vault stays closed and you are
asked again, rather than having a clone chosen for you. A vault kept in the app
can be given a folder later with **keep as files…** in the `⋯` menu.

There is no way back. Once the notes are files, un-cloning would mean deleting
them or leaving two stores over one folder, so the shell refuses.

This is why `root()` errors for a vault it has no folder for, rather than
creating one under the base: that fallback is what used to clone every synced
vault the instant it was opened.

## Opening a folder from disk

The `+` beside the vault switcher opens any folder as a vault of its own — what
Obsidian calls "open folder as vault". It belongs to no account, syncs with
nothing, and is listed only on this machine, so it works with the Pi switched
off and with no account at all: the login screen offers **Open a folder
instead**, and signing out leaves it open.

- Nothing is uploaded, and the server never learns the folder exists. The sync
  light says `local folder` rather than pretending to be up to date.
- No safety net either. A synced vault is a git repo the server commits to; a
  folder opened from disk is worth exactly what your own backups make of it.
- **forget folder** takes it off the list and deletes nothing.
- **sign in** is in the status bar, and in the `⋯` menu on a phone. A folder
  keeps the app open with no account, so nothing ever bounces you to the login
  screen — and `sync…` needs an account to publish to, so the way in has to
  stay reachable from inside.
- The id is derived from the path, so opening the same folder twice reopens it
  instead of listing it again.
- A folder under the vaults base is refused: it is already a synced vault, and
  two stores writing one directory would fight.

Chromium browsers can open a folder too, through the File System Access API,
and the app treats both the same way. The shell's version is the better one: it
records the path, so a folder stays open across restarts without the browser
asking for permission again every time.

Promoting a folder (`sync…`) re-keys its entry in `settings.json` to the id the
server gave the vault and marks it `synced`. The folder does not move, and
`root()` keeps resolving that vault to it — which is how a synced vault comes
to live outside the vaults base. Such an entry cannot be forgotten: the vault
would have nowhere left to live.

## Auth

The webview's origin is not the server's, so a session cookie would be a
third-party cookie. The desktop shell logs in with `"client": "desktop"`,
gets the session token in the response, and sends it as a bearer token. The
browser build never asks for the token and keeps using the HttpOnly cookie.

Point it at a server other than `notes.sigint-pm.uk` under **Settings → This
device → Server** — the gear beside the sync light. It is read once at start-up,
so a change takes effect on the next launch. This is the only shell that offers
it: the PWA is served by the server it syncs with, so its API is same-origin and
there is nothing to point anywhere.

## Building

```bash
npm install                  # once, for the Tauri CLI
npm run dev                  # vite dev server + the shell
npm run build                # bundles web/dist into an .app and a .dmg
cargo test --manifest-path src-tauri/Cargo.toml
```

Signing and notarisation are not set up: the first launch needs a
right-click → Open, or `xattr -dr com.apple.quarantine` on the .app.
