#!/usr/bin/env bash
#
# One-time privileged setup for quartz on the Pi. Run as root, once:
#
#   ssh -t pi 'sudo bash /home/sigint/quartz-stage/bootstrap-pi.sh'
#
# Everything here is idempotent: re-running it changes nothing that is already
# in place. Ordinary deploys afterwards are just rsync + systemctl restart and
# need none of this.
set -euo pipefail

APP_USER=sigint
APP_DIR=/opt/quartz
VAULT_DIR=/srv/quartz/vault
STAGE_DIR=/home/sigint/quartz-stage
SEED_DIR=/srv/webdav/juli/obsidian
TUNNEL=03c079f3-c445-4882-8520-f1f1d78e8c70
HOSTNAME_PUBLIC=notes.sigint-pm.uk
PORT=8086

say() { printf '\n== %s\n' "$1"; }

if [[ $EUID -ne 0 ]]; then
  echo "run me with sudo" >&2
  exit 1
fi
if [[ ! -d $STAGE_DIR ]]; then
  echo "$STAGE_DIR is missing — stage the release first" >&2
  exit 1
fi

say "directories"
mkdir -p "$APP_DIR" "$VAULT_DIR" "$APP_DIR/web"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" /srv/quartz

say "binaries and web app"
install -o "$APP_USER" -g "$APP_USER" -m 0755 "$STAGE_DIR/quartz" "$APP_DIR/quartz"
install -o "$APP_USER" -g "$APP_USER" -m 0755 "$STAGE_DIR/quartz-passwd" "$APP_DIR/quartz-passwd"
install -o "$APP_USER" -g "$APP_USER" -m 0755 "$STAGE_DIR/quartzctl" "$APP_DIR/quartzctl"
rsync -a --delete "$STAGE_DIR/web/" "$APP_DIR/web/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/web"

say "vault"
if [[ -z "$(ls -A "$VAULT_DIR" 2>/dev/null)" ]]; then
  if [[ -d $SEED_DIR ]]; then
    # A copy, not a move: the old WebDAV directory stays as a rollback.
    rsync -a "$SEED_DIR/" "$VAULT_DIR/"
    chown -R "$APP_USER:$APP_USER" /srv/quartz
    echo "seeded from $SEED_DIR ($(find "$VAULT_DIR" -name '*.md' | wc -l) notes)"
  else
    echo "no seed directory; starting with an empty vault"
  fi
else
  echo "vault already has content, left alone"
fi

say "configuration"
if [[ -f $APP_DIR/.env ]] && grep -q '^QUARTZ_PASSWORD_HASH=.\+' "$APP_DIR/.env"; then
  echo ".env already has a password hash, left alone"
else
  echo "Choose the password you will sign in with."
  HASH=$(sudo -u "$APP_USER" "$APP_DIR/quartz-passwd" </dev/tty)
  install -o "$APP_USER" -g "$APP_USER" -m 0600 /dev/null "$APP_DIR/.env"
  cat > "$APP_DIR/.env" <<ENV
QUARTZ_ADDR=127.0.0.1:$PORT
QUARTZ_VAULT=$VAULT_DIR
QUARTZ_INDEX=/srv/quartz/index.sqlite
QUARTZ_WEB_DIR=$APP_DIR/web
QUARTZ_USER=juli
QUARTZ_PASSWORD_HASH=$HASH
QUARTZ_SECURE_COOKIE=true
QUARTZ_SESSION_TTL_DAYS=90
QUARTZ_GIT=true
QUARTZ_GIT_DEBOUNCE_SECONDS=30
QUARTZ_MAX_FILE_MB=64
ENV
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

say "systemd unit"
install -m 0644 "$STAGE_DIR/quartz.service" /etc/systemd/system/quartz.service
systemctl daemon-reload
systemctl enable --now quartz

say "sudoers entry for CI restarts"
cat > /etc/sudoers.d/quartz <<'SUDO'
sigint ALL=(root) NOPASSWD: /bin/systemctl restart quartz, /usr/bin/systemctl restart quartz
sigint ALL=(root) NOPASSWD: /bin/systemctl status quartz, /usr/bin/systemctl status quartz
SUDO
chmod 0440 /etc/sudoers.d/quartz
visudo -c -f /etc/sudoers.d/quartz

say "cloudflared ingress"
CONF=/etc/cloudflared/config.yml
if grep -q "$HOSTNAME_PUBLIC" "$CONF"; then
  echo "ingress rule already present"
else
  cp "$CONF" "$CONF.bak.$(date +%Y%m%d%H%M%S)"
  awk -v host="$HOSTNAME_PUBLIC" -v port="$PORT" '
    /- service: http_status:404/ && !inserted {
      printf "  - hostname: %s\n    service: http://localhost:%s\n", host, port
      inserted = 1
    }
    { print }
  ' "$CONF.bak."* > /tmp/quartz-config.yml 2>/dev/null || \
  awk -v host="$HOSTNAME_PUBLIC" -v port="$PORT" '
    /- service: http_status:404/ && !inserted {
      printf "  - hostname: %s\n    service: http://localhost:%s\n", host, port
      inserted = 1
    }
    { print }
  ' "$CONF" > /tmp/quartz-config.yml
  mv /tmp/quartz-config.yml "$CONF"
  chmod 0644 "$CONF"
  echo "added $HOSTNAME_PUBLIC -> localhost:$PORT"
fi

say "DNS route"
if sudo -u "$APP_USER" HOME=/home/"$APP_USER" cloudflared tunnel route dns "$TUNNEL" "$HOSTNAME_PUBLIC" 2>&1; then
  echo "route created"
else
  echo "route not created — if it already exists, that is fine"
fi
systemctl restart cloudflared

say "smoke test"
for i in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null; then
    echo "quartz is up on 127.0.0.1:$PORT"
    exit 0
  fi
  sleep 1
done
echo "quartz did not answer; recent logs:" >&2
journalctl -u quartz -n 40 --no-pager >&2
exit 1
