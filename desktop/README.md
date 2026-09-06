# quartz desktop

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
| Synced vaults | `~/Documents/quartz/<vault id>` by default; change `vaults` in `settings.json` |
| Opened folders | wherever you picked them; recorded in `local` in `settings.json` |
| Settings | the app config directory (`~/Library/Application Support/uk.sigint-pm.quartz` on macOS) |
| Sync state | `sync-state-<vault>.json` beside the settings — **never inside a vault** |

Each vault the account can open becomes a folder of its own, named after the
vault id the server uses, so a shared vault and a private one never mix.

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
- The id is derived from the path, so opening the same folder twice reopens it
  instead of listing it again.
- A folder under the vaults base is refused: it is already a synced vault, and
  two stores writing one directory would fight.

Chromium browsers can open a folder too, through the File System Access API,
and the app treats both the same way. The shell's version is the better one: it
records the path, so a folder stays open across restarts without the browser
asking for permission again every time.

## Auth

The webview's origin is not the server's, so a session cookie would be a
third-party cookie. The desktop shell logs in with `"client": "desktop"`,
gets the session token in the response, and sends it as a bearer token. The
browser build never asks for the token and keeps using the HttpOnly cookie.

Point it at a server other than `notes.sigint-pm.uk` with
`localStorage.setItem('serverUrl', 'http://127.0.0.1:8086')` in the devtools
console.

## Building

```bash
npm install                  # once, for the Tauri CLI
npm run dev                  # vite dev server + the shell
npm run build                # bundles web/dist into an .app and a .dmg
cargo test --manifest-path src-tauri/Cargo.toml
```

Signing and notarisation are not set up: the first launch needs a
right-click → Open, or `xattr -dr com.apple.quarantine` on the .app.
