import * as THREE from 'three';
import { geo, mat, mergeByMaterial, mesh } from './materials.ts';
import { hash2, PALETTE, skyColors } from './palette.ts';

export type Quality = 'low' | 'high';

/**
 * The world around the beds: meadow, plaza/paths, trees, rocks, grass, bench, well, the garden shed with its
 * noticeboard, a sky dome with sun and clouds, and a few decorative critters. All procedural and cheap.
 * `low` quality skips the decoration and shadows' extras.
 */
export class Props {
  readonly group = new THREE.Group();
  readonly shed = new THREE.Group();
  private world = new THREE.Group(); // rebuilt when the layout changes
  private skyMesh: THREE.Mesh;
  private skyAttr: THREE.BufferAttribute;
  private sunDisc: THREE.Mesh;
  private clouds: THREE.Mesh[] = [];
  private critters: Array<{ m: THREE.Group; wings: THREE.Object3D[]; seed: number }> = [];
  private fireflies: THREE.Points;
  private notes: THREE.Mesh[] = [];
  private horizon = new THREE.Color(); private top = new THREE.Color(); private tmpC = new THREE.Color();
  private center = new THREE.Vector3();
  private meadowMat?: THREE.MeshStandardMaterial;
  private season: number | null = null;
  private radius = 60;
  hour = 12;

