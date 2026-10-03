// node --experimental-strip-types --test scripts/stages.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANT_DORMANT_AFTER_US, shouldGoDormant, wakeStage } from '../src/stages.ts';

const at = (us: bigint) => ({ microsSinceUnixEpoch: us });
const NOW = 100n * PLANT_DORMANT_AFTER_US;
const old = at(NOW - PLANT_DORMANT_AFTER_US - 1n);
const fresh = at(NOW - 1_000_000n);

test('idle 3h+ goes dormant, fresh does not', () => {
  assert.equal(shouldGoDormant({ stage: 'growing', lines: 5, lastActivity: old }, NOW), true);
  assert.equal(shouldGoDormant({ stage: 'growing', lines: 5, lastActivity: fresh }, NOW), false);
});
test('blooms and dormant plants are left alone', () => {
  assert.equal(shouldGoDormant({ stage: 'bloom', lines: 5, lastActivity: old }, NOW), false);
  assert.equal(shouldGoDormant({ stage: 'dormant', lines: 5, lastActivity: old }, NOW), false);
});
test('waking restores what the evidence says', () => {
  assert.equal(wakeStage({ stage: 'dormant', lines: 5, lastActivity: old, lastDiffAt: at(5n) }), 'bud');
  assert.equal(wakeStage({ stage: 'dormant', lines: 5, lastActivity: old, lastDiffAt: at(9n), lastBloomAt: at(5n) }), 'bud');
  assert.equal(wakeStage({ stage: 'dormant', lines: 5, lastActivity: old, lastDiffAt: at(5n), lastBloomAt: at(9n) }), 'bloom');
  assert.equal(wakeStage({ stage: 'dormant', lines: 5, lastActivity: old }), 'growing');
  assert.equal(wakeStage({ stage: 'dormant', lines: 0, lastActivity: old }), 'seed');
  assert.equal(wakeStage({ stage: 'sprout', lines: 0, lastActivity: old }), 'sprout');
});
