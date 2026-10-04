import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutGarden, layoutPaths } from './layout.ts';
import { gardenFence } from './boundary.ts';
import { pondSpot } from './pond.ts';
import { lampLevel, lampSpots } from './lamps.ts';

const files = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `d${i % 5}/f${i}.ts`, bed: `d${i % 5}`, lines: 50 }));
const garden = (n: number) => {
  const l = layoutGarden(files(n)), f = gardenFence(l, Math.max(4, l.depth / 2) + 3.6);
  return { l, f, shed: { x: f.rect.maxX - 3, z: f.rect.minZ + 3 } };
};

test('lampLevel: off by day, on at night, ramps at dusk and dawn', () => {
  assert.equal(lampLevel(12), 0); assert.equal(lampLevel(23), 1); assert.equal(lampLevel(2), 1); assert.equal(lampLevel(7), 0);
  assert.ok(lampLevel(19.25) > 0.3 && lampLevel(19.25) < 0.7);
  assert.ok(lampLevel(6) > 0 && lampLevel(6) < 1);
});

for (const n of [3, 40]) {
  test(`lampSpots (${n} files): fence posts but none in the gate, arch pair, shed lamp, path lights, ≤4 real`, () => {
    const { l, f, shed } = garden(n);
    const L = lampSpots(f, layoutPaths(l), shed, { beds: l.beds, pond: pondSpot(l) });
    const posts = L.filter((x) => x.kind === 'post');
    assert.ok(posts.length >= 4);
    assert.ok(!posts.some((x) => Math.abs(x.z - f.rect.maxZ) < 0.3 && Math.abs(x.x - f.gate.x) < f.gate.w / 2 + 0.3), 'post in the gate');
    assert.equal(L.filter((x) => x.kind === 'arch').length, 2);
    assert.equal(L.filter((x) => x.kind === 'shed').length, 1);
    assert.ok(L.filter((x) => x.kind === 'path').length >= 1);
    assert.ok(L.filter((x) => x.real).length <= 4 && L.filter((x) => x.real).length >= 3);
    for (const x of L) assert.ok(x.x >= f.rect.minX - 0.01 && x.x <= f.rect.maxX + 0.01 && x.z >= f.rect.minZ - 0.01 && x.z <= f.rect.maxZ + 0.01, 'outside the fence');
    for (const x of L.filter((y) => y.kind === 'path')) for (const b of l.beds) assert.ok(!(Math.abs(x.x - b.x) < b.w / 2 + 0.2 && Math.abs(x.z - b.z) < b.d / 2 + 0.2), `path lamp in bed ${b.name}`);
  });
}

test('lampSpots: a big garden stays bounded', () => {
  const { l, f, shed } = garden(400);
  assert.ok(lampSpots(f, layoutPaths(l), shed, { beds: l.beds, pond: pondSpot(l) }).length < 140);
});

test('lampSpots: a sparse scatter, not a runway (≤ 16 lamps for a normal garden, ≤ 30 for a huge one)', () => {
  for (const [n, max] of [[40, 16], [400, 30]] as const) {
    const { l, f, shed } = garden(n);
    const L = lampSpots(f, layoutPaths(l), shed, { beds: l.beds, pond: pondSpot(l) });
    assert.ok(L.length <= max, `${n} files: ${L.length} lamps`);
  }
});
