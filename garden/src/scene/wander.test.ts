import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idleSpot, tendSpot } from './wander.ts';

const key = (p: { x: number; z: number }) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`;

test('a working gardener moves between spots around the plant over time', () => {
  const seen = new Set<string>();
  for (let t = 0; t < 40; t += 0.5) seen.add(key(tendSpot(t, 7)));
  assert.ok(seen.size >= 3, `only ${seen.size} spots`);
});

test('tend spots stay close to the plant and clear of the bot (which works at +x,+z)', () => {
  for (let t = 0; t < 60; t += 0.7) {
    const p = tendSpot(t, 3), d = Math.hypot(p.x, p.z);
    assert.ok(d > 0.6 && d < 1.1, `distance ${d}`);
    assert.ok(Math.hypot(p.x - 0.6, p.z - 0.45) > 0.6, 'too close to the bot');
  }
});

test('a gardener stays at a spot long enough to do something there', () => {
  for (const t of [0, 10, 20]) {
    const start = key(tendSpot(t, 1));
    let held = 0;
    for (let dt = 0; dt < 10 && key(tendSpot(t + dt, 1)) === start; dt += 0.1) held = dt;
    // either we started mid-hold, or the hold is long
    if (key(tendSpot(t - 0.1, 1)) !== start) assert.ok(held >= 2.5, `held ${held}`);
  }
});

test('different gardeners are out of step', () => {
  let differ = 0;
  for (let t = 0; t < 30; t += 1) if (key(tendSpot(t, 1)) !== key(tendSpot(t, 2))) differ++;
  assert.ok(differ > 10);
});

test('idle gardeners stroll near home, mostly sideways along the lane', () => {
  const seen = new Set<string>();
  for (let t = 0; t < 80; t += 0.5) {
    const p = idleSpot(t, 5);
    assert.ok(Math.abs(p.x) <= 1.6 && Math.abs(p.z) <= 0.6, key(p));
    seen.add(key(p));
  }
  assert.ok(seen.size >= 4);
});

test('spots are deterministic', () => {
  assert.deepEqual(tendSpot(12.3, 4), tendSpot(12.3, 4));
  assert.deepEqual(idleSpot(12.3, 4), idleSpot(12.3, 4));
});
