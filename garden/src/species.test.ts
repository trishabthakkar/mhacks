import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BED_PALETTE, bedStyleOf, collapseGenerated, plantJitter, speciesOf } from './species.ts';
import type { PlantView } from '../../shared/types.ts';

test('code files are flowers', () => {
  assert.equal(speciesOf('src/a.ts'), 'flower');
  assert.equal(speciesOf('garden/index.html'), 'flower');
  assert.equal(speciesOf('mcp/src/server.js'), 'flower');
});

test('files with no extension are flowers', () => {
  assert.equal(speciesOf('Makefile'), 'flower');
  assert.equal(speciesOf('bin/sprout'), 'flower');
});

test('tests are sunflowers: *.test.* or anything under a tests/ folder', () => {
  assert.equal(speciesOf('src/layout.test.ts'), 'sunflower');
  assert.equal(speciesOf('tests/helpers.ts'), 'sunflower');
  assert.equal(speciesOf('companion/tests/fixtures/data.json'), 'sunflower');
});

test('markdown is fern, case-insensitive', () => {
  assert.equal(speciesOf('README.md'), 'fern');
  assert.equal(speciesOf('docs/NOTES.MD'), 'fern');
});

test('config is cactus: json, tsconfig*, dotfiles, yaml', () => {
  assert.equal(speciesOf('package.json'), 'cactus');
  assert.equal(speciesOf('garden/tsconfig.build.json'), 'cactus');
  assert.equal(speciesOf('tsconfig'), 'cactus');
  assert.equal(speciesOf('.gitignore'), 'cactus');
  assert.equal(speciesOf('companion/.env.example'), 'cactus');
  assert.equal(speciesOf('.github/ci.yml'), 'cactus');
});

test('shell scripts are shrubs', () => {
  assert.equal(speciesOf('scripts/deploy.sh'), 'shrub');
});

test('images are stones', () => {
  for (const p of ['a.png', 'b/c.JPG', 'd.jpeg', 'e.gif', 'f.svg', 'g.webp']) assert.equal(speciesOf(p), 'stone', p);
});

test('generated module_bindings are clover, beating every other rule', () => {
  assert.equal(speciesOf('garden/src/module_bindings/index.ts'), 'clover');
  assert.equal(speciesOf('module_bindings/types.ts'), 'clover');
  assert.equal(speciesOf('mcp/src/module_bindings/foo.test.ts'), 'clover');
  assert.equal(speciesOf('garden/src/module_bindings/'), 'clover');
});

const pv = (path: string, bed: string, extra: Partial<PlantView> = {}): PlantView =>
  ({ path, bed, lines: 10, stage: 'growing', bugs: 0, lastActivity: 0, ...extra });

test('collapseGenerated folds each module_bindings folder into one hedge plant', () => {
  const plants = [
    pv('garden/src/main.ts', 'garden'),
    pv('garden/src/module_bindings/a.ts', 'garden', { lines: 30, lastActivity: 5 }),
    pv('garden/src/module_bindings/b.ts', 'garden', { lines: 12, lastActivity: 9 }),
    pv('mcp/src/module_bindings/a.ts', 'mcp', { stage: 'dormant' }),
  ];
  const { plants: out, hedgeOf } = collapseGenerated(plants);
  assert.deepEqual(out.map((p) => p.path).sort(), ['garden/src/main.ts', 'garden/src/module_bindings/', 'mcp/src/module_bindings/']);
  const g = out.find((p) => p.path === 'garden/src/module_bindings/')!;
  assert.equal(g.bed, 'garden');
  assert.equal(g.lines, 42);
  assert.equal(g.lastActivity, 9);
  assert.equal(g.stage, 'growing');
  assert.equal(g.bugs, 0);
  assert.equal(hedgeOf.get('garden/src/module_bindings/b.ts'), 'garden/src/module_bindings/');
  assert.equal(hedgeOf.has('garden/src/main.ts'), false);
});

test('a hedge is dormant only when every generated file in it is dormant', () => {
  const { plants: out } = collapseGenerated([pv('m/module_bindings/a.ts', 'm', { stage: 'dormant' }), pv('m/module_bindings/b.ts', 'm', { stage: 'dormant' })]);
  assert.equal(out[0]!.stage, 'dormant');
});

test('collapseGenerated is order-independent and leaves a repo without bindings untouched', () => {
  const plants = [pv('a/module_bindings/x.ts', 'a'), pv('a/b.ts', 'a'), pv('a/module_bindings/y.ts', 'a')];
  assert.deepEqual(collapseGenerated(plants).plants, collapseGenerated(plants.slice().reverse()).plants.slice().sort((x, y) => (x.path < y.path ? -1 : 1)));
  const plain = [pv('a/b.ts', 'a')];
  assert.deepEqual(collapseGenerated(plain).plants, plain);
});

test('bed style: tests is the greenhouse, root is stepping stones', () => {
  assert.equal(bedStyleOf('tests').kind, 'greenhouse');
  assert.equal(bedStyleOf('(root)').kind, 'stones');
  assert.equal(bedStyleOf('garden').kind, 'raised');
});

test('bed style is deterministic, from the fixed palette, and varies across folders', () => {
  const names = ['companion', 'garden', 'mcp', 'spacetimedb', 'shared', 'demo', 'docs', 'status', 'scripts'];
  for (const n of names) {
    assert.deepEqual(bedStyleOf(n), bedStyleOf(n));
    assert.ok(BED_PALETTE.some((p) => p.border === bedStyleOf(n).border), n);
  }
  assert.ok(new Set(names.map((n) => bedStyleOf(n).border)).size >= 3);
});

test('plant jitter is small, stable per file, and varies between files', () => {
  const seen = new Set<string>();
  for (const p of ['a.ts', 'b.ts', 'src/c.ts', 'd/e/f.ts', 'g.md', 'h.json']) {
    const j = plantJitter(p);
    assert.deepEqual(plantJitter(p), j);
    assert.ok(Math.abs(j.dh) <= 0.03 && Math.abs(j.dl) <= 0.06, `${p} ${JSON.stringify(j)}`);
    seen.add(`${j.dh.toFixed(3)},${j.dl.toFixed(3)}`);
  }
  assert.ok(seen.size >= 5);
});
