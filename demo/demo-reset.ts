// Put the shared Sprout state into the demo's starting position. Safe to re-run.
//   cd mcp && SPROUT_STDB_URI=wss://maincloud.spacetimedb.com SPROUT_DB=sprout-demo \
//     npx tsx ../demo/demo-reset.ts manahil shriya
// - removes every member who isn't on the team (test/sim handles like ivy, p3check, e2e-a)
//   via P1's removeMember: their agents, fences, messages and handoffs go; plants stay
// - claimMode=block (PreToolUse denies edits on fenced files), claimTtlMinutes=30
// - for every team member: releases fences, acks un-acked messages, declines open handoffs
// It does not touch plants: A's live edit makes the new diff the botanist checks.
// Team = the two demo handles + SPROUT_KEEP (default "seno,trisha"), so all four gardeners stay.
// Stop any sim/companion using a removed handle first, or its next event re-joins it.
import { StdbDb } from '../mcp/src/stdbDb.ts';

const [a = 'manahil', b = 'shriya'] = process.argv.slice(2);
const uri = process.env.SPROUT_STDB_URI;
const name = process.env.SPROUT_DB;
if (!uri || !name) {
  console.error('Set SPROUT_STDB_URI and SPROUT_DB (the demo database).');
  process.exit(1);
}
if (name === 'sprout-mhacks') {
  console.error('✗ Refusing to reset sprout-mhacks (the real team garden). Use SPROUT_DB=sprout-demo.');
  process.exit(1);
}
const keep = new Set([a, b, ...(process.env.SPROUT_KEEP ?? 'seno,trisha').split(',').map((s) => s.trim()).filter(Boolean)]);

const db = new StdbDb(uri, name, () => {});
await db.ready(15_000);

for (const h of [a, b]) {
  if (!db.member(h)) { console.error(`✗ ${h} is not a member of ${name}: run \`sprout join\` on their laptop first.`); process.exit(1); }
}

const strangers = db.members().map((m) => m.handle).filter((h) => !keep.has(h));
for (const h of strangers) await db.removeMember(h);

await db.setConfig('claimMode', 'block');
await db.setConfig('claimTtlMinutes', '30');
const team = db.members().map((m) => m.handle).filter((h) => keep.has(h));
for (const h of team) {
  await db.releaseFiles(h, []); // empty = release all mine
  for (const m of db.messagesTo(h).filter((m) => m.status !== 'acked')) await db.ackMessage(h, m.id);
  for (const ho of db.handoffs().filter((x) => x.toHandle === h && x.status === 'offered')) await db.respondHandoff(h, ho.id, false);
}
await new Promise((r) => setTimeout(r, 500));

const members = db.members().map((m) => m.handle);
const extra = members.filter((h) => !keep.has(h));
const fences = db.claims().length;
const unread = team.reduce((n, h) => n + db.messagesTo(h).filter((m) => m.status !== 'acked').length, 0);
console.log(`removed: ${strangers.join(' ') || '(none)'}`);
console.log(`members: ${members.join(' ')} | claimMode=${db.config('claimMode')} ttl=${db.config('claimTtlMinutes')} | fences: ${fences} | unread: ${unread}`);
const ok = extra.length === 0 && fences === 0 && unread === 0 && db.config('claimMode') === 'block';
console.log(ok ? '✓ demo state reset' : `✗ reset incomplete${extra.length ? ` (still present: ${extra.join(' ')} — is a sim or companion still running as them?)` : ''}`);
db.close();
process.exit(ok ? 0 : 1);
