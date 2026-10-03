#!/usr/bin/env bash
# Idempotent setup for the Sprout VM (Ubuntu 22.04/24.04). Run as root:
#   sudo REPO_URL=https://github.com/trishabthakkar/mhacks.git bash setup-vm.sh
# Optional env:
#   HOST       public hostname (default: <ip-with-dashes>.sslip.io)
#   WITH_STDB  1 = also run standalone SpacetimeDB (only if Maincloud doesn't work)
#   BRANCH     git branch to deploy (default: main)
set -euo pipefail

REPO_URL="${REPO_URL:?set REPO_URL}"
BRANCH="${BRANCH:-main}"
WITH_STDB="${WITH_STDB:-0}"
APP_DIR=/opt/sprout
ENV_FILE=/etc/sprout/mcp.env

[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

if [ -z "${HOST:-}" ]; then
  IP="$(curl -4fsS https://ifconfig.me)"
  HOST="${IP//./-}.sslip.io"
fi
echo "==> host: $HOST"

echo "==> base packages"
apt-get update -qq
apt-get install -y -qq curl git ufw debian-keyring debian-archive-keyring apt-transport-https gnupg ca-certificates

echo "==> Node 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi

echo "==> sprout user + repo"
id sprout >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin sprout
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
chown -R sprout:sprout "$APP_DIR"

echo "==> env file (edit $ENV_FILE, then: systemctl restart sprout-mcp)"
mkdir -p /etc/sprout
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
PORT=8080
SPROUT_STDB_URI=wss://maincloud.spacetimedb.com
SPROUT_DB=sprout
ENV
fi
chmod 640 "$ENV_FILE"; chown root:sprout "$ENV_FILE"

echo "==> sprout-mcp service"
cat > /etc/systemd/system/sprout-mcp.service <<UNIT
[Unit]
Description=Sprout MCP server
After=network-online.target
Wants=network-online.target

[Service]
User=sprout
WorkingDirectory=$APP_DIR/mcp
EnvironmentFile=$ENV_FILE
ExecStartPre=/usr/bin/git -C $APP_DIR pull --ff-only origin $BRANCH
ExecStartPre=/usr/bin/npm ci --no-audit --no-fund
ExecStartPre=/usr/bin/npm run --if-present build
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

CADDY_EXTRA=""
if [ "$WITH_STDB" = 1 ]; then
  echo "==> standalone SpacetimeDB"
  if [ ! -x /usr/local/bin/spacetime ]; then
    sudo -u sprout bash -c 'curl -sSf https://install.spacetimedb.com | sh -s -- --yes' || true
    SP="$(ls /home/sprout/.local/bin/spacetime 2>/dev/null || true)"
    [ -n "$SP" ] && ln -sf "$SP" /usr/local/bin/spacetime
  fi
  mkdir -p /var/lib/spacetimedb && chown sprout:sprout /var/lib/spacetimedb
  cat > /etc/systemd/system/sprout-stdb.service <<UNIT
[Unit]
Description=SpacetimeDB standalone
After=network-online.target

[Service]
User=sprout
ExecStart=/usr/local/bin/spacetime --root-dir=/var/lib/spacetimedb start --listen-addr 127.0.0.1:3000
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
  CADDY_EXTRA="
stdb.$HOST {
	reverse_proxy 127.0.0.1:3000
}"
fi

echo "==> Caddy config"
cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
	encode gzip
	@mcp path /mcp /mcp/* /health
	reverse_proxy @mcp 127.0.0.1:8080
	respond "sprout" 200
}
$CADDY_EXTRA
CADDY

echo "==> firewall (22, 80, 443)"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> start"
systemctl daemon-reload
systemctl enable --now sprout-mcp
[ "$WITH_STDB" = 1 ] && systemctl enable --now sprout-stdb
systemctl reload caddy || systemctl restart caddy

echo
echo "Done. MCP:  https://$HOST/mcp   health: https://$HOST/health"
[ "$WITH_STDB" = 1 ] && echo "SpacetimeDB: wss://stdb.$HOST"
echo "Edit $ENV_FILE if needed, then: systemctl restart sprout-mcp"
