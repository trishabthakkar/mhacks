// Integration tests against a real SpacetimeDB with P1's module published.
// Run: SPROUT_STDB_URI=ws://127.0.0.1:3000 SPROUT_DB=sprout npm test
// Skipped when SPROUT_STDB_URI is unset (CI / no local server).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { StdbDb } from './stdbDb.ts';

const URI = process.env.SPROUT_STDB_URI;
const NAME = process.env.SPROUT_DB ?? 'sprout';
const skip = !URI && 'set SPROUT_STDB_URI to run against a live SpacetimeDB';
const run = Date.now().toString(36);
const A = `ta${run}`.slice(0, 32);
const B = `tb${run}`.slice(0, 32);

let db: StdbDb | undefined;
after(() => db?.close());

test('plumbing: connects, subscribes, reads from cache, calls reducers', { skip }, async () => {
  db = new StdbDb(URI!, NAME);
  await db.ready(10_000);
  assert.equal(db.connection(), 'connected');
  await db.joinMember(A);
  await db.joinMember(B);
  await waitUntil(() => !!db!.member(A) && !!db!.member(B), 3000);
  assert.equal(db.member(A)!.handle, A);
  assert.ok(db.members().length >= 2);
  assert.ok(Array.isArray(db.claims()) && Array.isArray(db.handoffs()) && Array.isArray(db.agents()));
  // Reducer calls resolve (rule bodies may be stubs).
  await db.reportStatus(A, undefined, 'working');
  assert.equal(await db.waitForCertification((c) => c.handle === `nobody${run}`, 50), undefined);
});

test('full loop: claim, message lifecycle, handoff, certification ', { skip }, async () => {
  db ??= new StdbDb(URI!, NAME);
  await db.ready(10_000);
  await db.claimFiles(A, [`src/${run}/`], 30);
  await waitUntil(() => db!.claims().some((c) => c.path === `src/${run}/` && c.handle === A), 2000, 'claim row');
  await assert.rejects(db.claimFiles(B, [`src/${run}/x.ts`], 30), /fenced|claimed|held/i);

  await db.postMessage(A, B, 'finding', `hello ${run}`);
  await waitUntil(() => db!.messagesTo(B).some((m) => m.body === `hello ${run}`), 2000, 'message row');
  const m = db.messagesTo(B).find((x) => x.body === `hello ${run}`)!;
  assert.equal(typeof m.id, 'number');
  await db.markDelivered(B, [m.id]);
  await waitUntil(() => db!.message(m.id)?.status === 'delivered', 2000, 'delivered');
  await db.ackMessage(B, m.id);
  await waitUntil(() => db!.message(m.id)?.status === 'acked', 2000, 'acked');

  await db.offerHandoff(A, B, `task ${run}`, 'notes');
  await waitUntil(() => db!.handoffs().some((h) => h.task === `task ${run}`), 2000, 'handoff row');

  await db.seedRepo([{ path: `src/${run}/x.ts`, lines: 10 }]);
  await db.submitEvidence(A, `src/${run}/x.ts`, 'demo');
  const cert = await db.waitForCertification((c) => c.handle === A && c.path === `src/${run}/x.ts`, 3000);
  assert.ok(cert, 'certification row arrives');
  assert.equal(cert!.result, 'refused');
});

async function waitUntil(pred: () => boolean, ms: number, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}
