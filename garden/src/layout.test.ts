import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BED_PAD, layoutGarden, plantSize, SPACING, type LayoutInput } from './layout.ts';

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
