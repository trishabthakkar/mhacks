import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { PlantStage } from '../../../shared/types.ts';
import { PlantField } from './plantField.ts';

const field = () => new PlantField(new THREE.Scene());
const plant = (f: PlantField, path: string, stage: PlantStage, bloom?: string) => f.upsert(path, 0, 0, 1, stage, 0, true, 0, true, bloom).inst;
const cyl = (f: PlantField, path: string) => f.get(path)!.parts.filter((p) => p.mesh === 1).length;
const petals = (f: PlantField, path: string) => f.get(path)!.parts.filter((p) => p.role === 'petal');

test('species look different: fern has no stem, cactus and flower do', () => {
  const f = field();
  plant(f, 'a.md', 'growing'); plant(f, 'a.ts', 'growing'); plant(f, 'a.json', 'growing');
  assert.equal(cyl(f, 'a.md'), 0);
  assert.ok(cyl(f, 'a.ts') >= 1);
  assert.ok(cyl(f, 'a.json') >= 1);
  assert.notDeepEqual(f.get('a.json')!.parts.map((p) => p.base.elements.join()), f.get('a.ts')!.parts.map((p) => p.base.elements.join()));
});

test('every species shows something on bloom (the part that opens)', () => {
  const f = field();
  for (const p of ['a.ts', 'a.test.ts', 'a.md', 'a.json', 'a.sh', 'a.png', 'x/module_bindings/']) {
    plant(f, p, 'bloom');
    assert.ok(petals(f, p).length > 0, p);
  }
});

test('seed is just the soil mound for every species', () => {
  const f = field();
  for (const p of ['a.ts', 'a.test.ts', 'a.md', 'a.json', 'a.sh', 'a.png']) { plant(f, p, 'seed'); assert.equal(f.get(p)!.parts.length, 1, p); }
});

test('shrub berries are red', () => {
  const f = field();
  plant(f, 'run.sh', 'bloom');
  const c = f.colorOf(petals(f, 'run.sh')[0]!);
  assert.ok(c.r > 0.5 && c.g < 0.3 && c.b < 0.3, c.getHexString());
});

test('flower blooms in the owner colour when given, the path colour otherwise', () => {
  const f = field();
  plant(f, 'a.ts', 'bloom', '#2a9d8f');
  assert.equal(f.colorOf(petals(f, 'a.ts')[0]!).getHexString(), '2a9d8f');
  assert.equal(f.bloomColor('a.ts').getHexString(), '2a9d8f');
  plant(f, 'a.ts', 'bloom', '#e76f51'); // owner changed: rebuilt
  assert.equal(f.colorOf(petals(f, 'a.ts')[0]!).getHexString(), 'e76f51');
});

test('dormant plants are faded (no saturated green)', () => {
  const f = field();
  for (const p of ['a.ts', 'a.md', 'a.json', 'a.sh', 'a.test.ts']) {
    plant(f, p, 'dormant');
    const hsl = { h: 0, s: 0, l: 0 };
    for (const part of f.get(p)!.parts.slice(1)) assert.ok(f.colorOf(part).getHSL(hsl).s < 0.3, `${p} ${f.colorOf(part).getHexString()}`);
  }
});

test('a generated-code hedge is low and spreads wider than a plant', () => {
  const f = field();
  plant(f, 'g/module_bindings/', 'growing');
  const xs = f.get('g/module_bindings/')!.parts.map((p) => new THREE.Vector3().setFromMatrixPosition(p.base));
  assert.ok(Math.max(...xs.map((v) => v.x)) - Math.min(...xs.map((v) => v.x)) > 1);
  assert.ok(Math.max(...xs.map((v) => v.y)) < 0.5);
});

test('ground cover differs by species', () => {
  const f = field();
  f.upsert('a.png', 0, 0, 1, 'growing', 0, false, 0, true); f.upsert('a.ts', 0, 0, 1, 'growing', 0, false, 0, true);
  assert.notEqual(f.colorOf(f.get('a.png')!.parts[0]!).getHex(), f.colorOf(f.get('a.ts')!.parts[0]!).getHex());
});
