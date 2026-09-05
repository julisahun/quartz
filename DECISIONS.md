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
