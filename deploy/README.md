# Deploying Quartz to the Pi

Follows section 7 of `~/.claude/personal-deployments.md`: a hosted runner builds,
Tailscale SSH ships, systemd runs it on a loopback port, cloudflared fronts it.
No Docker, no self-hosted runner.

| | |
|---|---|
| Host | `sigint` (the Pi) |
| Port | `8086`, loopback only — no ufw rule needed |
| Binary | `/opt/quartz/quartz` (+ `quartz-passwd`) |
| Web | `/opt/quartz/web` (built PWA, served by the binary) |
| Accounts | `/srv/quartz/accounts.sqlite` — users, vaults, members, sessions. **Not rebuildable; back this up.** |
| Vaults | `/srv/quartz/vaults/<id>` — plain `.md`, a git repo each, valid Obsidian vaults (the first account keeps `/srv/quartz/vault`) |
| Indexes | `/srv/quartz/index/<id>.sqlite` — rebuildable, safe to delete |
| Public | `notes.sigint-pm.uk` |
| Service | `quartz.service` |

## One-time setup on the Pi

```bash
sudo mkdir -p /opt/quartz /srv/quartz/vault
sudo chown -R sigint:sigint /opt/quartz /srv/quartz

# Seed the vault (the Pi's rollback copy of the Obsidian vault).
rsync -a /srv/webdav/juli/obsidian/ /srv/quartz/vault/

# Config, with a hash from the quartz-passwd binary shipped alongside.
install -m 600 /dev/null /opt/quartz/.env
/opt/quartz/quartz-passwd            # paste the output into QUARTZ_PASSWORD_HASH

sudo cp quartz.service /etc/systemd/system/quartz.service
sudo systemctl daemon-reload && sudo systemctl enable --now quartz
curl -sf http://127.0.0.1:8086/healthz

# Let CI restart it (visudo):
#   sigint ALL=(root) NOPASSWD: /bin/systemctl restart quartz
```

Then add the ingress rule from `cloudflared-ingress.yml` to
`/etc/cloudflared/config.yml` (before the catch-all), route the DNS name, and
restart cloudflared.

## Deploys

`.github/workflows/deploy.yml` on `master`: build the arm64 binaries and the
PWA on a hosted runner, join the tailnet as `tag:ci`, rsync to
`sigint@sigint:/opt/quartz/`, restart, smoke-test.

Watch one with `gh run watch <id> -R julisahun/quartz --exit-status`.

## Adding a person

There is no signup page. Run the CLI **as `sigint`**, so the directories it
creates are owned by the service:

```bash
ssh pi
/opt/quartz/quartz-admin user add maria          # prompts for a password
/opt/quartz/quartz-admin vault create casa -owner juli -name "Casa"
/opt/quartz/quartz-admin vault share casa maria
/opt/quartz/quartz-admin user list
```

No restart is needed: a new vault is opened the first time someone asks for it.
Hand over the password out of band. They can change it themselves afterwards
from inside the app (`password…` in the status bar, or the phone's `⋯` menu),
which is the point of handing over a temporary one. `quartz-admin user passwd
maria` is still how a *forgotten* password is dealt with — that path needs
shell access, exactly as creating the account did.

To take access away: `quartz-admin vault unshare casa maria`, which applies to
the next request — no waiting for a session to expire. `quartz-admin user
remove maria` keeps her notes on disk unless you pass `-purge`.

## Recovering a note

Every vault is a git repo, so history is on the Pi:

```bash
git -C /srv/quartz/vault log --oneline -- "notes/thing.md"
git -C /srv/quartz/vault show <sha>:"notes/thing.md" > /tmp/thing.md
```

`GET /api/v/<vault>/history?path=...` exposes the same log through the API.

## If an index gets corrupted

Stop the service, delete `/srv/quartz/index/<vault>.sqlite*`, start it again.
The folder is the source of truth; the index rebuilds from a scan. Clients
notice the new epoch and reconcile from the manifest.

Deleting `accounts.sqlite` is a different matter — it holds the only record of
who exists and who can open what. If it is lost and `QUARTZ_USER` /
`QUARTZ_PASSWORD_HASH` are still in `.env`, the first account comes back on the
next boot and everyone else has to be recreated.
