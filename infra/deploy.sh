#!/usr/bin/env bash
# Deploy latest main to the VM. Usage: infra/deploy.sh user@host [https-host]
# The service pulls main, runs npm ci + build on start, so deploy = restart.
set -euo pipefail
SSH_TARGET="${1:?usage: deploy.sh user@host [https-host]}"
HTTPS_HOST="${2:-}"
ssh "$SSH_TARGET" 'sudo systemctl restart sprout-mcp && sleep 2 && systemctl is-active sprout-mcp'
if [ -z "$HTTPS_HOST" ]; then
  HTTPS_HOST="$(ssh "$SSH_TARGET" "sudo head -1 /etc/caddy/Caddyfile | tr -d ' {'")"
fi
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 5 "https://$HTTPS_HOST/health"; then echo; echo "deployed OK"; exit 0; fi
  sleep 3
done
echo "health check failed: ssh in and run 'journalctl -u sprout-mcp -n 50'"; exit 1
