#!/usr/bin/env bash
# Build the garden locally and publish it to the VM at https://<host>/garden/
#   infra/deploy-garden.sh user@host [https-host]
#   Google Cloud via gcloud: GCE_INSTANCE=sprout GCE_ZONE=us-east4-a infra/deploy-garden.sh gce [https-host]
# NOT YET RUN ON THE VM: written and syntax-checked only. Needs setup-vm.sh to have been re-run once (adds the /garden route).
set -euo pipefail
TARGET="${1:?usage: deploy-garden.sh user@host|gce [https-host]}"
HTTPS_HOST="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

remote() {
  if [ "$TARGET" = gce ]; then gcloud compute ssh "${GCE_INSTANCE:?set GCE_INSTANCE}" --zone "${GCE_ZONE:?set GCE_ZONE}" --command "$1"
  else ssh "$TARGET" "$1"; fi
}
upload() { # upload <local dir> <remote dir>
  if [ "$TARGET" = gce ]; then gcloud compute scp --recurse --zone "${GCE_ZONE:?}" "$1" "${GCE_INSTANCE:?}:$2"
  else scp -r "$1" "$TARGET:$2"; fi
}

echo "==> build"
cd "$ROOT/garden"
npm ci --silent
VITE_STDB_HOST="${VITE_STDB_HOST:-wss://maincloud.spacetimedb.com}" VITE_STDB_DB="${VITE_STDB_DB:-sprout-mhacks}" npm run build

echo "==> upload"
remote 'rm -rf /tmp/garden-dist'
upload dist /tmp/garden-dist

echo "==> publish"
remote 'sudo rm -rf /var/www/garden/* && sudo cp -r /tmp/garden-dist/* /var/www/garden/ && sudo chmod -R a+rX /var/www/garden && rm -rf /tmp/garden-dist'

if [ -z "$HTTPS_HOST" ]; then HTTPS_HOST="$(remote "sudo head -1 /etc/caddy/Caddyfile | tr -d ' {'")"; fi
echo "==> check https://$HTTPS_HOST/garden/"
for i in 1 2 3 4 5; do
  if curl -fsS --max-time 8 "https://$HTTPS_HOST/garden/" | grep -q "Sprout garden"; then echo "garden deployed OK: https://$HTTPS_HOST/garden/?db=sprout-demo&present=1"; exit 0; fi
  sleep 3
done
echo "garden check failed: ssh in and look at 'sudo journalctl -u caddy -n 50'"; exit 1
