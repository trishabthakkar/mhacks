import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GardenLamps } from './lamps.ts';

test('prewarm compiles the scene once with the lamp lights on, then restores the day state (no stutter at dusk)', () => {
  const scene = new THREE.Scene(), lamps = new GardenLamps(scene, 'high');
  lamps.rebuild([{ x: 0, z: 0, kind: 'arch', real: true }, { x: 4, z: 0, kind: 'post', real: false }]);
  lamps.setLevel(0);
  const seen: boolean[] = [];
  const renderer = { compile: () => { seen.push(lamps.group.visible); } };
  lamps.prewarm(renderer as never, new THREE.PerspectiveCamera());
  assert.deepEqual(seen, [true]);
  assert.equal(lamps.group.visible, false);
  lamps.prewarm(renderer as never, new THREE.PerspectiveCamera()); // only once
  assert.equal(seen.length, 1);
});
