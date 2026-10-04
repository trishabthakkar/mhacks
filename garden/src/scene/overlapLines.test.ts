import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OverlapLines } from './overlapLines.ts';

test('OverlapLines: glowing dashes run between each overlapping pair, none once the overlap ends', () => {
  const scene = new THREE.Scene(), lines = new OverlapLines(scene);
  const pos = new Map([['ana', new THREE.Vector3(0, 0, 0)], ['ben', new THREE.Vector3(8, 0, 0)], ['cy', new THREE.Vector3(-4, 0, 0)]]);
  lines.update([{ a: 'ana', b: 'ben', path: 'x' }, { a: 'ana', b: 'ghost', path: 'z' }], (h) => pos.get(h), 0);
  const n = lines.mesh.count;
  assert.ok(n >= 8 && n <= 14, String(n)); // ~one dash per 0.6 m over 8 m; the ghost pair has no position
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) { lines.mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m); assert.ok(p.x > 0 && p.x < 8 && Math.abs(p.z) < 1e-6, `${p.x}`); }
  lines.update([{ a: 'ana', b: 'ben', path: 'x' }, { a: 'ana', b: 'cy', path: 'y' }], (h) => pos.get(h), 0);
  assert.ok(lines.mesh.count > n);
  lines.update([], (h) => pos.get(h), 1);
  assert.equal(lines.mesh.count, 0);
});
