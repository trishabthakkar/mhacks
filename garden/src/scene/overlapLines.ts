// Glowing amber dashes between two teammates who are about to edit the same files (see overlap.ts), at waist height
// and marching toward each other, so the collision warning is visible in the garden too. One instanced mesh, no
// per-frame allocation. (WebGL lines are one pixel wide, which a projector loses.)
import * as THREE from 'three';
import type { Overlap } from '../overlap.ts';

const MAX = 240, STEP = 0.6, Y = 0.9;

export class OverlapLines {
  readonly mesh: THREE.InstancedMesh;
  private d = new THREE.Object3D();
  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 0.07, 0.07),
      new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff9a00, emissiveIntensity: 1.2 }), MAX);
    this.mesh.count = 0; this.mesh.frustumCulled = false; scene.add(this.mesh);
  }

  /** Per frame: dashes from each pair's first person to the second (`posOf` says where a member is). `t` marches them. */
  update(pairs: Overlap[], posOf: (handle: string) => THREE.Vector3 | undefined, t: number) {
    let n = 0;
    for (const o of pairs) {
      const a = posOf(o.a), b = posOf(o.b);
      if (!a || !b) continue;
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 1) continue;
      const k = Math.floor(len / STEP), shift = ((t * 0.8) % 1) * STEP, ry = -Math.atan2(dz, dx);
      for (let i = 0; i < k && n < MAX; i++) {
        const s = (i * STEP + shift + STEP / 2) % (k * STEP) / len;
        if (s <= 0.03 || s >= 0.97) continue; // keep clear of the people themselves
        this.d.position.set(a.x + dx * s, Y, a.z + dz * s); this.d.rotation.set(0, ry, 0); this.d.updateMatrix();
        this.mesh.setMatrixAt(n++, this.d.matrix);
      }
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
}
