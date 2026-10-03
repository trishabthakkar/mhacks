import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Nav, segmentHitsRect, type BedBox, type Pt } from './nav.ts';
import { layoutGarden } from './layout.ts';

const beds: BedBox[] = [
  { x: -6, z: 0, w: 6, d: 6 }, { x: 0, z: 0, w: 6, d: 6 }, { x: 6, z: 0, w: 6, d: 6 },
];

const pathCrosses = (nav: Nav, from: Pt, pts: Pt[], boxes: BedBox[], ignore: (i: number) => boolean) => {
  let a = from;
  for (const b of pts) {
    for (let i = 0; i < boxes.length; i++) {
      if (ignore(i)) continue;
      const r = { minX: boxes[i]!.x - boxes[i]!.w / 2, maxX: boxes[i]!.x + boxes[i]!.w / 2, minZ: boxes[i]!.z - boxes[i]!.d / 2, maxZ: boxes[i]!.z + boxes[i]!.d / 2 };
      if (segmentHitsRect(a.x, a.z, b.x, b.z, r)) return true;
    }
    a = b;
  }
  return false;
};

test('segment vs rect', () => {
  const r = { minX: 0, maxX: 2, minZ: 0, maxZ: 2 };
  assert.equal(segmentHitsRect(-1, 1, 3, 1, r), true);
  assert.equal(segmentHitsRect(-1, 3, 3, 3, r), false);
  assert.equal(segmentHitsRect(-1, 0, 3, 0, r), false, 'grazing the edge is allowed');
  assert.equal(segmentHitsRect(1, 1, 1.5, 1.5, r), true, 'inside');
});

test('open ground: straight line', () => {
  const nav = new Nav(beds);
  const p = nav.path(-9, 6, 9, 6);
  assert.deepEqual(p, [{ x: 9, z: 6 }]);
});

test('walks around the middle bed instead of through it', () => {
  const nav = new Nav(beds);
  const p = nav.path(0, -6, 0, 6);
  assert.ok(p.length >= 2, 'needs a detour waypoint');
  assert.deepEqual(p.at(-1), { x: 0, z: 6 });
  assert.equal(pathCrosses(nav, { x: 0, z: -6 }, p, beds, () => false), false);
});

test('goal inside a bed: path may enter only that bed', () => {
  const nav = new Nav(beds);
  const start = { x: -9, z: 6 };
  const goal = { x: 6, z: 0 }; // inside the right bed, behind the others
  const p = nav.path(start.x, start.z, goal.x, goal.z);
  assert.deepEqual(p.at(-1), goal);
  assert.equal(pathCrosses(nav, start, p, beds, (i) => i === 2), false);
});

test('start inside a bed leaves it and avoids the others', () => {
  const nav = new Nav(beds);
  const start = { x: -6, z: 0 }, goal = { x: 6, z: 5 };
  const p = nav.path(start.x, start.z, goal.x, goal.z);
  assert.equal(pathCrosses(nav, start, p, beds, (i) => i === 0), false);
});

test('works on a real layout: every plant is reachable without crossing foreign beds', () => {
  const plants = Array.from({ length: 120 }, (_, i) => ({ path: `d${i % 6}/f${i}.ts`, bed: `d${i % 6}`, lines: i }));
  const l = layoutGarden(plants);
  const nav = new Nav(l.beds);
  const start = { x: 0, z: l.depth / 2 + 3 };
  for (const p of l.plants.filter((_, i) => i % 7 === 0)) {
    const path = nav.path(start.x, start.z, p.x, p.z);
    const home = nav.bedAt(p.x, p.z);
    assert.deepEqual(path.at(-1), { x: p.x, z: p.z });
    assert.equal(pathCrosses(nav, start, path, l.beds, (i) => i === home), false, p.path);
  }
});
