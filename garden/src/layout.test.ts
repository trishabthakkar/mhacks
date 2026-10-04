import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BED_PAD, layoutGarden, layoutPaths, layoutTaskPlants, plantSize, SPACING, TASK_FRONT, type LayoutInput } from './layout.ts';

const sample: LayoutInput[] = [
  { path: 'src/a.ts', bed: 'src', lines: 100 }, { path: 'src/b.ts', bed: 'src', lines: 10 },
  { path: 'src/c.ts', bed: 'src', lines: 1000 }, { path: 'tests/a.test.ts', bed: 'tests', lines: 40 },
  { path: 'README.md', bed: '.', lines: 20 }, { path: 'docs/x.md', bed: 'docs', lines: 5 },
];

test('deterministic and independent of input order', () => {
  const a = layoutGarden(sample);
  assert.deepEqual(layoutGarden(sample), a);
  assert.deepEqual(layoutGarden(sample.slice().reverse()), a);
});

test('root files go to the (root) bed, placed first', () => {
  const l = layoutGarden(sample);
  assert.equal(l.beds[0]!.name, '(root)');
  assert.equal(l.plants.find((p) => p.path === 'README.md')!.bed, '(root)');
});

test('plants never overlap and stay inside their bed', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ path: `d${i % 7}/f${i}.ts`, bed: `d${i % 7}`, lines: i }));
  const l = layoutGarden(many);
  for (const p of l.plants) {
    const b = l.beds.find((x) => x.name === p.bed)!;
    assert.ok(Math.abs(p.x - b.x) <= b.w / 2 - BED_PAD + 1e-6 && Math.abs(p.z - b.z) <= b.d / 2 - BED_PAD + 1e-6);
  }
  for (let i = 0; i < l.plants.length; i++) for (let j = i + 1; j < l.plants.length; j++) {
    const a = l.plants[i]!, b = l.plants[j]!;
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= SPACING - 1e-6, `${a.path} overlaps ${b.path}`);
  }
});

test('beds do not overlap', () => {
  const l = layoutGarden(sample);
  for (let i = 0; i < l.beds.length; i++) for (let j = i + 1; j < l.beds.length; j++) {
    const a = l.beds[i]!, b = l.beds[j]!;
    const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.z - b.z) >= (a.d + b.d) / 2;
    assert.ok(apart, `${a.name} overlaps ${b.name}`);
  }
});

test('plant size is clamped and monotonic', () => {
  assert.equal(plantSize(0) >= 0.6, true);
  assert.equal(plantSize(1e9), 1.6);
  assert.ok(plantSize(10) <= plantSize(1000));
});

test('tests bed is a greenhouse', () => {
  assert.equal(layoutGarden(sample).beds.find((b) => b.name === 'tests')!.greenhouse, true);
});

test('task plants sit on the path in front of their bed, deterministic, no overlap with file plants', () => {
  const l = layoutGarden([{ path: 'mcp/src/a.ts', bed: 'mcp', lines: 10 }, { path: 'mcp/src/b.ts', bed: 'mcp', lines: 10 }, { path: 'garden/x.ts', bed: 'garden', lines: 5 }]);
  const tasks = [{ id: 2, bed: 'mcp', status: 'active', updatedAt: 5 }, { id: 1, bed: 'mcp', status: 'done', updatedAt: 9 }, { id: 3, bed: 'nope', status: 'active', updatedAt: 1 }];
  const a = layoutTaskPlants(l, tasks), b = layoutTaskPlants(l, [...tasks].reverse());
  assert.deepEqual(a, b);
  const mcp = l.beds.find((x) => x.name === 'mcp')!;
  for (const t of a.filter((x) => x.bed === 'mcp')) {
    assert.ok(Math.abs(t.z - (mcp.z + mcp.d / 2 + TASK_FRONT)) < 1e-6);
    for (const p of l.plants) assert.ok(Math.hypot(p.x - t.x, p.z - t.z) > 1, 'no overlap');
  }
  assert.equal(a.find((x) => x.id === 3)!.bed, l.beds[0]!.name); // unknown bed → first bed
});

