import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityView } from '../../shared/types.ts';
import { layoutGarden } from './layout.ts';
import { lilyPads, MAX_PADS, pondSpot } from './pond.ts';

const HOUR = 3_600_000, NOW = 100 * HOUR;
const act = (id: number, kind: ActivityView['kind'], at: number): ActivityView => ({ id, at, handle: 'manahil', kind, detail: '' });

test('the pond sits to the right of the beds without touching any', () => {
  const l = layoutGarden(['a', 'b', 'c', 'd'].flatMap((bed) => Array.from({ length: 20 }, (_, i) => ({ path: `${bed}/${i}.ts`, bed, lines: 9 }))));
  const p = pondSpot(l);
  assert.ok(p.r >= 2);
  for (const b of l.beds) assert.ok(p.x - p.r > b.x + b.w / 2 + 2, `pond overlaps ${b.name}`);
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
