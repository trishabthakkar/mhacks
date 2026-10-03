// Put the shared Sprout state into the demo's starting position. Safe to re-run.
//
//   cd mcp && npx tsx ../demo/demo-reset.ts                 # before the demo (real team db)
//   cd mcp && npx tsx ../demo/demo-reset.ts --after         # after the demo: back to warn mode
//
// Defaults: SPROUT_STDB_URI=wss://maincloud.spacetimedb.com, SPROUT_DB=sprout-mhacks, A=manahil, B=shriya.
// Override: npx tsx ../demo/demo-reset.ts <A> <B>, and the env vars.
//
// Real team db (sprout-mhacks, or --team): NEVER removes members or touches teammates' inboxes.
//   - claimMode=block (PreToolUse denies edits on fenced files), claimTtlMinutes=30
//   - releases every fence (so A's demo fence can't collide with a leftover one); prints what it released
//   - for A and B only: acks un-acked messages, declines open handoffs to them
// Scratch db (anything else, e.g. the sprout-demo backup): also removes members who aren't on the team
//   (test/sim handles like ivy, p3check, e2e-a) via removeMember. Team = A, B + SPROUT_KEEP (default seno,trisha).
// --after: sets claimMode=warn (the team default) and nothing else.
import { StdbDb } from '../mcp/src/stdbDb.ts';

const args = process.argv.slice(2);
const after = args.includes('--after');
const teamMode = args.includes('--team');
const [a = 'manahil', b = 'shriya'] = args.filter((x) => !x.startsWith('--'));
const uri = process.env.SPROUT_STDB_URI ?? 'wss://maincloud.spacetimedb.com';
const name = process.env.SPROUT_DB ?? 'sprout-mhacks';
const realDb = teamMode || name === 'sprout-mhacks';

const db = new StdbDb(uri, name, () => {});
await db.ready(15_000);
const done = (ok: boolean) => { db.close(); process.exit(ok ? 0 : 1); };

if (after) {
  await db.setConfig('claimMode', 'warn');
  await new Promise((r) => setTimeout(r, 300));
  console.log(`${name}: claimMode=${db.config('claimMode')}`);
  done(db.config('claimMode') === 'warn');
}

for (const h of [a, b]) {
  if (!db.member(h)) { console.error(`✗ ${h} is not a member of ${name}: run \`sprout join\` on their laptop first.`); done(false); }
}

if (!realDb) {
  const keep = new Set([a, b, ...(process.env.SPROUT_KEEP ?? 'seno,trisha').split(',').map((s) => s.trim()).filter(Boolean)]);
  const strangers = db.members().map((m) => m.handle).filter((h) => !keep.has(h));
  for (const h of strangers) await db.removeMember(h);
  console.log(`removed: ${strangers.join(' ') || '(none)'}`);
}

await db.setConfig('claimMode', 'block');
await db.setConfig('claimTtlMinutes', '30');
const fences = db.claims();
for (const h of new Set(fences.map((c) => c.handle))) await db.releaseFiles(h, []); // empty = release all of theirs
for (const h of [a, b]) {
  for (const m of db.messagesTo(h).filter((m) => m.status !== 'acked')) await db.ackMessage(h, m.id);
  for (const ho of db.handoffs().filter((x) => x.toHandle === h && x.status === 'offered')) await db.respondHandoff(h, ho.id, false);
}
await new Promise((r) => setTimeout(r, 500));

const unread = [a, b].reduce((n, h) => n + db.messagesTo(h).filter((m) => m.status !== 'acked').length, 0);
console.log(`released fences: ${fences.map((c) => `${c.path} (${c.handle})`).join(', ') || '(none)'}`);
console.log(`${name}: members ${db.members().map((m) => m.handle).join(' ')} | claimMode=${db.config('claimMode')} | fences left ${db.claims().length} | unread ${a}+${b}: ${unread}`);
const ok = db.claims().length === 0 && unread === 0 && db.config('claimMode') === 'block';
console.log(ok ? '✓ demo state reset. After the demo: npx tsx ../demo/demo-reset.ts --after' : '✗ reset incomplete');
done(ok);
