import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityView } from '../../shared/types.ts';
import { layoutGarden, layoutPaths } from './layout.ts';
import { BANK, lilyPads, MAX_PADS, pondLink, pondSpot } from './pond.ts';

const HOUR = 3_600_000, NOW = 100 * HOUR;
const act = (id: number, kind: ActivityView['kind'], at: number): ActivityView => ({ id, at, handle: 'manahil', kind, detail: '' });

const garden = (rows: number) => layoutGarden(Array.from({ length: rows * 2 }, (_, b) => `bed${b}`)
  .flatMap((bed) => Array.from({ length: 30 }, (_, i) => ({ path: `${bed}/${i}.ts`, bed, lines: 9 }))));

test('the pond and its bank stay clear of every bed and every path end', () => {
  for (const rows of [1, 2, 4]) {
    const l = garden(rows), p = pondSpot(l), edge = p.x - p.r * BANK;
    assert.ok(p.r >= 2);
    for (const b of l.beds) assert.ok(edge > b.x + b.w / 2 + 1, `pond overlaps ${b.name}`);
    for (const q of layoutPaths(l)) assert.ok(edge > q.x + q.w / 2 + 0.5, 'pond overlaps a path');
  }
});

test('the pond lines up with a row path, and a link path runs from it to the water', () => {
  for (const rows of [1, 3, 4]) {
    const l = garden(rows), p = pondSpot(l), paths = layoutPaths(l), link = pondLink(l);
    const row = paths.find((q) => q.w > q.d && Math.abs(q.z - p.z) < 1e-6);
    assert.ok(row, 'pond not aligned with a row path');
    assert.ok(Math.abs(link.x - link.w / 2 - (row.x + row.w / 2)) < 0.3, 'link does not start at the row path');
    assert.ok(link.x + link.w / 2 >= p.x - p.r * 1.05, 'link does not reach the water');
    assert.ok(Math.abs(link.z - p.z) < 1e-6);
  }
});

test('one lily pad per commit from the last day, nothing else', () => {
  const pads = lilyPads([act(1, 'commit', NOW - HOUR), act(2, 'test_pass', NOW - HOUR), act(3, 'commit', NOW - 30 * HOUR), act(4, 'commit', NOW)], NOW, 3);
  assert.deepEqual(pads.map((p) => p.id).sort(), [1, 4]);
});

test('at most MAX_PADS pads, the newest commits', () => {
  const many = Array.from({ length: 40 }, (_, i) => act(i + 1, 'commit', NOW - i * 60_000));
  const pads = lilyPads(many, NOW, 3);
  assert.equal(pads.length, MAX_PADS);
  assert.ok(pads.every((p) => p.id <= MAX_PADS));
});

test('pads float inside the pond and keep their place as new commits arrive', () => {
  const a = lilyPads([act(7, 'commit', NOW - HOUR)], NOW, 3)[0]!;
  const b = lilyPads([act(7, 'commit', NOW - HOUR), act(8, 'commit', NOW)], NOW, 3).find((p) => p.id === 7)!;
  assert.deepEqual(a, b);
  for (let id = 1; id < 60; id++) {
    const p = lilyPads([act(id, 'commit', NOW)], NOW, 3)[0]!;
    assert.ok(Math.hypot(p.x, p.z) + p.size <= 3 * 0.9, `pad ${id} outside`);
  }
});
