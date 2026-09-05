# Deploying quarts to the Pi

Follows section 7 of `~/.claude/personal-deployments.md`: a hosted runner builds,
Tailscale SSH ships, systemd runs it on a loopback port, cloudflared fronts it.
No Docker, no self-hosted runner.

| | |
|---|---|
| Host | `sigint` (the Pi) |
| Port | `8086`, loopback only — no ufw rule needed |
| Binary | `/opt/quarts/quarts` (+ `quarts-passwd`) |
| Web | `/opt/quarts/web` (built PWA, served by the binary) |
| Vault | `/srv/quarts/vault` — plain `.md`, a git repo, a valid Obsidian vault |
| Index | `/srv/quarts/index.sqlite` — rebuildable, safe to delete |
| Public | `notes.sigint-pm.uk` |
| Service | `quarts.service` |

## One-time setup on the Pi

```bash
sudo mkdir -p /opt/quarts /srv/quarts/vault
sudo chown -R sigint:sigint /opt/quarts /srv/quarts

# Seed the vault (the Pi's rollback copy of the Obsidian vault).
rsync -a /srv/webdav/juli/obsidian/ /srv/quarts/vault/

# Config, with a hash from the quarts-passwd binary shipped alongside.
install -m 600 /dev/null /opt/quarts/.env
/opt/quarts/quarts-passwd            # paste the output into QUARTS_PASSWORD_HASH

sudo cp quarts.service /etc/systemd/system/quarts.service
sudo systemctl daemon-reload && sudo systemctl enable --now quarts
curl -sf http://127.0.0.1:8086/healthz

# Let CI restart it (visudo):
#   sigint ALL=(root) NOPASSWD: /bin/systemctl restart quarts
```

Then add the ingress rule from `cloudflared-ingress.yml` to
`/etc/cloudflared/config.yml` (before the catch-all), route the DNS name, and
restart cloudflared.

## Deploys

`.github/workflows/deploy.yml` on `master`: build the arm64 binaries and the
PWA on a hosted runner, join the tailnet as `tag:ci`, rsync to
`sigint@sigint:/opt/quarts/`, restart, smoke-test.

Watch one with `gh run watch <id> -R julisahun/quarts --exit-status`.

## Recovering a note

The vault is a git repo, so history is on the Pi:

```bash
git -C /srv/quarts/vault log --oneline -- "notes/thing.md"
git -C /srv/quarts/vault show <sha>:"notes/thing.md" > /tmp/thing.md
```

`GET /api/history?path=...` exposes the same log through the API.

## If the index gets corrupted

Stop the service, delete `/srv/quarts/index.sqlite*`, start it again. The vault
is the source of truth; the index rebuilds from a scan. Clients re-sync via
`/api/snapshot` because their cursor no longer matches.
