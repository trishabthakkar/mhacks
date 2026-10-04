import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GardenSnapshot } from '../../shared/types.ts';
import { layoutGarden, layoutPaths } from './layout.ts';
import { BANK, pondSpot } from './pond.ts';
import { borderStrips, gardenFence, inRect, repoName, signLine } from './boundary.ts';

const files = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `d${i % 5}/f${i}.ts`, bed: `d${i % 5}`, lines: 50 }));
const frontZ = (l: ReturnType<typeof layoutGarden>) => Math.max(4, l.depth / 2) + 3.6;

for (const n of [3, 40, 400]) {
  test(`fence (${n} files) encloses beds, paths, pond, shed and lane, with a gate on the front`, () => {
    const l = layoutGarden(files(n)), fz = frontZ(l), f = gardenFence(l, fz), halfW = Math.max(6, l.width / 2), halfD = Math.max(4, l.depth / 2);
    for (const b of l.beds) for (const [x, z] of [[b.x - b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z + b.d / 2]]) assert.ok(inRect(f.rect, x!, z!, 1), `bed ${b.name}`);
    for (const p of layoutPaths(l)) assert.ok(inRect(f.rect, p.x - p.w / 2, p.z, 0.5) && inRect(f.rect, p.x + p.w / 2, p.z, 0.5), 'path');
    const ps = pondSpot(l);
    assert.ok(inRect(f.rect, ps.x + ps.r * BANK, ps.z + ps.r * BANK, 0.5) && inRect(f.rect, ps.x - ps.r * BANK, ps.z - ps.r * BANK, 0.5), 'pond');
    assert.ok(inRect(f.rect, halfW - 1.5, -halfD - 6.5, 0.5), 'shed');
    assert.ok(inRect(f.rect, -(halfW + 3.5), fz, 1) && inRect(f.rect, halfW + 3.5, fz, 1), 'front lane');
    assert.equal(f.gate.z, f.rect.maxZ);
    assert.ok(Math.abs(f.gate.x - (f.rect.minX + f.rect.maxX) / 2) < 0.01, 'gate centred on the front');
    assert.ok(Math.abs(f.gate.x) + f.gate.w / 2 < halfW + 3.5, 'gate opens onto the lane');
    assert.ok(f.pickets.length > 20);
    assert.ok(f.pickets.every((p) => !(Math.abs(p.z - f.rect.maxZ) < 0.01 && Math.abs(p.x - f.gate.x) < f.gate.w / 2)), 'no picket in the gate');
    assert.ok(f.pickets.every((p) => Math.abs(p.x - f.rect.minX) < 0.01 || Math.abs(p.x - f.rect.maxX) < 0.01 || Math.abs(p.z - f.rect.minZ) < 0.01 || Math.abs(p.z - f.rect.maxZ) < 0.01), 'pickets on the line');
  });
}

const snap = (o: Partial<GardenSnapshot> = {}): GardenSnapshot => ({ at: 0, members: [], agents: [], plants: [], claims: [], messages: [], testRuns: [], certifications: [], activity: [], ...o });

test('repo name: ?repo, then the latest test run repo, then the db name, then a default', () => {
  const run = (repo: string, at: number) => ({ id: at, handle: 'a', repo, command: '', exitCode: 0, at });
  assert.equal(repoName(new URLSearchParams('repo=Sprout'), snap(), 'sprout-mhacks'), 'Sprout');
  assert.equal(repoName(new URLSearchParams(), snap({ testRuns: [run('/Users/x/old', 1), run('/Users/x/Projects/mhacks/', 2)] }), 'sprout-demo'), 'mhacks');
  assert.equal(repoName(new URLSearchParams(), snap({ testRuns: [run('git@github.com:team/cool-app.git', 1)] }), ''), 'cool-app');
  assert.equal(repoName(new URLSearchParams(), snap(), 'sprout-mhacks'), 'mhacks');
  assert.equal(repoName(new URLSearchParams(), snap(), ''), 'our garden');
  assert.equal(repoName(new URLSearchParams(`repo=${'x'.repeat(60)}`), snap(), '').length, 28);
});

test('sign line counts people online, plants and blooms today', () => {
  const s = snap({ at: 10 * 86_400_000,
    members: [{ handle: 'a', color: '', online: true, paused: false, lastSeen: 0 }, { handle: 'b', color: '', online: false, paused: false, lastSeen: 0 }],
    plants: [{ path: 'a', bed: '', lines: 1, stage: 'bloom', bugs: 0, lastActivity: 0, lastBloomAt: 10 * 86_400_000 - 1000 }, { path: 'b', bed: '', lines: 1, stage: 'seed', bugs: 0, lastActivity: 0 }] });
  assert.equal(signLine(s), '1 gardener · 2 plants · 1 🌸 today');
});

test('flower borders run along the inside of the fence, clear of the gate and everything in the way', () => {
  const rect = { minX: -20, maxX: 20, minZ: -15, maxZ: 15 }, gate = { x: 0, z: 15, w: 3.6 };
  const shed = { x: 12, z: -13, w: 4, d: 3.5 }, lane = { x: 0, z: 12.5, w: 30, d: 3.2 }, pond = { x: 14, z: 0, r: 5 };
  const strips = borderStrips(rect, gate, [shed, lane], [pond]);
  assert.ok(strips.length >= 4);
  const overlaps = (a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }) =>
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
  for (const s of strips) {
    assert.ok(s.x - s.w / 2 >= rect.minX && s.x + s.w / 2 <= rect.maxX && s.z - s.d / 2 >= rect.minZ && s.z + s.d / 2 <= rect.maxZ, 'inside the fence');
    assert.ok(!overlaps(s, shed) && !overlaps(s, lane), 'clear of the shed and lane');
    const nx = Math.max(Math.abs(pond.x - s.x) - s.w / 2, 0), nz = Math.max(Math.abs(pond.z - s.z) - s.d / 2, 0);
    assert.ok(Math.hypot(nx, nz) > pond.r, 'clear of the pond');
    assert.ok(!overlaps(s, { x: gate.x, z: gate.z - 1, w: gate.w + 1, d: 2 }), 'gate left open');
    assert.ok(Math.max(s.w, s.d) >= 1.5, 'no stubs');
  }
  const total = strips.reduce((a, s) => a + Math.max(s.w, s.d), 0);
  assert.ok(total > 70, `borders too sparse: ${total.toFixed(1)} m`);
  assert.deepEqual(borderStrips(rect, gate, [shed, lane], [pond]), strips);
});
