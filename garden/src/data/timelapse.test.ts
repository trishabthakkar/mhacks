import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_STEPS, makeFakeSnapshots } from '../../../shared/fake-data.ts';
import { historyFromSnapshot, Replay } from './timelapse.ts';

const final = makeFakeSnapshots(FAKE_STEPS + 1).at(-1)!;
const mk = () => new Replay(historyFromSnapshot(final));
const stage = (r: Replay, t: number, path: string) => r.snapshotAt(t).plants.find((p) => p.path === path)?.stage;
const ORDER = ['seed', 'sprout', 'growing', 'bud', 'bloom'];

test('starts as bare soil and ends in bloom', () => {
  const r = mk();
  const first = r.snapshotAt(r.start - 1);
  assert.ok(first.plants.every((p) => p.stage === 'seed'));
  assert.equal(first.activity.length, 0);
  assert.equal(stage(r, r.end, 'src/api/routes.ts'), 'bloom');
});

test('deterministic: same time, same snapshot, forward or after scrubbing back', () => {
  const r = mk();
  const mid = (r.start + r.end) / 2;
  const a = JSON.stringify(r.snapshotAt(mid));
  r.snapshotAt(r.end); r.snapshotAt(r.start);
  assert.equal(JSON.stringify(r.snapshotAt(mid)), a);
  assert.equal(JSON.stringify(mk().snapshotAt(mid)), a);
});

test('the refusal keeps the plant a bud, then the bloom arrives', () => {
  const r = mk();
  const refused = final.activity.find((a) => a.kind === 'certify_refused')!;
  const bloom = final.activity.find((a) => a.kind === 'certify_bloom')!;
  assert.notEqual(stage(r, refused.at, 'src/api/routes.ts'), 'bloom');
  assert.equal(stage(r, bloom.at, 'src/api/routes.ts'), 'bloom');
});

test('bugs appear on a failing test and clear on a passing one', () => {
  const r = mk();
  const fail = final.activity.find((a) => a.kind === 'test_fail')!;
  const pass = final.activity.find((a) => a.kind === 'test_pass')!;
  assert.ok(r.snapshotAt(fail.at).plants.find((p) => p.path === 'src/api/routes.ts')!.bugs > 0);
  assert.equal(r.snapshotAt(pass.at).plants.find((p) => p.path === 'src/api/routes.ts')!.bugs, 0);
});

test('fences come and go with claim/release; messages progress sent -> delivered -> acked', () => {
  const r = mk();
  const claim = final.activity.find((a) => a.kind === 'claim')!;
  const release = final.activity.find((a) => a.kind === 'release')!;
  assert.equal(r.snapshotAt(claim.at).claims.length, 1);
  assert.equal(r.snapshotAt(release.at).claims.length, 0);
  const sent = final.activity.find((a) => a.kind === 'message_sent')!, acked = final.activity.find((a) => a.kind === 'message_acked')!;
  assert.equal(r.snapshotAt(sent.at).messages[0]?.status, 'sent');
  assert.equal(r.snapshotAt(acked.at).messages[0]?.status, 'acked');
});

test('gardeners appear when they first show up; stages never skip backwards in plain forward play', () => {
  const r = mk();
  assert.equal(r.snapshotAt(r.start - 1).members.length, 0);
  assert.equal(r.snapshotAt(r.end).members.length, 4);
  const r2 = mk(); const seen = new Map<string, number>();
  for (let t = r2.start; t <= r2.end; t += (r2.end - r2.start) / 40) {
    for (const p of r2.snapshotAt(t).plants) {
      const o = ORDER.indexOf(p.stage);
      if (p.path === 'src/api/routes.ts') assert.ok(o >= (seen.get(p.path) ?? 0) - 1, 'routes.ts only drops one step (bloom -> bud on a new edit)');
      seen.set(p.path, o);
    }
  }
});

test('progress runs 0..1', () => {
  const r = mk();
  assert.equal(r.progress(r.start), 0);
  assert.equal(r.progress(r.end), 1);
  assert.equal(r.progress(r.end + 1e9), 1);
});
