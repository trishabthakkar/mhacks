import * as THREE from 'three';
import type { ActivityView, MemberView } from '../../../shared/types.ts';
import { lilyPads } from '../pond.ts';
import type { Labels } from './effects.ts';
import { geo, mat, mergeByMaterial, mesh } from './materials.ts';
import { hash2 } from './palette.ts';

// Shared shapes: a lily pad is a disc with a notch; ripples are thin rings.
const PAD_GEO = new THREE.CircleGeometry(1, 18, 0.35, Math.PI * 2 - 0.7).rotateX(-Math.PI / 2);
const RIPPLE_GEO = new THREE.RingGeometry(0.9, 1, 32).rotateX(-Math.PI / 2);
const PAD_MAT = new THREE.MeshStandardMaterial({ color: '#4f9a45', roughness: 0.6, side: THREE.DoubleSide });
const WATER_Y = 0.02;

/**
 * The pond is the shared repo: each commit from the last day floats as a lily pad with a small flower in the
 * committer's colour. A new commit drops in with a ripple. Stones, reeds and the water are static (merged).
 */
export class Pond {
  private group = new THREE.Group();
  private still = new THREE.Group();
  private pads = new Map<number, { obj: THREE.Group; born: number; phase: number }>();
  private ripples: { m: THREE.Mesh; born: number; size: number }[] = [];
  private water?: THREE.MeshStandardMaterial;
  private label?: HTMLElement;
  private at = new THREE.Vector3();
  private r = 3;
  private t = 0;
  private nextIdle = 2;
  private synced = false; // pads already there on first load appear without ripples

  constructor(scene: THREE.Scene, private labels: Labels) { scene.add(this.group); this.group.add(this.still); }

