#!/usr/bin/env bash
# Create the tiny repo the live demo runs on (same on A's and B's laptop).
#   bash demo/make-demo-repo.sh [dir]        default ~/sprout-demo
# Push it to GitHub once and have B clone it, or run this on both laptops (identical content).
# `git reset --hard demo-start` returns it to the starting point.
set -euo pipefail
DIR="${1:-$HOME/sprout-demo}"
if [ -e "$DIR" ]; then echo "$DIR exists; to reset: git -C $DIR reset --hard demo-start && git -C $DIR clean -fd"; exit 1; fi
mkdir -p "$DIR"/src/api "$DIR"/tests && cd "$DIR"

cat > package.json <<'EOF'
{ "name": "sprout-demo", "private": true, "type": "module", "scripts": { "test": "node --test tests/" } }
EOF
cat > src/db.js <<'EOF'
// Tiny in-memory "database" for the demo app.
export const users = [
  { id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }, { id: 3, name: 'Linus' },
  { id: 4, name: 'Margaret' }, { id: 5, name: 'Ken' },
];
EOF
cat > src/api/users.js <<'EOF'
import { users } from '../db.js';

/** List users. */
export function listUsers() {
  return users;
}
EOF
cat > src/api/routes.js <<'EOF'
import { listUsers } from './users.js';

export const routes = {
  'GET /users': () => listUsers(),
};
EOF
cat > src/api/auth.js <<'EOF'
export function isAdmin(user) {
  return user?.role === 'admin';
}
EOF
cat > src/client.js <<'EOF'
import { routes } from './api/routes.js';

/** Names of every user, for the sidebar. */
export function userNames() {
  return routes['GET /users']().map((u) => u.name);
}
EOF
cat > tests/api.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routes } from '../src/api/routes.js';

test('GET /users returns users', () => {
  const r = routes['GET /users']();
  const list = Array.isArray(r) ? r : r.items;
  assert.ok(list.length > 0);
});
EOF
cat > README.md <<'EOF'
# sprout-demo
Tiny app used for the Sprout live demo. `npm test` runs the tests.
EOF
printf 'node_modules/\n.claude/settings.local.json\n' > .gitignore
git init -q -b main && git add -A && git commit -qm "demo app" && git tag demo-start
echo "created $DIR (tag demo-start)"; npm test --silent 2>&1 | grep -E "^# (pass|fail)"
