# quartz desktop

The same web app in a Tauri window, with one difference that matters: the
storage seam is backed by a **real folder** instead of IndexedDB. That folder
is a valid Obsidian vault, so both apps can have it open at once.

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
| Vault | `~/Documents/quartz` by default; change `vault` in `settings.json` |
| Settings | the app config directory (`~/Library/Application Support/uk.sigint-pm.quartz` on macOS) |
| Sync state | `sync-state.json` beside the settings — **never inside the vault** |

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