  constructor(private scene: THREE.Scene, readonly quality: Quality, private onShedClick?: () => void) {
    this.group.add(this.world, this.shed);
    scene.add(this.group);

    // Sky dome with a vertical gradient (colours rewritten when the hour changes).
    const g = new THREE.SphereGeometry(360, 24, 14);
    this.skyAttr = new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 3), 3);
    g.setAttribute('color', this.skyAttr);
    this.skyMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.skyMesh.renderOrder = -2; this.skyMesh.frustumCulled = false;
    scene.add(this.skyMesh);
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 10), new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }));
    this.sunDisc.renderOrder = -1; scene.add(this.sunDisc);

    if (quality === 'high') {
      for (let i = 0; i < 7; i++) {
        const c = new THREE.Mesh(geo.sphere, new THREE.MeshBasicMaterial({ color: PALETTE.cloud, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
        c.scale.set(26 + hash2(i, 1) * 22, 5 + hash2(i, 2) * 3, 12 + hash2(i, 3) * 8);
        c.position.set((hash2(i, 4) - 0.5) * 520, 85 + hash2(i, 5) * 40, -120 - hash2(i, 6) * 160);
        c.renderOrder = -1; this.clouds.push(c); scene.add(c);
      }
      for (let i = 0; i < 6; i++) { // decorative butterflies: tiny, grey-white, no glow (message butterflies are bigger and coloured)
        const m = new THREE.Group(), wm = new THREE.MeshBasicMaterial({ color: 0xe9e6dd, side: THREE.DoubleSide });
        const w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), wm), w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), wm);
        w1.position.x = -0.08; w2.position.x = 0.08; m.add(w1, w2); scene.add(m);
        this.critters.push({ m, wings: [w1, w2], seed: i * 1.7 });
      }
      const fp = new Float32Array(40 * 3);
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
      this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xfff3a0, size: 0.14, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.fireflies.visible = false; scene.add(this.fireflies);
    } else {
      this.fireflies = new THREE.Points();
    }
    this.setHour(12);
  }

  /** Sky and sun for an hour of the day (0..24). Returns the horizon colour for fog/background. */
  setHour(hour: number): THREE.Color {
    this.hour = hour;
    skyColors(hour, this.horizon, this.top);
    const pos = this.skyMesh.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.skyAttr.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      const k = Math.pow(Math.min(1, Math.max(0, pos.getY(i) / 360)), 0.6); // 0 at the horizon, 1 overhead
      this.tmpC.copy(this.horizon).lerp(this.top, k);
      col[i * 3] = this.tmpC.r; col[i * 3 + 1] = this.tmpC.g; col[i * 3 + 2] = this.tmpC.b;
    }
    this.skyAttr.needsUpdate = true;
    // Sun travels east to west and sets; hidden at night.
    const a = ((hour - 6) / 12) * Math.PI;
    const day = hour > 5.5 && hour < 19.5;
    this.sunDisc.visible = day;
    this.sunDisc.position.set(Math.cos(a) * 280, Math.max(18, Math.sin(a) * 200), -150);
    (this.sunDisc.material as THREE.MeshBasicMaterial).color.set(hour > 17.5 || hour < 7 ? '#ffb27a' : '#fff3c4');
    this.fireflies.visible = this.quality === 'high' && (hour > 19.5 || hour < 5);
    for (const c of this.clouds) (c.material as THREE.MeshBasicMaterial).opacity = day ? 0.85 : 0.25;
    return this.horizon;
  }

  /** Timelapse grading: bare dry soil early, lush mid-way, golden at the end. 0..1; `null` = normal. */
  setSeason(p: number | null) {
    this.season = p;
    const m = this.meadowMat; if (!m) return;
    if (p === null) { m.color.set(0xffffff); return; }
    const dry = this.tmpC.set('#d9c59c'), lush = new THREE.Color('#ffffff'), gold = new THREE.Color('#fff0bf');
    if (p < 0.45) m.color.copy(dry).lerp(lush, p / 0.45); else m.color.copy(lush).lerp(gold, (p - 0.45) / 0.55);
  }

  /** Rebuild the static world for a garden of this size. `halfW/halfD` = half extent of the beds. */
  rebuild(halfW: number, halfD: number, frontZ: number) {
    for (const o of [...this.world.children]) { this.world.remove(o); o.traverse((c) => { const m = c as THREE.Mesh; if (m.geometry && m.geometry !== geo.box && m.geometry !== geo.sphere && m.geometry !== geo.cyl && m.geometry !== geo.cone) m.geometry.dispose(); }); }
    this.radius = Math.max(52, Math.hypot(halfW, halfD) + 30);
    const R = this.radius, gardenR = Math.hypot(halfW, halfD);
    this.center.set(0, 0, 0);

    // Meadow: a polar grid with vertex colours (soft noise, darker toward the rim) and a gentle rising horizon.
    const rings = 26, segs = 96, verts: number[] = [], cols: number[] = [], idx: number[] = [];
    const inC = new THREE.Color(PALETTE.meadowInner), outC = new THREE.Color(PALETTE.meadowOuter), c = new THREE.Color();
    verts.push(0, -0.12, 0); c.copy(inC); cols.push(c.r, c.g, c.b);
    for (let r = 1; r <= rings; r++) for (let s = 0; s < segs; s++) {
      const rr = (r / rings) * R, a = (s / segs) * Math.PI * 2, rim = Math.max(0, (rr - R * 0.72) / (R * 0.28));
      verts.push(Math.cos(a) * rr, -0.12 + rim * rim * 5, Math.sin(a) * rr);
      c.copy(inC).lerp(outC, Math.min(1, rr / R)).offsetHSL(0, 0, (hash2(r, s) - 0.5) * 0.05);
      cols.push(c.r, c.g, c.b);
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
    for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) {
      const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + ((s + 1) % segs), d = 1 + r * segs + s, e = 1 + r * segs + ((s + 1) % segs);
      idx.push(a, b, d, b, e, d);
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); mg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); mg.setIndex(idx); mg.computeVertexNormals();
    this.meadowMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
    const meadow = new THREE.Mesh(mg, this.meadowMat);
    this.setSeason(this.season); // keep the timelapse tint across layout rebuilds
    meadow.receiveShadow = true; this.world.add(meadow);

    // Plaza under the beds: the lanes between beds read as paths. Plus a lane to the shed and the front row.
    const plaza = mesh(geo.box, mat(PALETTE.plaza), halfW * 2 + 7, 0.1, halfD * 2 + 7, 0, -0.06, 0); plaza.castShadow = false; plaza.receiveShadow = true;
    const lane = mesh(geo.box, mat(PALETTE.path), halfW * 2 + 7, 0.1, 3.2, 0, -0.055, frontZ + 0.3); lane.castShadow = false; lane.receiveShadow = true;
    this.world.add(plaza, lane);

    if (this.quality === 'low') { this.buildShed(halfW, halfD); mergeByMaterial(this.world, (m) => m === meadow); return; }

    // Trees and rocks on a ring outside the garden (deterministic).
    const place = (i: number, salt: number, rMin: number, rMax: number) => {
      const a = hash2(i, salt) * Math.PI * 2, r = rMin + hash2(i, salt + 1) * (rMax - rMin);
      return { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.85, k: hash2(i, salt + 2) };
    };
    const rMin = gardenR + 9, rMax = R * 0.88;
    for (let i = 0; i < 16; i++) {
      const p = place(i, 11, rMin, rMax), s = 0.9 + p.k * 0.9, t = new THREE.Group();
      t.add(mesh(geo.cyl, mat(PALETTE.trunk), 0.28 * s, 1.5 * s, 0.28 * s, 0, 0.75 * s, 0));
      t.add(mesh(geo.cone, mat(PALETTE.leaf), 1.5 * s, 2.4 * s, 1.5 * s, 0, 2.3 * s, 0));
      t.add(mesh(geo.cone, mat(PALETTE.leafDark), 1.15 * s, 2.0 * s, 1.15 * s, 0, 3.4 * s, 0));
      t.position.set(p.x, 0, p.z); this.world.add(t);
    }
    for (let i = 0; i < 12; i++) {
      const p = place(i, 31, gardenR + 6, R * 0.9), s = 0.4 + p.k * 0.8;
      const rock = mesh(geo.sphere, mat(p.k > 0.5 ? PALETTE.stone : PALETTE.stoneDark), s * 1.2, s * 0.65, s, p.x, s * 0.25, p.z);
      rock.rotation.y = p.k * 6; this.world.add(rock);
    }
    // Grass tufts (instanced).
    const tufts = 420, gm = new THREE.InstancedMesh(geo.cone, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), tufts), dm = new THREE.Object3D();
    for (let i = 0; i < tufts; i++) {
      const p = place(i, 71, gardenR + 3, R * 0.92), s = 0.25 + p.k * 0.35;
      dm.position.set(p.x, s * 0.5 - 0.05, p.z); dm.scale.set(s * 0.5, s, s * 0.5); dm.rotation.y = p.k * 9; dm.updateMatrix();
      gm.setMatrixAt(i, dm.matrix); gm.setColorAt(i, c.set(PALETTE.leaf).lerp(this.tmpC.set(PALETTE.meadowInner), p.k));
    }
    gm.castShadow = false; gm.frustumCulled = false; this.world.add(gm);

    // Bench and well near the front-left.
    const bench = new THREE.Group();
    bench.add(mesh(geo.box, mat(PALETTE.woodLight), 1.7, 0.1, 0.5, 0, 0.5, 0), mesh(geo.box, mat(PALETTE.woodLight), 1.7, 0.45, 0.08, 0, 0.8, -0.22));
    for (const x of [-0.7, 0.7]) bench.add(mesh(geo.box, mat(PALETTE.woodDark), 0.1, 0.5, 0.45, x, 0.25, 0));
    bench.position.set(-halfW - 3.4, 0, frontZ - 0.8); bench.rotation.y = Math.PI / 2.4; this.world.add(bench);
    const well = new THREE.Group();
    well.add(mesh(geo.cyl, mat(PALETTE.stone), 0.9, 0.7, 0.9, 0, 0.35, 0), mesh(geo.cyl, mat('#4d7fa8'), 0.7, 0.05, 0.7, 0, 0.66, 0));
    for (const x of [-0.8, 0.8]) well.add(mesh(geo.box, mat(PALETTE.woodDark), 0.1, 1.5, 0.1, x, 1.2, 0));
    const roof = mesh(geo.cone, mat(PALETTE.shedRoof), 1.3, 0.6, 1.3, 0, 2.2, 0); roof.rotation.y = Math.PI / 4; well.add(roof);
    well.position.set(-halfW - 5.2, 0, frontZ - 4); this.world.add(well);

    this.buildShed(halfW, halfD);
    mergeByMaterial(this.world, (m) => m === meadow); // trees, rocks, plaza, bench, well: a handful of draw calls
  }

  /** The garden shed at the back-right, with a noticeboard whose notes mirror the HTML panel. Click it to toggle the panel. */
  private buildShed(halfW: number, halfD: number) {
    for (const o of this.shed.children) { const m = o as THREE.Mesh; if (m.geometry && m.geometry !== geo.box && m.geometry !== geo.sphere && m.geometry !== geo.cyl && m.geometry !== geo.cone) m.geometry.dispose(); }
    this.shed.clear(); this.notes = [];
    const w = 3.4, d = 2.6, h = 2.4;
    this.shed.add(mesh(geo.box, mat(PALETTE.shedWall), w, h, d, 0, h / 2, 0));
    for (const sx of [-1, 1]) { // gabled roof
      const r = mesh(geo.box, mat(PALETTE.shedRoof), w + 0.5, 0.12, d / 2 + 0.55, 0, h + 0.55, sx * (d / 4 + 0.05));
      r.rotation.x = -sx * 0.5; this.shed.add(r);
    }
    this.shed.add(mesh(geo.box, mat(PALETTE.woodDark), 0.8, 1.6, 0.06, -0.8, 0.8, d / 2 + 0.02)); // door
    this.shed.add(mesh(geo.box, mat(PALETTE.shedTrim), 0.9, 0.9, 0.06, 0.95, 1.5, d / 2 + 0.02)); // window frame
    this.shed.add(mesh(geo.box, mat(PALETTE.glass, { opacity: 0.7 }), 0.7, 0.7, 0.07, 0.95, 1.5, d / 2 + 0.03));
    const board = mesh(geo.box, mat(PALETTE.woodLight), 1.7, 1.1, 0.07, 0.35, 0.9, d / 2 + 0.28); board.rotation.x = -0.06; this.shed.add(board);
    for (let i = 0; i < 8; i++) { // pinned notes, hidden until there is something to pin
      const n = mesh(geo.box, mat(PALETTE.paper), 0.34, 0.26, 0.02, 0.35 - 0.62 + (i % 4) * 0.42, 1.12 - Math.floor(i / 4) * 0.4, d / 2 + 0.33);
      n.rotation.z = (hash2(i, 5) - 0.5) * 0.3; n.visible = false; n.userData.keep = true; this.shed.add(n); this.notes.push(n);
    }
    this.shed.position.set(halfW - 1.5, 0, -halfD - 5.2); this.shed.rotation.y = -0.12;
    // Merge the shed's static parts (bake in local space: the shed group is moved after).
    const x = this.shed.position.clone(), r = this.shed.rotation.y;
    this.shed.position.set(0, 0, 0); this.shed.rotation.y = 0;
    mergeByMaterial(this.shed);
    this.shed.position.copy(x); this.shed.rotation.y = r;
  }

  /** Pin one note per active item: fences (red), open requests (blue), handoffs (green), recent verdicts (pink bloom / grey refusal). */
  setNotes(items: Array<'fence' | 'request' | 'handoff' | 'bloom' | 'refused'>) {
    const color: Record<string, string> = { fence: '#ff8b73', request: '#8ec5ff', handoff: '#9be29b', bloom: '#ff9ec7', refused: '#c9c9c9' };
    this.notes.forEach((n, i) => {
      const it = items[i];
      n.visible = !!it;
      if (it) (n.material as THREE.MeshStandardMaterial) = mat(color[it]!);
    });
  }

  /** Hit test for clicks on the shed. */
  hitShed(raycaster: THREE.Raycaster): boolean {
    return raycaster.intersectObject(this.shed, true).length > 0;
  }
  shedClicked() { this.onShedClick?.(); }

  get shedPosition() { return this.shed.position; }

  /** Per-frame: drifting clouds, wandering critters, firefly dance. Allocation-free. */
  update(t: number, dt: number, gardenX: number, gardenZ: number, motion: number) {
    this.skyMesh.position.copy(this.scene.position);
    for (const c of this.clouds) { c.position.x += dt * 1.2 * motion; if (c.position.x > 300) c.position.x = -300; }
    for (const k of this.critters) {
      const a = t * 0.35 + k.seed;
      k.m.position.set(gardenX + Math.cos(a * 1.3) * (10 + k.seed), 1.2 + Math.sin(a * 2.1) * 0.5, gardenZ + Math.sin(a) * (7 + k.seed * 0.6));
      k.m.rotation.y = -a;
      const f = Math.sin(t * 16 + k.seed) * 0.8 * Math.max(0.3, motion);
      k.wings[0]!.rotation.z = f; k.wings[1]!.rotation.z = -f;
    }
    if (this.fireflies.visible) {
      const p = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setXYZ(i, gardenX + Math.cos(t * 0.3 + i * 2.4) * (4 + (i % 9) * 1.6), 0.6 + (i % 5) * 0.4 + Math.sin(t + i) * 0.2, gardenZ + Math.sin(t * 0.27 + i * 1.7) * (3 + (i % 7) * 1.5));
      p.needsUpdate = true;
    }
  }
}
