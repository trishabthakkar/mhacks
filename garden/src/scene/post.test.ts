import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { skipsAO } from './post.ts';

test('sprites, points, lines and see-through overlays stay out of the AO depth pass (else they print dark squares)', () => {
  assert.equal(skipsAO(new THREE.Sprite(new THREE.SpriteMaterial())), true);
  assert.equal(skipsAO(new THREE.Points()), true);
  assert.equal(skipsAO(new THREE.Line()), true);
  assert.equal(skipsAO(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }))), true);
  assert.equal(skipsAO(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())), false);
});
