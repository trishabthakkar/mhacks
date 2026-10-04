import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idleSpot, roamSpot, tendSpot, workSpot } from './wander.ts';

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

const spots = Array.from({ length: 6 }, (_, i) => ({ x: i * 3, z: 0, fx: i * 3, fz: -1 }));
test('roamSpot: deterministic, never the same spot twice in a row, holds 6–12 s at each', () => {
  assert.deepEqual(roamSpot(42, 7, spots), roamSpot(42, 7, spots));
  let prev = roamSpot(0, 7, spots), changes = 0, last = 0, minHold = Infinity, maxHold = 0;
  for (let t = 0.25; t < 600; t += 0.25) {
    const s = roamSpot(t, 7, spots);
    if (s !== prev) {
      if (changes) { minHold = Math.min(minHold, t - last); maxHold = Math.max(maxHold, t - last); }
      changes++; last = t; prev = s;
    }
  }
  assert.ok(changes > 30 && minHold >= 5.75 && maxHold <= 12.25, `${changes} ${minHold} ${maxHold}`);
});
test('roamSpot: two people are mostly at different spots; no spots gives undefined', () => {
  let same = 0;
  for (let t = 0; t < 300; t += 1) if (roamSpot(t, 1, spots) === roamSpot(t, 2, spots)) same++;
  assert.ok(same < 120, String(same));
  assert.equal(roamSpot(5, 1, []), undefined);
  const one = [{ x: 1, z: 1, fx: 0, fz: 0 }];
  assert.equal(roamSpot(100, 3, one), one[0]);
});
test('roamSpot: stays cheap an hour in', () => {
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) roamSpot(3600 + i, i % 9, spots);
  assert.ok(performance.now() - t0 < 500);
});

const tally = (fn: (t: number) => string | undefined, secs = 600) => { const c = new Map<string, number>(); for (let t = 0; t < secs; t += 0.5) { const p = fn(t) ?? '∅'; c.set(p, (c.get(p) ?? 0) + 1); } return c; };

test('workSpot: with a file being edited, most of the time there, but it also visits the task\'s other files', () => {
  const c = tally((t) => workSpot(t, 5, 'a.ts', ['a.ts', 'b.ts', 'c.ts']));
  const total = [...c.values()].reduce((x, y) => x + y, 0);
  assert.ok(c.get('a.ts')! / total > 0.55 && c.get('a.ts')! / total < 0.85, JSON.stringify([...c]));
  assert.ok(c.has('b.ts') && c.has('c.ts'));
  assert.ok(!c.has('∅'));
});

test('workSpot: no current file (running commands, reading) → walks between the task\'s files', () => {
  const c = tally((t) => workSpot(t, 2, undefined, ['a.ts', 'b.ts', 'c.ts']));
  for (const p of ['a.ts', 'b.ts', 'c.ts']) assert.ok((c.get(p) ?? 0) > 100, JSON.stringify([...c]));
  let changes = 0, prev = workSpot(0, 2, undefined, ['a.ts', 'b.ts']);
  for (let t = 0.5; t < 120; t += 0.5) { const p = workSpot(t, 2, undefined, ['a.ts', 'b.ts']); if (p !== prev) changes++; prev = p; }
  assert.ok(changes >= 8 && changes <= 20, String(changes)); // moves every ~6–14 s, not every frame
});

test('workSpot: only the current file, or nothing at all', () => {
  assert.equal(workSpot(33, 1, 'a.ts', []), 'a.ts');
  assert.equal(workSpot(33, 1, undefined, []), undefined);
  assert.equal(workSpot(33, 1, undefined, ['only.ts']), 'only.ts');
  assert.equal(workSpot(42, 3, 'a.ts', ['b.ts']), workSpot(42, 3, 'a.ts', ['b.ts'])); // deterministic
});
