# Deploying quartz to the Pi

Follows section 7 of `~/.claude/personal-deployments.md`: a hosted runner builds,
Tailscale SSH ships, systemd runs it on a loopback port, cloudflared fronts it.
No Docker, no self-hosted runner.

| | |
|---|---|
| Host | `sigint` (the Pi) |
| Port | `8086`, loopback only — no ufw rule needed |
| Binary | `/opt/quartz/quartz` (+ `quartz-passwd`) |
| Web | `/opt/quartz/web` (built PWA, served by the binary) |
| Vault | `/srv/quartz/vault` — plain `.md`, a git repo, a valid Obsidian vault |
| Index | `/srv/quartz/index.sqlite` — rebuildable, safe to delete |
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

## Recovering a note

The vault is a git repo, so history is on the Pi:

```bash
git -C /srv/quartz/vault log --oneline -- "notes/thing.md"
git -C /srv/quartz/vault show <sha>:"notes/thing.md" > /tmp/thing.md
```

`GET /api/history?path=...` exposes the same log through the API.

## If the index gets corrupted

Stop the service, delete `/srv/quartz/index.sqlite*`, start it again. The vault
is the source of truth; the index rebuilds from a scan. Clients re-sync via
`/api/snapshot` because their cursor no longer matches.
