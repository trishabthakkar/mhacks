import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEvidence } from './botanist.ts';

const base = { repo: 'r', testRuns: [], reviews: [], requireReview: false, requester: 'a' };

test('refuses without a diff', () => {
  assert.equal(checkEvidence(base).ok, false);
});
test('refuses without a passing test after the diff', () => {
  const r = checkEvidence({ ...base, lastDiffAt: 10, testRuns: [{ repo: 'r', exitCode: 0, at: 5 }] });
  assert.deepEqual(r.missing, ['no passing test run seen after your last edit']);
});
test('blooms with diff and later passing test', () => {
  assert.equal(checkEvidence({ ...base, lastDiffAt: 10, testRuns: [{ repo: 'r', exitCode: 0, at: 11 }] }).ok, true);
});
test('review required and own review ignored', () => {
  const r = checkEvidence({
    ...base, requireReview: true, lastDiffAt: 10,
    testRuns: [{ repo: 'r', exitCode: 0, at: 11 }], reviews: [{ handle: 'a', ok: true, at: 12 }],
  });
  assert.equal(r.ok, false);
});
