import * as THREE from 'three';
import type { PlantStage } from '../../../shared/types.ts';
import { plantJitter, speciesOf, type Species } from '../species.ts';
import { flowerColor, geo, hashString } from './materials.ts';

type Role = 'body' | 'petal' | 'center' | 'bug';
interface Part { mesh: 0 | 1; slot: number; base: THREE.Matrix4; role: Role; idx: number } // idx -1: pot/soil, not the plant

export interface PlantInst {
  path: string; x: number; z: number; size: number; stage: PlantStage; bugs: number; full: boolean;
  born: number; phase: number; openAt?: number; wobbleUntil?: number; key: string;
  species: Species; jit: { dh: number; dl: number }; bloom: THREE.Color; owner: THREE.Color | null; parts: Part[]; bugParts: Part[];
}

const SPH = 0, CYL = 1;
const STEM_H: Record<PlantStage, number> = { seed: 0, sprout: 0.35, growing: 0.8, bud: 0.95, bloom: 1.0, dormant: 0.55 };
const C = {
  soil: new THREE.Color('#6b4a2f'), stem: new THREE.Color('#3f7d3a'), stemD: new THREE.Color('#8a8570'),
  leaf: new THREE.Color('#58a24a'), leafS: new THREE.Color('#7fc36a'), leafD: new THREE.Color('#a39f86'),
  bud: new THREE.Color('#9ac26b'), budD: new THREE.Color('#a39f86'), center: new THREE.Color('#f2c230'),
  bug: new THREE.Color('#1c1c1c'), tuft: new THREE.Color('#6aa84f'), tuftD: new THREE.Color('#b3b09a'),
  sunPetal: new THREE.Color('#f7c613'), sunCenter: new THREE.Color('#5a3a1a'),
  fern: new THREE.Color('#2e7a4c'), fernTip: new THREE.Color('#9ccf6e'),
  cactus: new THREE.Color('#5e9c58'), cactusD: new THREE.Color('#9c9a84'), cactusBloom: new THREE.Color('#ff7eb6'),
  shrub: new THREE.Color('#3f7a3c'), berry: new THREE.Color('#d1262b'), berryG: new THREE.Color('#8db35a'),
  pebble: new THREE.Color('#a3a39e'), pebbleD: new THREE.Color('#86867f'), moss: new THREE.Color('#79a65a'),
  pot: new THREE.Color('#c4643f'), potRim: new THREE.Color('#a8502f'),
  clover: new THREE.Color('#7f9f6e'), cloverHead: new THREE.Color('#f3efe2'), white: new THREE.Color('#ffffff'),
};
/** Pebble tones for images (picked per file, so a folder of images reads as a mixed stone pile). */
const PEBBLES = ['#a3a39e', '#c9a77c', '#7d8a99', '#b8735a', '#d9cdb8'].map((c) => new THREE.Color(c));
/** Ground-cover tuft colour per species (quiet plants in big gardens still read as their kind). */
const TUFT: Record<Species, THREE.Color> = {
  flower: C.tuft, sunflower: new THREE.Color('#9bb64a'), fern: C.fern, cactus: new THREE.Color('#4f8f5a'),
  shrub: C.shrub, stone: C.pebble, clover: C.clover,
};
/** What a non-flower species shows when it blooms (bloom burst colour). */
const BLOOM: Record<Exclude<Species, 'flower'>, THREE.Color> = {
  sunflower: C.sunPetal, fern: C.fernTip, cactus: C.cactusBloom, shrub: C.berry, stone: C.white, clover: C.cloverHead,
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
  private col = new THREE.Color(); private tint = new THREE.Color();
  /** Foliage colour for one leaf: this plant's jitter, alternate leaves a shade lighter (two-tone). */
  private leafTone(inst: PlantInst, base: THREE.Color, i: number) { return this.tint.copy(base).offsetHSL(inst.jit.dh, 0, inst.jit.dl + (i % 2 ? 0.06 : -0.02)); }
  private dirtyColor: [boolean, boolean] = [false, false];
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private scene: THREE.Scene) {
    this.grow(SPH, 1024); this.grow(CYL, 256);
  }

  get count() { return this.plants.size; }
  get(path: string) { return this.plants.get(path); }
  /** The colour a plant shows when it blooms (owner colour for flowers). */
  bloomColor(path: string) { return this.plants.get(path)?.bloom ?? flowerColor(path); }
  /** The instance colour of one part (tests, debugging). */
  colorOf(p: Part) { return new THREE.Color().fromArray(this.meshes[p.mesh]!.instanceColor!.array, p.slot * 3); }
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
    const { size: s, stage, species: sp } = inst, d = stage === 'dormant';
    if (!inst.full) { // ground cover: one tuft, coloured by species
      const tc = d ? C.tuftD : inst.owner ? this.tint.copy(TUFT[sp]).lerp(inst.owner, 0.35) : TUFT[sp]; // owner tint: who works where
      this.add(inst, SPH, tc, 'body', 0, 0.35 * s, (sp === 'cactus' ? 0.3 : 0.14) * s, 0.35 * s, 0, 0.1, 0);
      return;
    }
    if (sp === 'clover') { this.buildHedge(inst); return; }
    if (sp === 'cactus') this.add(inst, CYL, C.pot, 'body', -1, 0.3 * s, 0.36 * s, 0.3 * s, 0, 0.18 * s, 0); // config grows in a pot
    else this.add(inst, SPH, C.soil, 'body', -1, 0.5 * s, 0.2 * s, 0.5 * s, 0, 0.04, 0);
    if (stage === 'seed') return;
    if (sp === 'fern') this.buildFern(inst, s, d);
    else if (sp === 'cactus') this.buildCactus(inst, s, d);
    else if (sp === 'shrub') this.buildShrub(inst, s, d);
    else if (sp === 'stone') this.buildStone(inst, s, d);
    else this.buildFlower(inst, s, d, sp === 'sunflower');
  }

  /** Stem, leaves, bud, petals. Sunflowers (tests) are taller with a big yellow head and a dark centre. */
  private buildFlower(inst: PlantInst, s: number, d: boolean, sun: boolean) {
    const stage = inst.stage, h = STEM_H[stage] * s * (sun ? 1.5 : 1), k = sun ? 1.35 : 1;
    this.add(inst, CYL, d ? C.stemD : C.stem, 'body', 0, 0.05 * s * k, h, 0.05 * s * k, 0, h / 2, 0);
    const leaves = stage === 'sprout' ? 2 : stage === 'growing' ? 5 : 4;
    const leafC = d ? C.leafD : stage === 'sprout' ? C.leafS : C.leaf;
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2 + 0.5, y = h * (0.3 + 0.6 * ((i % 3) / 3));
      this.add(inst, SPH, this.leafTone(inst, leafC, i), 'body', i, 0.3 * s * k, 0.06 * s, 0.14 * s * k, Math.cos(a) * 0.25 * s * k, y, Math.sin(a) * 0.25 * s * k, -a, 0.35);
    }
    if (stage === 'bud') this.add(inst, SPH, inst.owner ? this.tint.copy(C.bud).lerp(inst.owner, 0.5) : C.bud, 'body', 0, 0.12 * s * k, 0.26 * s * k, 0.12 * s * k, 0, h + 0.13 * s, 0); // slim, pointed
    if (stage !== 'bloom') return;
    const n = sun ? 12 : 7, r = sun ? 0.3 : 0.2, pc = sun ? C.sunPetal : inst.bloom;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.add(inst, SPH, pc, 'petal', i, (sun ? 0.2 : 0.17) * s, 0.05 * s, (sun ? 0.08 : 0.1) * s, Math.cos(a) * r * s, h + 0.05 * s, Math.sin(a) * r * s, -a);
    }
    this.add(inst, SPH, sun ? C.sunCenter : C.center, 'center', 0, (sun ? 0.2 : 0.12) * s, 0.1 * s, (sun ? 0.2 : 0.12) * s, 0, h + 0.07 * s, 0);
  }

  /** Markdown: a fan of arching fronds, no stem; a fiddlehead as the bud; new upright fronds unfurl on bloom. */
  private buildFern(inst: PlantInst, s: number, d: boolean) {
    const stage = inst.stage, hk = STEM_H[stage], col = d ? C.leafD : C.fern;
    const n = stage === 'sprout' ? 3 : stage === 'growing' ? 6 : 8;
    for (let i = 0; i < n; i++) { // long, flat fronds that arch out low
      const a = (i / n) * Math.PI * 2 + 0.3, len = (0.26 + 0.24 * hk) * s * (i % 2 ? 0.85 : 1), rz = 0.3;
      this.add(inst, SPH, this.leafTone(inst, col, i), 'body', i, len, 0.03 * s, 0.13 * s, Math.cos(a) * len * 0.85, 0.14 * s + len * 0.2, Math.sin(a) * len * 0.85, -a, rz);
    }
    if (stage === 'bud') this.add(inst, SPH, C.fernTip, 'body', 0, 0.1 * s, 0.12 * s, 0.1 * s, 0, 0.32 * s, 0);
    if (stage !== 'bloom') return;
    for (let i = 0; i < 4; i++) { // upright young fronds with curled tips
      const a = (i / 4) * Math.PI * 2 + 1.1, len = 0.3 * s, rz = 1.05;
      const cx = Math.cos(a) * 0.14 * s, cz = Math.sin(a) * 0.14 * s, cy = 0.15 * s + len * Math.sin(rz);
      this.add(inst, SPH, C.fernTip, 'petal', i * 2, len, 0.04 * s, 0.08 * s, cx, cy, cz, -a, rz);
      const tr = len * Math.cos(rz);
      this.add(inst, SPH, C.fernTip, 'petal', i * 2 + 1, 0.07 * s, 0.07 * s, 0.07 * s, cx + Math.cos(a) * tr, cy + len * Math.sin(rz), cz + Math.sin(a) * tr);
    }
  }

  /** Config: a squat cactus with two arms once grown; a small pink cactus flower on bloom. */
  private buildCactus(inst: PlantInst, s: number, d: boolean) {
    const stage = inst.stage, col = d ? C.cactusD : C.cactus, h = (0.2 + 0.55 * STEM_H[stage]) * s, r = 0.17 * s, y0 = 0.36 * s;
    this.add(inst, CYL, C.potRim, 'body', -1, 0.33 * s, 0.06 * s, 0.33 * s, 0, y0, 0);
    this.add(inst, SPH, C.soil, 'body', -1, 0.27 * s, 0.04 * s, 0.27 * s, 0, y0 + 0.02 * s, 0);
    this.add(inst, CYL, col, 'body', 0, r, h, r, 0, y0 + h / 2, 0);
    this.add(inst, SPH, col, 'body', 1, r, r * 0.8, r, 0, y0 + h, 0);
    if (stage !== 'sprout') for (const side of [-1, 1]) {
      const ay = y0 + h * (side < 0 ? 0.45 : 0.6), ar = 0.075 * s;
      this.add(inst, CYL, col, 'body', 2, ar, 0.16 * s, ar, side * 0.2 * s, ay, 0, 0, Math.PI / 2);
      this.add(inst, CYL, col, 'body', 3, ar, 0.24 * s, ar, side * 0.28 * s, ay + 0.12 * s, 0);
      this.add(inst, SPH, col, 'body', 4, ar, ar, ar, side * 0.28 * s, ay + 0.24 * s, 0);
    }
    if (stage === 'bud') this.add(inst, SPH, C.cactusBloom, 'body', 0, 0.06 * s, 0.08 * s, 0.06 * s, 0, y0 + h + r * 0.8, 0);
    if (stage !== 'bloom') return;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      this.add(inst, SPH, C.cactusBloom, 'petal', i, 0.09 * s, 0.035 * s, 0.05 * s, Math.cos(a) * 0.08 * s, y0 + h + r * 0.8, Math.sin(a) * 0.08 * s, -a, 0.3);
    }
    this.add(inst, SPH, C.center, 'center', 0, 0.045 * s, 0.04 * s, 0.045 * s, 0, y0 + h + r * 0.85, 0);
  }

  /** Shell scripts: a round bush of leaf balls; green berries as the bud, red berries on bloom. */
  private buildShrub(inst: PlantInst, s: number, d: boolean) {
    const stage = inst.stage, hk = STEM_H[stage], col = d ? C.leafD : C.shrub;
    const n = stage === 'sprout' ? 2 : stage === 'growing' ? 4 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rr = (i === 0 ? 0 : 0.18) * s, br = (0.2 + 0.12 * hk) * s;
      this.add(inst, SPH, this.leafTone(inst, col, i), 'body', i, br, br * 0.85, br, Math.cos(a) * rr, (0.15 + 0.25 * hk) * s + (i === 0 ? 0.08 * s : 0), Math.sin(a) * rr);
    }
    if (stage !== 'bud' && stage !== 'bloom') return;
    const bloom = stage === 'bloom', m = bloom ? 9 : 5;
    for (let i = 0; i < m; i++) {
      const a = i * 2.4, y = (0.35 + 0.25 * ((i * 7) % 5) / 5) * s, rr = 0.3 * s;
      this.add(inst, SPH, bloom ? C.berry : C.berryG, bloom ? 'petal' : 'body', i, 0.055 * s, 0.055 * s, 0.055 * s, Math.cos(a) * rr, y, Math.sin(a) * rr);
    }
  }

  /** Images: a cluster of pebbles with a cushion of moss; tiny white flowers on the moss on bloom. */
  private buildStone(inst: PlantInst, s: number, d: boolean) {
    const stage = inst.stage, n = stage === 'sprout' ? 2 : stage === 'growing' ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const a = i * 2.3 + 0.4, rr = (0.12 + 0.08 * (i % 2)) * s, k = 1 - i * 0.09;
      this.add(inst, SPH, PEBBLES[(hashString(inst.path) + i * 2) % PEBBLES.length]!, 'body', i, 0.2 * s * k, 0.11 * s * k, 0.16 * s * k, Math.cos(a) * rr, 0.12 * s, Math.sin(a) * rr, a);
    }
    if (stage === 'sprout') return;
    this.add(inst, SPH, d ? C.tuftD : C.moss, 'body', 0, 0.16 * s, 0.07 * s, 0.14 * s, -0.12 * s, 0.17 * s, 0.1 * s);
    if (stage === 'bud') this.add(inst, SPH, C.bud, 'body', 0, 0.05 * s, 0.06 * s, 0.05 * s, -0.12 * s, 0.25 * s, 0.1 * s);
    if (stage !== 'bloom') return;
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26;
      this.add(inst, SPH, C.white, 'petal', i, 0.04 * s, 0.03 * s, 0.04 * s, -0.12 * s + Math.cos(a) * 0.09 * s, 0.24 * s, 0.1 * s + Math.sin(a) * 0.07 * s);
    }
  }

  /** Generated code: one low, muted clover hedge for a whole module_bindings folder (not one plant per file). */
  private buildHedge(inst: PlantInst) {
    const d = inst.stage === 'dormant', col = d ? C.tuftD : C.clover, leaf = d ? C.leafD : C.leafS, hy = d ? 0.16 : 0.21;
    for (let i = 0; i < 10; i++) { // two staggered rows of low mounds filling the cell
      const x = -0.6 + (i % 5) * 0.3 + (i < 5 ? 0 : 0.15), z = i < 5 ? -0.22 : 0.22;
      this.add(inst, SPH, col, 'body', i, 0.26, hy, 0.28, x, 0.06, z);
      for (let j = 0; j < 3; j++) { // trefoil on top
        const a = (j / 3) * Math.PI * 2 + i;
        this.add(inst, SPH, leaf, 'body', j, 0.07, 0.02, 0.07, x + Math.cos(a) * 0.07, 0.05 + hy, z + Math.sin(a) * 0.07);
      }
    }
    if (inst.stage !== 'bloom') return;
    for (let i = 0; i < 5; i++) this.add(inst, SPH, C.cloverHead, 'petal', i, 0.05, 0.06, 0.05, -0.5 + i * 0.25, 0.08 + hy, (i % 2 ? -0.15 : 0.15));
  }

  private buildBugs(inst: PlantInst) {
    this.release(inst.bugParts);
    if (!inst.full) return;
    for (let i = 0; i < inst.bugs; i++) this.add(inst, SPH, C.bug, 'bug', i, 0.06, 0.05, 0.08, 0, 0, 0);
  }

  /** Create or update a plant. Returns what it was before so the caller can trigger effects. */
  upsert(path: string, x: number, z: number, size: number, stage: PlantStage, bugs: number, full: boolean, now: number, quiet: boolean, bloom?: string):
    { wasStage?: PlantStage; bugsBefore: number; inst: PlantInst } {
    let inst = this.plants.get(path);
    const wasStage = inst?.stage, bugsBefore = inst?.bugs ?? 0;
    if (!inst) {
      const species = speciesOf(path);
      inst = { path, x, z, size, stage, bugs: 0, full, born: now, phase: (path.length * 2.399) % 6.28, key: '', species, jit: plantJitter(path), bloom: new THREE.Color(), owner: null, parts: [], bugParts: [] };
      this.plants.set(path, inst);
    }
    inst.x = x; inst.z = z;
    const key = `${stage}|${size.toFixed(2)}|${full}|${bloom ?? ''}`;
    if (key !== inst.key) {
      inst.key = key; inst.stage = stage; inst.size = size; inst.full = full;
      inst.owner = bloom ? (inst.owner ?? new THREE.Color()).set(bloom) : null;
      if (inst.species === 'flower') { if (bloom) inst.bloom.set(bloom); else inst.bloom.copy(flowerColor(path)); }
      else inst.bloom.copy(BLOOM[inst.species]);
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
