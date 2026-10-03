// Put the shared Sprout state into the demo's starting position. Safe to re-run.
//   cd mcp && SPROUT_STDB_URI=wss://maincloud.spacetimedb.com SPROUT_DB=sprout-demo \
//     npx tsx ../demo/demo-reset.ts manahil shriya
// - claimMode=block (PreToolUse denies edits on fenced files), claimTtlMinutes=30
// - releases every fence the demo members hold
// - acks every un-acked message to them, declines their open handoffs
// It does not touch plants: A's live edit makes the new diff the botanist checks.
import { StdbDb } from '../mcp/src/stdbDb.ts';

const [a = 'manahil', b = 'shriya'] = process.argv.slice(2);
const uri = process.env.SPROUT_STDB_URI;
const name = process.env.SPROUT_DB;
if (!uri || !name) {
  console.error('Set SPROUT_STDB_URI and SPROUT_DB (the demo database).');
  process.exit(1);
}
const db = new StdbDb(uri, name, () => {});
await db.ready(15_000);

for (const h of [a, b]) {
  if (!db.member(h)) { console.error(`✗ ${h} is not a member of ${name}: run \`sprout join\` on their laptop first.`); process.exit(1); }
}
await db.setConfig('claimMode', 'block');
await db.setConfig('claimTtlMinutes', '30');
for (const h of [a, b]) {
  await db.releaseFiles(h, []); // empty = release all mine
  for (const m of db.messagesTo(h).filter((m) => m.status !== 'acked')) await db.ackMessage(h, m.id);
  for (const ho of db.handoffs().filter((x) => x.toHandle === h && x.status === 'offered')) await db.respondHandoff(h, ho.id, false);
}
await new Promise((r) => setTimeout(r, 500));
const left = db.claims().filter((c) => c.handle === a || c.handle === b);
const unread = [a, b].map((h) => db.messagesTo(h).filter((m) => m.status !== 'acked').length);
console.log(`claimMode=${db.config('claimMode')} ttl=${db.config('claimTtlMinutes')} | fences held by ${a}/${b}: ${left.length} | unread ${a}=${unread[0]} ${b}=${unread[1]}`);
console.log(left.length === 0 && unread.every((n) => n === 0) && db.config('claimMode') === 'block' ? '✓ demo state reset' : '✗ reset incomplete');
db.close();
process.exit(0);
