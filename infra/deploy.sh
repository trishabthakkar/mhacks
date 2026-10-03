#!/usr/bin/env bash
# Deploy latest main to the VM. Usage: infra/deploy.sh user@host [https-host]
#   Google Cloud via gcloud: GCE_INSTANCE=sprout GCE_ZONE=us-east4-a infra/deploy.sh gce [https-host]
# The service pulls main, runs npm ci + build on start, so deploy = restart.
set -euo pipefail
SSH_TARGET="${1:?usage: deploy.sh user@host [https-host]}"
HTTPS_HOST="${2:-}"
remote() {
  if [ "$SSH_TARGET" = gce ]; then
    gcloud compute ssh "${GCE_INSTANCE:?set GCE_INSTANCE}" --zone "${GCE_ZONE:?set GCE_ZONE}" --command "$1"
  else
    ssh "$SSH_TARGET" "$1"
  fi
}
remote 'sudo systemctl restart sprout-mcp && sleep 2 && systemctl is-active sprout-mcp'
if [ -z "$HTTPS_HOST" ]; then
  HTTPS_HOST="$(remote "sudo head -1 /etc/caddy/Caddyfile | tr -d ' {'")"
fi
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 5 "https://$HTTPS_HOST/health"; then echo; echo "deployed OK"; exit 0; fi
  sleep 3
done
echo "health check failed: ssh in and run 'journalctl -u sprout-mcp -n 50'"; exit 1
