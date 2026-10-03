#!/usr/bin/env bash
# Demo-story rehearsal through the real stack (two companions + local MCP + hosted SpacetimeDB).
#   bash scripts/e2e.sh                       # sprout-demo on Maincloud (default)
#   E2E_DB=sprout-smoke E2E_HOST=ws://127.0.0.1:3000 bash scripts/e2e.sh
# Needs `npm ci` in mcp/ and companion/. Never runs against sprout-mhacks.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export E2E_HOST="${E2E_HOST:-wss://maincloud.spacetimedb.com}" E2E_DB="${E2E_DB:-sprout-demo}"
PORT=18081
(cd "$ROOT/mcp" && SPROUT_STDB_URI="$E2E_HOST" SPROUT_DB="$E2E_DB" PORT=$PORT npx tsx src/server.ts >/tmp/sprout-e2e-mcp.log 2>&1) &
MCP_PID=$!
trap 'kill $MCP_PID 2>/dev/null; pkill -f "tsx src/server.ts" 2>/dev/null; wait 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
(cd "$ROOT/companion" && npm run build --silent >/dev/null 2>&1)
cd "$ROOT/mcp" && npx tsx "$ROOT/scripts/e2e.ts"
