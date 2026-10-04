import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isClick, parsePick, pickAt, pickKey, samePick, type PickInput, type PickScene } from './pick.ts';

const scene = (o: Partial<PickScene> = {}): PickScene => ({ people: [], plants: [], commits: [], beds: [], ...o });
const at = (x: number, z: number, o: Partial<PickInput> = {}): PickInput => ({ screen: { x: 500, y: 500 }, ground: { x, z }, shed: false, arch: false, ...o });

test('a person under the pointer beats the plant behind them', () => {
  const sc = scene({ people: [{ pick: { kind: 'member', key: 'trisha' }, sx: 505, sy: 498, r: 30, depth: 10 }], plants: [{ path: 'a.ts', x: 0, z: 0, size: 1 }] });
  assert.deepEqual(pickAt(at(0, 0), sc), { kind: 'member', key: 'trisha' });
});

test('of two overlapping people, the nearer to the camera wins', () => {
  const sc = scene({ people: [
    { pick: { kind: 'member', key: 'far' }, sx: 500, sy: 500, r: 30, depth: 20 },
    { pick: { kind: 'botanist' }, sx: 510, sy: 500, r: 30, depth: 8 },
  ] });
  assert.deepEqual(pickAt(at(99, 99), sc), { kind: 'botanist' });
});

test('a task pot (raycast hit) beats plants', () => {
  assert.deepEqual(pickAt(at(0, 0, { task: 7 }), scene({ plants: [{ path: 'a.ts', x: 0, z: 0, size: 1 }] })), { kind: 'task', key: 7 });
});

test('picks the nearest plant within its radius, else the bed', () => {
  const sc = scene({
    plants: [{ path: 'a.ts', x: 0, z: 0, size: 1 }, { path: 'b.ts', x: 1.7, z: 0, size: 1 }],
    beds: [{ name: 'src', x: 1, z: 0, w: 6, d: 4 }],
  });
  assert.deepEqual(pickAt(at(1.4, 0.1), sc), { kind: 'plant', key: 'b.ts' });
  assert.deepEqual(pickAt(at(1, 1.6), sc), { kind: 'bed', key: 'src' });
});

test('a lily pad beats the pond; open water is the pond', () => {
  const sc = scene({ pond: { x: 20, z: 0, r: 3 }, commits: [{ id: 42, x: 21, z: 0, size: 0.3 }] });
  assert.deepEqual(pickAt(at(21.1, 0.1), sc), { kind: 'commit', key: 42 });
  assert.deepEqual(pickAt(at(19, -1), sc), { kind: 'pond' });
});

test('shed and arch come from raycasts and only win over empty ground', () => {
  assert.deepEqual(pickAt(at(50, 50, { shed: true }), scene()), { kind: 'shed' });
  assert.deepEqual(pickAt(at(50, 50, { arch: true }), scene()), { kind: 'garden' });
  assert.deepEqual(pickAt(at(0, 0, { arch: true }), scene({ plants: [{ path: 'a.ts', x: 0, z: 0, size: 1 }] })), { kind: 'plant', key: 'a.ts' });
});

test('empty meadow (or no ground hit) picks nothing', () => {
  assert.equal(pickAt(at(50, 50), scene({ beds: [{ name: 'src', x: 0, z: 0, w: 4, d: 4 }] })), null);
  assert.equal(pickAt({ screen: { x: 0, y: 0 }, ground: null, shed: false, arch: false }, scene()), null);
});

test('stays correct with 5000 plants', () => {
  const plants = Array.from({ length: 5000 }, (_, i) => ({ path: `f${i}.ts`, x: (i % 100) * 1.7, z: Math.floor(i / 100) * 1.7, size: 1 }));
  assert.deepEqual(pickAt(at(1.7 * 37, 1.7 * 12), scene({ plants })), { kind: 'plant', key: 'f1237.ts' });
});

test('keys round-trip, including paths with colons', () => {
  for (const p of [{ kind: 'plant', key: 'src/a:b.ts' }, { kind: 'commit', key: 3 }, { kind: 'botanist' }, { kind: 'task', key: 12 }] as const) {
    assert.deepEqual(parsePick(pickKey(p)), p);
  }
  assert.equal(parsePick('nonsense:1'), null);
  assert.ok(samePick({ kind: 'bed', key: 'src' }, { kind: 'bed', key: 'src' }));
  assert.ok(!samePick({ kind: 'bed', key: 'src' }, null));
});

test('a press that moved more than 5px is a drag, not a click', () => {
  assert.ok(isClick({ x: 10, y: 10 }, { x: 13, y: 14 }));
  assert.ok(!isClick({ x: 10, y: 10 }, { x: 16, y: 10 }));
  assert.ok(!isClick(undefined, { x: 1, y: 1 }));
});
