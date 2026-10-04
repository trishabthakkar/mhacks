import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GardenBoundary } from './boundary.ts';
import { gardenFence } from '../boundary.ts';
import { layoutGarden } from '../layout.ts';

test('review fix: rebuilding the fence frees the old pickets, materials and sign (no GPU leak per layout change)', () => {
  const scene = new THREE.Scene(), b = new GardenBoundary(scene);
  const f = gardenFence(layoutGarden([{ path: 'a/x.ts', bed: 'a', lines: 10 }]), 8);
  b.rebuild(f);
  const disposed = new Set<string>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((m as THREE.InstancedMesh).isInstancedMesh) m.addEventListener('dispose' as never, () => disposed.add('pickets'));
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const x of mats) if ((x as THREE.MeshStandardMaterial).color?.getHexString() === 'f6f3ea') x.addEventListener('dispose', () => disposed.add('white'));
    if (m.geometry?.type === 'PlaneGeometry') (m.material as THREE.Material).addEventListener('dispose', () => disposed.add('board'));
  });
  b.rebuild(f);
  assert.deepEqual([...disposed].sort(), ['board', 'pickets', 'white']);
});
