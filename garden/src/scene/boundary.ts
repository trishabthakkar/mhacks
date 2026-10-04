// The white picket fence around the garden (one instanced mesh + merged rails) and the arch over the gate
// with the repo name painted on a hanging sign.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GardenFence } from '../boundary.ts';
import { geo, mat, mergeByMaterial, mesh } from './materials.ts';
import { PALETTE } from './palette.ts';
import { paintSign } from './signTexture.ts';

const PICKET = new THREE.BoxGeometry(0.12, 0.8, 0.05).translate(0, 0.4, 0);
const PICKET_TIP = new THREE.ConeGeometry(0.085, 0.14, 4).rotateY(Math.PI / 4).translate(0, 0.87, 0);
const PICKET_GEO = mergeGeometries([PICKET.toNonIndexed(), PICKET_TIP.toNonIndexed()])!; // body + pointed tip: the whole fence is one instanced draw

export class GardenBoundary {
  private group = new THREE.Group();
  private arch = new THREE.Group();
  private pickets?: THREE.InstancedMesh;
  private board?: THREE.Mesh;
  private signKey = '';
  private at = new THREE.Vector3();

  constructor(scene: THREE.Scene) { scene.add(this.group); }

  rebuild(f: GardenFence) {
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse((c) => { const m = c as THREE.Mesh; if (m.geometry && m.geometry !== PICKET_GEO && !Object.values(geo).includes(m.geometry as never)) m.geometry.dispose(); }); }
    this.arch = new THREE.Group(); this.board = undefined; this.signKey = '';
    const white = new THREE.MeshStandardMaterial({ color: '#f6f3ea', flatShading: true, roughness: 0.7 });
    const im = new THREE.InstancedMesh(PICKET_GEO, white, f.pickets.length), d = new THREE.Object3D();
    f.pickets.forEach((p, i) => { d.position.set(p.x, 0, p.z); d.rotation.set(0, p.ry, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.castShadow = true; im.receiveShadow = true; this.pickets = im; this.group.add(im);
    // two rails per side (merged), broken at the gate
    const rails = new THREE.Group(), r = f.rect, gx0 = f.gate.x - f.gate.w / 2, gx1 = f.gate.x + f.gate.w / 2;
    const rail = (x0: number, z0: number, x1: number, z1: number) => {
      for (const y of [0.28, 0.62]) { const m = mesh(geo.box, white, 0.06, 0.07, Math.hypot(x1 - x0, z1 - z0), (x0 + x1) / 2, y, (z0 + z1) / 2); m.rotation.y = Math.atan2(x1 - x0, z1 - z0); m.castShadow = true; rails.add(m); }
    };
    rail(r.minX, r.minZ, r.maxX, r.minZ); rail(r.minX, r.minZ, r.minX, r.maxZ); rail(r.maxX, r.minZ, r.maxX, r.maxZ);
    rail(r.minX, r.maxZ, gx0, r.maxZ); rail(gx1, r.maxZ, r.maxX, r.maxZ);
    mergeByMaterial(rails); this.group.add(rails);
    // the arch: two posts, a curved beam of short segments, a hanging board
    const wood = mat(PALETTE.woodDark), H = 3.6, half = f.gate.w / 2 + 0.6;
    for (const sx of [-1, 1]) {
      const post = mesh(geo.box, wood, 0.32, H, 0.32, f.gate.x + sx * half, H / 2, f.gate.z); post.castShadow = true; this.arch.add(post);
      const cap = mesh(geo.box, mat(PALETTE.woodLight), 0.42, 0.12, 0.42, f.gate.x + sx * half, H + 0.06, f.gate.z); this.arch.add(cap);
    }
    for (let i = 0; i < 9; i++) {
      const a0 = (i / 9) * Math.PI, a1 = ((i + 1) / 9) * Math.PI;
      const x0 = f.gate.x - Math.cos(a0) * half, x1 = f.gate.x - Math.cos(a1) * half, y0 = H + Math.sin(a0) * 0.55, y1 = H + Math.sin(a1) * 0.55;
      const seg = mesh(geo.box, wood, Math.hypot(x1 - x0, y1 - y0) + 0.04, 0.22, 0.26, (x0 + x1) / 2, (y0 + y1) / 2, f.gate.z); seg.rotation.z = Math.atan2(y1 - y0, x1 - x0); seg.castShadow = true; this.arch.add(seg);
    }
    for (const sx of [-1, 1]) this.arch.add(mesh(geo.cyl, mat('#5a4a3a'), 0.02, 0.4, 0.02, f.gate.x + sx * 1.9, H - 0.15, f.gate.z + 0.05)); // chains
    mergeByMaterial(this.arch);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.28 }));
    board.position.set(f.gate.x, H - 0.9, f.gate.z + 0.08); board.castShadow = true; board.userData.keep = true;
    this.board = board; this.arch.add(board); this.group.add(this.arch);
    this.at.set(f.gate.x, 0, f.gate.z);
  }

  /** Repaint the board only when its text changed. */
  setSign(name: string, line: string) {
    const key = `${name}\0${line}`;
    if (!this.board || key === this.signKey) return;
    this.signKey = key;
    const m = this.board.material as THREE.MeshStandardMaterial;
    m.map?.dispose(); m.map = paintSign(name, line); m.emissiveMap = m.map; m.needsUpdate = true; // self-lit a little so it reads in shade
  }

  hit(ray: THREE.Raycaster): boolean { return ray.intersectObject(this.arch, true).length > 0; }
  archPos() { return this.at; }
}
