import * as THREE from 'three';
import type { PlantStage } from '../../../shared/types.ts';
import { flowerColor, geo } from './materials.ts';

type Role = 'body' | 'petal' | 'center' | 'bug';
interface Part { mesh: 0 | 1; slot: number; base: THREE.Matrix4; role: Role; idx: number }

export interface PlantInst {
  path: string; x: number; z: number; size: number; stage: PlantStage; bugs: number; full: boolean;
  born: number; phase: number; openAt?: number; wobbleUntil?: number; key: string;
  parts: Part[]; bugParts: Part[];
}

const SPH = 0, CYL = 1;
const STEM_H: Record<PlantStage, number> = { seed: 0, sprout: 0.35, growing: 0.8, bud: 0.95, bloom: 1.0, dormant: 0.55 };
const C = {
  soil: new THREE.Color('#6b4a2f'), stem: new THREE.Color('#3f7d3a'), stemD: new THREE.Color('#8a8570'),
  leaf: new THREE.Color('#58a24a'), leafS: new THREE.Color('#7fc36a'), leafD: new THREE.Color('#a39f86'),
  bud: new THREE.Color('#9ac26b'), budD: new THREE.Color('#a39f86'), center: new THREE.Color('#f2c230'),
  bug: new THREE.Color('#1c1c1c'), tuft: new THREE.Color('#6aa84f'), tuftD: new THREE.Color('#b3b09a'),
};

/**
 * All plants as two InstancedMesh pools (spheres, cylinders). A plant is a handful of parts, each owning one
 * instance slot; per-frame animation (pop, sway, droop, wobble, petals opening, bugs crawling) only rewrites
 * matrices. No meshes are created or destroyed at runtime, and the per-frame path allocates nothing.
 */
