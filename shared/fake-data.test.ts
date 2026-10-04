import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_STEPS, makeFakeSnapshots } from './fake-data.ts';

test('deterministic: same count gives deep-equal output', () => {
  assert.deepEqual(makeFakeSnapshots(20), makeFakeSnapshots(20));
});

test('returns the requested number of snapshots with non-decreasing time', () => {
  const snaps = makeFakeSnapshots(15);
  assert.equal(snaps.length, 15);
  for (let i = 1; i < snaps.length; i++) assert.ok(snaps[i]!.at >= snaps[i - 1]!.at);
});

test('timeline contains the demo story', () => {
  const last = makeFakeSnapshots(FAKE_STEPS + 1).at(-1)!;
  assert.equal(last.members.length, 4);
  const kinds = new Set(last.activity.map((a) => a.kind));
  for (const k of ['subagent_start', 'subagent_stop', 'claim', 'blocked_edit', 'message_sent', 'message_delivered',
    'message_acked', 'certify_refused', 'certify_bloom', 'test_fail', 'test_pass', 'commit']) {
    assert.ok(kinds.has(k as never), `missing ${k}`);
  }
  assert.equal(last.messages[0]!.status, 'acked');
  assert.equal(last.plants.find((p) => p.path === 'src/api/routes.ts')!.stage, 'bloom');
  assert.deepEqual(last.certifications.map((c) => c.result), ['refused', 'bloom']);
});

test('first frame is bare soil', () => {
  const first = makeFakeSnapshots(5)[0]!;
  assert.ok(first.plants.every((p) => p.stage === 'seed'));
  assert.equal(first.activity.length, 0);
});

test('fake story has tasks: trisha refactors then blooms, manahil is blocked then unblocked', () => {
  const snaps = makeFakeSnapshots(FAKE_STEPS + 1);
  const at = (step: number) => snaps[step]!;
  const trisha = (s: (typeof snaps)[number]) => s.tasks!.find((t) => t.handle === 'trisha')!;
  assert.equal(at(1).tasks!.length, 0);
  assert.equal(trisha(at(2)).title, 'Refactor the API routes');
  assert.equal(trisha(at(2)).status, 'active');
  assert.equal(at(2).taskItems!.filter((i) => i.taskId === trisha(at(2)).id).length, 3);
  const manahil = at(6).tasks!.find((t) => t.handle === 'manahil')!;
  assert.equal(manahil.status, 'blocked');
  assert.match(manahil.blockedReason!, /^fenced by trisha/);
  assert.equal(at(9).tasks!.find((t) => t.handle === 'manahil')!.status, 'active');
  assert.match(trisha(at(11)).blockedReason!, /^Botanist refused/);
  assert.equal(trisha(at(FAKE_STEPS)).status, 'done');
  assert.equal(trisha(at(FAKE_STEPS)).blockedReason, undefined);
});
