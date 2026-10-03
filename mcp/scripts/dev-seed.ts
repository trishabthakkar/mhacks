// Local dev: join members and plant a few files in a SpacetimeDB so the tools have something to act on.
// Usage: SPROUT_STDB_URI=ws://127.0.0.1:3000 SPROUT_DB=sprout npx tsx scripts/dev-seed.ts [handles...]
import { StdbDb } from '../src/stdbDb.ts';

const handles = process.argv.slice(2).length ? process.argv.slice(2) : ['trisha', 'alex'];
const db = new StdbDb(process.env.SPROUT_STDB_URI ?? 'ws://127.0.0.1:3000', process.env.SPROUT_DB ?? 'sprout', () => {});
await db.ready(10_000);
for (const h of handles) if (!db.member(h)) await db.joinMember(h);
await db.seedRepo([
  { path: 'src/api/routes.ts', lines: 120 }, { path: 'src/api/auth.ts', lines: 80 },
  { path: 'src/db.ts', lines: 60 }, { path: 'tests/api.test.ts', lines: 90 }, { path: 'README.md', lines: 20 },
]);
console.log('members:', db.members().map((m) => m.handle).join(', '));
db.close();
process.exit(0);