test('at most 6 done task plants are kept (newest)', () => {
  const l = layoutGarden([{ path: 'a/x.ts', bed: 'a', lines: 1 }]);
  const tasks = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, bed: 'a', status: 'done', updatedAt: i }));
  assert.deepEqual(layoutTaskPlants(l, tasks).map((t) => t.id).sort((x, y) => x - y), [4, 5, 6, 7, 8, 9]);
});

test('task pots keep clear of every bed, including the next row behind them', () => {
  // wide beds force several rows
  const plants = ['garden', 'mcp', 'companion', 'spacetimedb', 'docs', 'demo'].flatMap((bed) =>
    Array.from({ length: 30 }, (_, i) => ({ path: `${bed}/f${i}.ts`, bed, lines: 50 })));
  const l = layoutGarden(plants);
  assert.ok(new Set(l.beds.map((b) => b.z)).size >= 2, 'expected more than one row');
  const tasks = l.beds.map((b, i) => ({ id: i + 1, bed: b.name, status: 'active', updatedAt: 0 }));
  for (const t of layoutTaskPlants(l, tasks)) for (const b of l.beds) {
    const dx = Math.max(0, Math.abs(t.x - b.x) - b.w / 2), dz = Math.max(0, Math.abs(t.z - b.z) - b.d / 2);
    assert.ok(Math.hypot(dx, dz) >= 1.5, `task ${t.id} (${t.bed}) is ${Math.hypot(dx, dz).toFixed(2)} from ${b.name}`);
  }
});

test('one gravel path per bed row, through the task pots, never over a bed', () => {
  const plants = ['garden', 'mcp', 'companion', 'spacetimedb', 'docs', 'demo'].flatMap((bed) =>
    Array.from({ length: 30 }, (_, i) => ({ path: `${bed}/f${i}.ts`, bed, lines: 50 })));
  const l = layoutGarden(plants);
  const rows = new Set(l.beds.map((b) => b.z - b.d / 2)).size;
  const paths = layoutPaths(l);
  assert.equal(paths.filter((p) => p.w > p.d).length, rows);
  const tasks = l.beds.map((b, i) => ({ id: i + 1, bed: b.name, status: 'active', updatedAt: 0 }));
  for (const t of layoutTaskPlants(l, tasks)) {
    assert.ok(paths.some((p) => Math.abs(t.x - p.x) <= p.w / 2 && Math.abs(t.z - p.z) <= p.d / 2), `task ${t.id} off the path`);
  }
  for (const p of paths) for (const b of l.beds) {
    const apart = Math.abs(p.x - b.x) >= (p.w + b.w) / 2 - 1e-6 || Math.abs(p.z - b.z) >= (p.d + b.d) / 2 - 1e-6;
    assert.ok(apart, `path at z=${p.z} overlaps ${b.name}`);
  }
  assert.deepEqual(layoutPaths(l), paths);
});

test('a spine path down the side links every row path', () => {
  const plants = ['garden', 'mcp', 'companion', 'spacetimedb'].flatMap((bed) =>
    Array.from({ length: 30 }, (_, i) => ({ path: `${bed}/f${i}.ts`, bed, lines: 50 })));
  const paths = layoutPaths(layoutGarden(plants));
  const spine = paths.find((p) => p.d > p.w)!;
  assert.ok(spine, 'no spine');
  for (const p of paths.filter((x) => x !== spine)) {
    const touchX = Math.abs(p.x - spine.x) <= (p.w + spine.w) / 2, touchZ = Math.abs(p.z - spine.z) <= (p.d + spine.d) / 2;
    assert.ok(touchX && touchZ, `row path at z=${p.z} not linked`);
  }
});