  /** (Re)build the pond's banks and water at this spot. */
  place(x: number, z: number, r: number) {
    this.r = r; this.group.position.set(0, 0, 0); // mergeByMaterial needs the root at the origin
    this.group.updateMatrixWorld(true);
    for (const o of [...this.still.children]) { this.still.remove(o); const g = (o as THREE.Mesh).geometry; if (g && g !== geo.sphere && g !== geo.cyl && g !== geo.cone && g !== geo.box) g.dispose(); }
    // Irregular outline: a disc whose rim wobbles; a slightly larger muddy bank under it.
    const shape = (k: number) => {
      const s = new THREE.Shape(), n = 28;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2, rr = r * k * (1 + 0.12 * Math.sin(a * 3 + 0.7) + 0.06 * Math.sin(a * 5));
        if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
    };
    const bank = new THREE.Mesh(shape(1.18), mat('#6b5a3e')); bank.position.y = -0.01; bank.receiveShadow = true;
    this.water ??= new THREE.MeshStandardMaterial({ color: '#4f9fc4', roughness: 0.15, metalness: 0.1, emissive: '#1d4f6b', emissiveIntensity: 0.25 });
    const water = new THREE.Mesh(shape(1), this.water); water.position.y = WATER_Y; water.receiveShadow = true; water.userData.keep = true;
    this.still.add(bank, water);
    // Stones around the edge, reeds in three clumps.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + hash2(i, 1) * 0.3, rr = r * (1.12 + 0.12 * Math.sin(a * 3 + 0.7)), s = 0.25 + hash2(i, 2) * 0.3;
      const st = mesh(geo.sphere, mat(i % 3 ? '#9a9a96' : '#7c7c78'), s * 1.3, s * 0.6, s, Math.cos(a) * rr, s * 0.15, Math.sin(a) * rr);
      st.rotation.y = a; this.still.add(st);
    }
    for (let c = 0; c < 3; c++) {
      const a = 2.2 + c * 1.7, cx = Math.cos(a) * r * 0.95, cz = Math.sin(a) * r * 0.95;
      for (let i = 0; i < 7; i++) {
        const h = 0.9 + hash2(c * 9 + i, 3) * 0.8, ox = (hash2(c * 9 + i, 4) - 0.5) * 0.7, oz = (hash2(c * 9 + i, 5) - 0.5) * 0.7;
        const reed = mesh(geo.cyl, mat('#5e8a3a'), 0.025, h, 0.025, cx + ox, h / 2, cz + oz); reed.rotation.z = (hash2(c * 9 + i, 6) - 0.5) * 0.25;
        this.still.add(reed);
        if (i % 2 === 0) this.still.add(mesh(geo.cyl, mat('#6b4423'), 0.06, 0.22, 0.06, cx + ox, h - 0.1, cz + oz)); // cattail
      }
    }
    // Where the row path meets the water: a little wooden dock, and a bench facing the pond.
    const plank = mat('#a8754a'), dark = mat('#6e4526'), x0 = -r * 1.3, x1 = -r * 0.62;
    for (let i = 0; i < 6; i++) this.still.add(mesh(geo.box, plank, (x1 - x0) / 6 - 0.04, 0.07, 1.3, x0 + ((i + 0.5) / 6) * (x1 - x0), 0.14, 0));
    for (const px of [x0 + 0.15, x1 - 0.15]) for (const pz of [-0.6, 0.6]) this.still.add(mesh(geo.cyl, dark, 0.06, 0.4, 0.06, px, 0, pz));
    const bx = -r * 1.42 - 0.3, bz = -1.9; // behind the dock, away from the front lane and the botanist
    this.still.add(mesh(geo.box, plank, 0.5, 0.08, 1.6, bx, 0.48, bz), mesh(geo.box, plank, 0.08, 0.45, 1.6, bx - 0.22, 0.75, bz));
    for (const dz of [-0.65, 0.65]) this.still.add(mesh(geo.box, dark, 0.45, 0.48, 0.08, bx, 0.24, bz + dz));
    mergeByMaterial(this.still);
    this.group.position.set(x, 0, z);
    if (this.label) this.labels.remove(this.label);
    this.at.set(x, 0.6, z + r * 1.25);
    this.label = this.labels.add('pond: today\'s commits', () => this.at, 'label bed');
  }

  /** Pads follow the commits of the last day; a new one drops in with a ripple. */
  sync(activity: ActivityView[], now: number, members: MemberView[]) {
    const want = lilyPads(activity, now, this.r);
    const color = new Map(members.map((m) => [m.handle, m.color]));
    const byId = new Map(activity.map((a) => [a.id, a]));
    const keep = new Set(want.map((p) => p.id));
    for (const [id, p] of this.pads) if (!keep.has(id)) { this.group.remove(p.obj); this.pads.delete(id); }
    for (const p of want) {
      if (this.pads.has(p.id)) continue;
      const obj = new THREE.Group();
      const pad = new THREE.Mesh(PAD_GEO, PAD_MAT); pad.scale.setScalar(p.size); pad.receiveShadow = true; obj.add(pad);
      const fc = color.get(byId.get(p.id)?.handle ?? '') ?? '#f4a6c1'; // flower in the committer's colour
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const petal = mesh(geo.sphere, mat(fc), 0.07, 0.04, 0.045, Math.cos(a) * 0.06, 0.06, Math.sin(a) * 0.06); petal.rotation.y = -a; petal.rotation.z = 0.5; obj.add(petal);
      }
      obj.add(mesh(geo.sphere, mat('#f2c230'), 0.035, 0.035, 0.035, 0, 0.08, 0));
      obj.position.set(p.x, WATER_Y + 0.01, p.z); obj.rotation.y = p.id * 2.4;
      const fresh = this.synced;
      this.group.add(obj); this.pads.set(p.id, { obj, born: fresh ? this.t : -10, phase: p.id * 1.7 });
      if (fresh) this.ripple(p.x, p.z, 1.2);
    }
    this.synced = true;
  }

  private ripple(x: number, z: number, size: number) {
    const m = new THREE.Mesh(RIPPLE_GEO, new THREE.MeshBasicMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.7, depthWrite: false }));
    m.position.set(x, WATER_Y + 0.015, z); m.scale.setScalar(0.01);
    this.group.add(m); this.ripples.push({ m, born: this.t, size });
  }

  /** Per-frame: pads bob and pop in, ripples spread and fade, an occasional idle ripple keeps the water alive. */
  update(dt: number, mo: number) {
    this.t += dt;
    for (const p of this.pads.values()) {
      const k = Math.min(1, (this.t - p.born) / 0.6), pop = 1 - Math.pow(1 - k, 3);
      p.obj.scale.setScalar(Math.max(0.01, pop));
      p.obj.position.y = WATER_Y + 0.01 + Math.sin(this.t * 1.2 + p.phase) * 0.012 * mo;
      p.obj.rotation.y += dt * 0.03 * mo;
    }
    if (mo > 0.5 && this.t > this.nextIdle) { // a fish, a falling leaf
      const a = hash2(Math.floor(this.t), 7) * Math.PI * 2, rr = Math.sqrt(hash2(Math.floor(this.t), 8)) * this.r * 0.7;
      this.ripple(Math.cos(a) * rr, Math.sin(a) * rr, 0.6);
      this.nextIdle = this.t + 3 + hash2(Math.floor(this.t), 9) * 4;
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i]!, k = (this.t - rp.born) / 2.2;
      if (k >= 1) { this.group.remove(rp.m); (rp.m.material as THREE.Material).dispose(); this.ripples.splice(i, 1); continue; }
      rp.m.scale.setScalar(0.05 + k * rp.size); (rp.m.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
    }
  }

  get extentX() { return this.group.position.x + this.r * 1.45; }
}