export class PlantField {
  private meshes: THREE.InstancedMesh[] = [];
  private cap: [number, number] = [0, 0];
  private high: [number, number] = [0, 0]; // highest used slot + 1
  private free: [number[], number[]] = [[], []];
  private plants = new Map<string, PlantInst>();
  private mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.85, metalness: 0 });
  private mT = new THREE.Matrix4(); private mA = new THREE.Matrix4(); private mB = new THREE.Matrix4(); private mO = new THREE.Matrix4();
  private q = new THREE.Quaternion(); private e = new THREE.Euler(); private p = new THREE.Vector3(); private s = new THREE.Vector3();
  private col = new THREE.Color();
  private dirtyColor: [boolean, boolean] = [false, false];
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private scene: THREE.Scene) {
    this.grow(SPH, 1024); this.grow(CYL, 256);
  }

  get count() { return this.plants.size; }
  get(path: string) { return this.plants.get(path); }
  all() { return this.plants.values(); }
  stats() { return { sphere: this.high[SPH], cylinder: this.high[CYL], plants: this.plants.size }; }

  private grow(kind: 0 | 1, cap: number) {
    const old = this.meshes[kind];
    const m = new THREE.InstancedMesh(kind === SPH ? geo.sphere : geo.cyl, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
    m.count = this.high[kind];
    for (let i = 0; i < cap; i++) m.setMatrixAt(i, this.zero);
    m.setColorAt(0, this.col.set(0xffffff)); // allocates instanceColor
    if (old) {
      (m.instanceMatrix.array as Float32Array).set((old.instanceMatrix.array as Float32Array).subarray(0, this.high[kind] * 16));
      if (old.instanceColor) (m.instanceColor!.array as Float32Array).set((old.instanceColor.array as Float32Array).subarray(0, this.high[kind] * 3));
      this.scene.remove(old); old.dispose();
    }
    this.meshes[kind] = m; this.cap[kind] = cap; this.scene.add(m);
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  private alloc(kind: 0 | 1): number {
    const f = this.free[kind];
    if (f.length) return f.pop()!;
    if (this.high[kind] >= this.cap[kind]) this.grow(kind, this.cap[kind] * 2);
    const slot = this.high[kind]++;
    this.meshes[kind]!.count = this.high[kind];
    return slot;
  }

  private release(parts: Part[]) {
    for (const p of parts) {
      this.meshes[p.mesh]!.setMatrixAt(p.slot, this.zero);
      this.free[p.mesh].push(p.slot);
      this.meshes[p.mesh]!.instanceMatrix.needsUpdate = true;
    }
    parts.length = 0;
  }

  private add(inst: PlantInst, kind: 0 | 1, color: THREE.Color, role: Role, idx: number,
    sx: number, sy: number, sz: number, px: number, py: number, pz: number, ry = 0, rz = 0): Part {
    const slot = this.alloc(kind);
    const base = new THREE.Matrix4().compose(
      new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)), new THREE.Vector3(sx, sy, sz));
    this.meshes[kind]!.setColorAt(slot, color);
    this.dirtyColor[kind] = true;
    const part: Part = { mesh: kind, slot, base, role, idx };
    (role === 'bug' ? inst.bugParts : inst.parts).push(part);
    return part;
  }

  private build(inst: PlantInst) {
    this.release(inst.parts);
    const { size: s, stage } = inst, d = stage === 'dormant';
    if (!inst.full) { // ground cover: one tuft
      this.add(inst, SPH, d ? C.tuftD : C.tuft, 'body', 0, 0.35 * s, 0.14 * s, 0.35 * s, 0, 0.1, 0);
      return;
    }
    this.add(inst, SPH, C.soil, 'body', 0, 0.5 * s, 0.2 * s, 0.5 * s, 0, 0.04, 0);
    if (stage === 'seed') return;
    const h = STEM_H[stage] * s;
    this.add(inst, CYL, d ? C.stemD : C.stem, 'body', 0, 0.05 * s, h, 0.05 * s, 0, h / 2, 0);
    const leaves = stage === 'sprout' ? 2 : stage === 'growing' ? 5 : 4;
    const leafC = d ? C.leafD : stage === 'sprout' ? C.leafS : C.leaf;
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2 + 0.5, y = h * (0.3 + 0.6 * ((i % 3) / 3));
      this.add(inst, SPH, leafC, 'body', i, 0.3 * s, 0.06 * s, 0.14 * s, Math.cos(a) * 0.25 * s, y, Math.sin(a) * 0.25 * s, -a, 0.35);
    }
    if (stage === 'bud') this.add(inst, SPH, d ? C.budD : C.bud, 'body', 0, 0.17 * s, 0.24 * s, 0.17 * s, 0, h + 0.1 * s, 0);
    if (stage === 'bloom') {
      const pc = flowerColor(inst.path);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        this.add(inst, SPH, pc, 'petal', i, 0.17 * s, 0.05 * s, 0.1 * s, Math.cos(a) * 0.2 * s, h + 0.05 * s, Math.sin(a) * 0.2 * s, -a);
      }
      this.add(inst, SPH, C.center, 'center', 0, 0.12 * s, 0.1 * s, 0.12 * s, 0, h + 0.07 * s, 0);
    }
  }

  private buildBugs(inst: PlantInst) {
    this.release(inst.bugParts);
    if (!inst.full) return;
    for (let i = 0; i < inst.bugs; i++) this.add(inst, SPH, C.bug, 'bug', i, 0.06, 0.05, 0.08, 0, 0, 0);
  }

  /** Create or update a plant. Returns what it was before so the caller can trigger effects. */
  upsert(path: string, x: number, z: number, size: number, stage: PlantStage, bugs: number, full: boolean, now: number, quiet: boolean):
    { wasStage?: PlantStage; bugsBefore: number; inst: PlantInst } {
    let inst = this.plants.get(path);
    const wasStage = inst?.stage, bugsBefore = inst?.bugs ?? 0;
    if (!inst) {
      inst = { path, x, z, size, stage, bugs: 0, full, born: now, phase: (path.length * 2.399) % 6.28, key: '', parts: [], bugParts: [] };
      this.plants.set(path, inst);
    }
    inst.x = x; inst.z = z;
    const key = `${stage}|${size.toFixed(2)}|${full}`;
    if (key !== inst.key) {
      inst.key = key; inst.stage = stage; inst.size = size; inst.full = full;
      this.build(inst);
      inst.born = quiet || (wasStage === 'bud' && stage === 'bloom') ? now - 5 : now;
      if (stage === 'bloom' && wasStage === 'bud') inst.openAt = now;
      inst.bugs = -1; // force bug rebuild below
    }
    if (inst.bugs !== bugs) { inst.bugs = bugs; this.buildBugs(inst); }
    return { wasStage, bugsBefore, inst };
  }

  remove(path: string) {
    const inst = this.plants.get(path); if (!inst) return;
    this.release(inst.parts); this.release(inst.bugParts); this.plants.delete(path);
  }

  keep(paths: Set<string>) { for (const path of [...this.plants.keys()]) if (!paths.has(path)) this.remove(path); }

  /** Per-frame: rewrite matrices only. */
  update(t: number, mo: number) {
    for (const inst of this.plants.values()) {
      const age = Math.min(1, (t - inst.born) / 0.7), pop = 0.15 + 0.85 * (1 - Math.pow(1 - age, 3));
      const sway = Math.sin(t * 1.3 + inst.phase) * 0.035 * mo;
      const wob = inst.wobbleUntil && inst.wobbleUntil > t ? Math.sin(t * 22) * 0.1 * Math.min(1, inst.wobbleUntil - t) * mo : 0;
      const T = this.mT.makeTranslation(inst.x, 0.2, inst.z);
      T.multiply(this.mA.makeRotationZ(sway));
      if (inst.full) { T.multiply(this.mA.makeRotationX(Math.max(0, inst.bugs) * 0.07)); T.multiply(this.mA.makeRotationZ(wob)); }
      T.multiply(this.mA.makeScale(pop, pop, pop));
      const el = inst.openAt !== undefined ? t - inst.openAt : -1;
      for (const p of inst.parts) {
        const out = this.mB.multiplyMatrices(T, p.base);
        if (el >= 0 && p.role === 'petal') {
          const k = Math.min(1, Math.max(0, (el - p.idx * 0.09) / 0.55)), e = 1 - Math.pow(1 - k, 3);
          out.multiply(this.mO.makeScale(e, e, e));
        } else if (el >= 0 && p.role === 'center') {
          const e = Math.min(1, Math.max(0, el / 0.4)); out.multiply(this.mO.makeScale(e, e, e));
        }
        this.meshes[p.mesh]!.setMatrixAt(p.slot, out);
      }
      if (inst.openAt !== undefined && el > 1.6) inst.openAt = undefined;
      for (const b of inst.bugParts) {
        const a = t * 1.5 + b.idx * 2.1 + inst.phase, sz = inst.size;
        this.p.set(Math.cos(a) * 0.3 * sz, 0.3 * sz + (b.idx % 3) * 0.2 * sz, Math.sin(a) * 0.3 * sz);
        this.s.set(0.06, 0.05, 0.08);
        this.mO.compose(this.p, this.q.identity(), this.s);
        this.meshes[b.mesh]!.setMatrixAt(b.slot, this.mB.multiplyMatrices(T, this.mO));
      }
    }
    for (let k = 0; k < 2; k++) {
      this.meshes[k]!.instanceMatrix.needsUpdate = true;
      if (this.dirtyColor[k]) { this.meshes[k]!.instanceColor!.needsUpdate = true; this.dirtyColor[k] = false; }
    }
  }
}
