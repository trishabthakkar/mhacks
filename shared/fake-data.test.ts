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
