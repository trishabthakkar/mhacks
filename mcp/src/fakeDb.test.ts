import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fakeDb.ts';

const T0 = Date.UTC(2026, 9, 3, 22, 0, 0);
const make = () => {
  const now = { t: T0 };
  const db = new FakeDb(() => now.t);
  db.seedMember('trisha');
  db.seedMember('alex');
  return { db, now };
};

test('claim: another member holding a matching dir claim rejects with who and until when', async () => {
  const { db } = make();
  await db.claimFiles('alex', ['src/api/'], 30);
  await assert.rejects(db.claimFiles('trisha', ['src/api/routes.ts'], 30), /src\/api\/ is fenced by alex until/);
});

test('claim: a file claim blocks a dir claim that contains it', async () => {
  const { db } = make();
  await db.claimFiles('alex', ['src/api/routes.ts'], 30);
  await assert.rejects(db.claimFiles('trisha', ['src/api/'], 30), /fenced by alex/);
});

test('claim: expired claims disappear and no longer conflict', async () => {
  const { db, now } = make();
  await db.claimFiles('alex', ['src/api/'], 30);
  now.t += 31 * 60_000;
  assert.equal(db.claims().length, 0);
  await db.claimFiles('trisha', ['src/api/'], 30);
  assert.equal(db.claims()[0]!.handle, 'trisha');
});

test('claim: re-claiming your own path extends it; release removes it', async () => {
  const { db } = make();
  await db.claimFiles('alex', ['src/api/'], 10);
  await db.claimFiles('alex', ['src/api/'], 60);
  assert.equal(db.claims().length, 1);
  assert.equal(db.claims()[0]!.expiresAt, T0 + 60 * 60_000);
  await db.releaseFiles('alex', ['src/api/']);
  assert.equal(db.claims().length, 0);
});

test('messages: sent → delivered → acked, body over 500 rejected, only recipient can ack', async () => {
  const { db } = make();
  await db.postMessage('trisha', 'alex', 'finding', 'API changed');
  const [m] = db.messagesTo('alex');
  assert.equal(m!.status, 'sent');
  await db.markDelivered('alex', [m!.id]);
  assert.equal(db.message(m!.id)!.status, 'delivered');
  await assert.rejects(db.ackMessage('trisha', m!.id), /not addressed to you/);
  await db.ackMessage('alex', m!.id);
  assert.equal(db.message(m!.id)!.status, 'acked');
  await assert.rejects(db.postMessage('trisha', 'alex', 'finding', 'x'.repeat(501)), /500/);
});

test('handoffs: offered, only the receiver can respond, once', async () => {
  const { db } = make();
  await db.offerHandoff('trisha', 'alex', 'finish auth', 'tests in tests/api.test.ts');
  const [h] = db.handoffs();
  assert.equal(h!.status, 'offered');
  await assert.rejects(db.respondHandoff('trisha', h!.id, true), /not offered to you/);
  await db.respondHandoff('alex', h!.id, true);
  assert.equal(db.handoffs()[0]!.status, 'accepted');
  await assert.rejects(db.respondHandoff('alex', h!.id, false), /already accepted/);
});

test('evidence: refused without diff/test, certified after diff + passing test', async () => {
  const { db, now } = make();
  await db.submitEvidence('trisha', 'src/api/routes.ts', 'add route');
  let c = await db.waitForCertification((x) => x.path === 'src/api/routes.ts', 100);
  assert.equal(c!.result, 'refused');
  assert.match(c!.reason, /no real diff/);

  db.seedDiff('trisha', 'src/api/routes.ts');
  now.t += 1000;
  await db.submitEvidence('trisha', 'src/api/routes.ts', 'add route');
  c = await db.waitForCertification((x) => x.id > c!.id, 100);
  assert.equal(c!.result, 'refused');
  assert.match(c!.reason, /no passing test run seen after your last edit/);

  now.t += 1000;
  db.seedTestRun('trisha', 0);
  now.t += 1000;
  const lastId = c!.id;
  await db.submitEvidence('trisha', 'src/api/routes.ts', 'add route');
  c = await db.waitForCertification((x) => x.id > lastId, 100);
  assert.equal(c!.result, 'bloom');
});

test('waitForCertification resolves undefined on timeout', async () => {
  const { db } = make();
  assert.equal(await db.waitForCertification(() => true, 20), undefined);
});

test('reportStatus updates the session agent; unknown session rejects', async () => {
  const { db } = make();
  db.seedAgent({ sessionId: 's1', handle: 'trisha', status: 'working' });
  await db.reportStatus('trisha', 's1', 'blocked');
  assert.equal(db.agents()[0]!.status, 'blocked');
  await assert.rejects(db.reportStatus('trisha', 'nope', 'working'), /no session/);
});
