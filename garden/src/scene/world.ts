import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GardenSnapshot, PlantStage } from '../../../shared/types.ts';
import { layoutGarden, type GardenLayout } from '../layout.ts';
import type { Store, StoreUpdate } from '../data/store.ts';
import { Actors, iconMat, type WorldLookup } from './actors.ts';
import { Labels, Particles } from './effects.ts';
import { flowerColor, geo, mat, mergeByMaterial, mesh } from './materials.ts';
import { PlantField } from './plantField.ts';
import { Nav } from '../nav.ts';
import { CameraRig } from './camera.ts';
import { PALETTE } from './palette.ts';
import { Props, type Quality } from './props.ts';

const LOD_LIMIT = 80; // above this many plants, quiet ones become ground cover
const ACTIVE_MS = 30 * 60_000;

export class GardenWorld implements WorldLookup {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  readonly controls: OrbitControls;
  readonly rig: CameraRig;
  private labels: Labels;
  private fx: Particles;
  private actors: Actors;
  private sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
  private hemi = new THREE.HemisphereLight(0xdff2ff, 0x6b8a4a, 1.1);
  nav = new Nav([]);
  private props!: Props;
  readonly quality: Quality = new URLSearchParams(location.search).get('quality') === 'low' ? 'low' : 'high';
  /** Called when the 3D shed is clicked (toggles the HTML shed panel). */
  onShedClick: () => void = () => {};
  private bedGroup = new THREE.Group();
  private fenceGroup = new THREE.Group();
  private field: PlantField;
  expandAll = false;
  private tmpV = new THREE.Vector3();
  private layout: GardenLayout = { beds: [], plants: [], width: 0, depth: 0 };
  private layoutKey = '';
  private layoutFirst = true;
  private snap!: GardenSnapshot;
  private plantXZ = new Map<string, THREE.Vector3>();
  private bedLabels: HTMLElement[] = [];
  /** Blooms held back until the botanist reaches the plant (path -> deadline in performance.now ms). */
  private pendingBloom = new Map<string, number>();
  // A cheap "spotlight": a soft additive light shaft (a real SpotLight costs per-pixel lighting on every material).
  private shaft = new THREE.Mesh(new THREE.ConeGeometry(1.7, 7, 28, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  private spotRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false }));
  private lockMesh = new THREE.Group();
  private pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 40), new THREE.MeshBasicMaterial({ color: 0xff7a59, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  private baseHemi = 1.1; private baseSun = 2.2;
  private dim = 1;
  private clock = new THREE.Clock();
  /** Scene time in seconds; advances with real frames or with advance() (deterministic, for tests and hidden panes). */
  private time = 0;
  extent = 10;
  director = false;
  follow: string | null = null;
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  onLayout: (l: GardenLayout) => void = () => {};
  fps = 0;
  private frames = 0; private fpsT = 0;

  /** False when WebGL could not start (or ?nogl=1): the page shows the plan view instead. */
  readonly available: boolean;
  calm = false;
  /** Called with any error caught in a frame, so the page can show a toast instead of freezing. */
  onError: (e: unknown) => void = () => {};
  private plantLabels = new Map<string, { el: HTMLElement; text: string }>();
  showPlantLabels = false;

  constructor(private host: HTMLElement, store: Store) {
    let gl: THREE.WebGLRenderer | undefined;
    try {
      if (new URLSearchParams(location.search).get('nogl') === '1') throw new Error('WebGL disabled by ?nogl=1');
      gl = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) { console.warn('WebGL unavailable:', e); }
    this.available = !!gl;
    this.renderer = gl ?? (null as unknown as THREE.WebGLRenderer);
    if (gl) {
      gl.setPixelRatio(Math.min(devicePixelRatio, 2));
      gl.shadowMap.enabled = true;
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      host.appendChild(gl.domElement);
    }
    const labelHost = document.createElement('div'); labelHost.className = 'labels'; host.appendChild(labelHost);
    this.labels = new Labels(labelHost, this.camera);
    this.field = new PlantField(this.scene);
    this.fx = new Particles(this.scene);
    this.actors = new Actors(this.scene, this, this.labels, this.fx);
    this.actors.motion = this.reducedMotion ? 0.25 : 1;
    this.fx.reducedMotion = this.reducedMotion;

    this.scene.fog = new THREE.Fog('#cfe6ee', 40, 120);
    this.props = new Props(this.scene, this.quality, () => this.onShedClick());
    this.scene.add(this.hemi, this.sun, this.bedGroup, this.fenceGroup);
    if (gl && this.quality === 'low') gl.shadowMap.enabled = false;
    this.shaft.position.y = 3.6; this.scene.add(this.shaft);
    this.pulse.rotation.x = -Math.PI / 2; this.pulse.visible = false; this.scene.add(this.pulse);
    this.spotRing.rotation.x = -Math.PI / 2; this.spotRing.position.y = 0.32; this.scene.add(this.spotRing);
    this.lockMesh.add(mesh(geo.box, mat('#c9a227'), 0.28, 0.22, 0.12, 0, 0, 0));
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12, Math.PI), mat('#8d8d8d')); shackle.position.y = 0.11;
    this.lockMesh.add(shackle); this.lockMesh.scale.setScalar(0.6); this.lockMesh.visible = false; this.scene.add(this.lockMesh);
    this.sun.position.set(18, 26, 12); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -35; sc.right = sc.top = 35; sc.far = 90;

    this.camera.position.set(0, 18, 22);
    this.controls = new OrbitControls(this.camera, gl?.domElement ?? document.createElement('canvas'));
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.48; this.controls.maxDistance = 90;
    this.rig = new CameraRig(this.camera, this.controls, host);
    // A click (not a drag) on the 3D shed toggles the shed panel.
    if (gl) {
      let down: { x: number; y: number } | undefined;
      const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
      gl.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
      gl.domElement.addEventListener('pointerup', (e) => {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = undefined; return; }
        down = undefined;
        const r = gl.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, this.camera);
        if (this.props.hitShed(ray)) this.props.shedClicked();
      });
    }
    this.resize(); addEventListener('resize', () => this.resize());

    store.subscribe((u) => this.onUpdate(u));
    if (gl) gl.setAnimationLoop(() => { try { this.frame(); } catch (e) { this.onError(e); } });
  }

  // ---- WorldLookup ----
  plantPos(path: string) { return this.plantXZ.get(path); }
  bedCenter(bed: string) { const b = this.layout.beds.find((x) => x.name === bed); return b ? new THREE.Vector3(b.x, 0, b.z) : undefined; }
  bedOfPath(path: string) { return this.layout.plants.find((p) => p.path === path)?.bed; }
  private gates = new Map<string, THREE.Vector3>(); // claim path -> gate point, rebuilt with the fences
  fenceGate(path: string) {
    const claim = this.snap?.claims.find((c) => c.path === path || (c.path.endsWith('/') && path.startsWith(c.path)));
    return claim ? this.gates.get(claim.path) : undefined;
  }
  /** Front edge of the garden where gardeners wait, and half the garden's width. */
  get homeFrame() { return { halfW: Math.max(6, this.layout.width / 2), frontZ: Math.max(4, this.layout.depth / 2) + 2.4 }; }
  gardenerPos(handle: string) { return this.actors.gardenerPos(handle); }
  get botFocus() { return this.actors.focus; }
  setMotion(m: number) { this.actors.motion = m; this.fx.reducedMotion = m < 0.5; }

  private fenceRect(claimPath: string) {
    const hit = this.layout.plants.filter((p) => p.path === claimPath || (claimPath.endsWith('/') && p.path.startsWith(claimPath)));
    if (!hit.length) return undefined;
    const m = 0.95;
    return { minX: Math.min(...hit.map((p) => p.x)) - m, maxX: Math.max(...hit.map((p) => p.x)) + m, minZ: Math.min(...hit.map((p) => p.z)) - m, maxZ: Math.max(...hit.map((p) => p.z)) + m };
  }

  private onUpdate(u: StoreUpdate) {
    this.snap = u.snapshot;
    if (u.reset) { this.actors.clearTransient(); this.fx.clear(); }
    this.syncLayout();
    // The bloom is shown when the botanist gets there, not when the data lands.
    for (const a of u.newActivity) if (a.kind === 'certify_bloom' && a.path) this.pendingBloom.set(a.path, performance.now() + 15000);
    this.syncPlants(u.reset);
    this.syncFences();
    this.actors.sync(u.snapshot);
    const notes: Array<'fence' | 'request' | 'handoff' | 'bloom' | 'refused'> = [];
    for (const _c of u.snapshot.claims) notes.push('fence');
    for (const m of u.snapshot.messages) if (m.status !== 'acked') notes.push('request');
    for (const h of u.snapshot.handoffs ?? []) if (h.status === 'offered') notes.push('handoff');
    for (const c of u.snapshot.certifications.slice(-2)) notes.push(c.result === 'bloom' ? 'bloom' : 'refused');
    this.props.setNotes(notes.slice(0, 8));
    for (const a of u.newActivity) this.actors.onActivity(a);
    for (const e of u.events) if (e.table === 'handoffs' && e.op !== 'deleted') this.actors.onHandoff(e.row as never, e.op);
    const d = new Date(u.snapshot.at || Date.now());
    const hour = d.getHours() + d.getMinutes() / 60;
    const c = this.props.setHour(hour);
    (this.scene.background as THREE.Color | null) ? (this.scene.background as THREE.Color).copy(c) : (this.scene.background = c.clone());
    (this.scene.fog as THREE.Fog).color.copy(c);
    const night = hour < 5 || hour > 20.5;
    this.baseHemi = night ? 0.9 : 1.1; this.baseSun = night ? 0.8 : hour > 17.5 ? 1.8 : 2.2;
    this.sun.color.set(hour > 17.5 && hour < 20.5 ? '#ffc58a' : '#fff0d0');
  }

  private syncLayout() {
    this.layout = layoutGarden(this.snap.plants);
    this.plantXZ.clear();
    for (const p of this.layout.plants) this.plantXZ.set(p.path, new THREE.Vector3(p.x, 0, p.z));
    this.extent = Math.max(10, Math.max(this.layout.width, this.layout.depth) / 2 + 2);
    const key = JSON.stringify(this.layout.beds);
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.bedGroup.clear();
      for (const el of this.bedLabels) this.labels.remove(el);
      this.bedLabels = [];
      for (const b of this.layout.beds) {
        this.buildBed(b);
        const lp = new THREE.Vector3(b.x, 0.5, b.z + b.d / 2 + 0.2);
        this.bedLabels.push(this.labels.add((b.greenhouse ? `${b.name} (greenhouse)` : b.name).replace(/^(.{22}).+$/, '$1…'), () => lp, 'label bed'));
      }
      mergeByMaterial(this.bedGroup);
      this.nav = new Nav(this.layout.beds);
      const hf = this.homeFrame;
      this.props.rebuild(Math.max(6, this.layout.width / 2), Math.max(4, this.layout.depth / 2), hf.frontZ);
      if (!this.rig.userMoved) this.refit(this.layoutFirst);
      this.layoutFirst = false;
    }
    this.onLayout(this.layout);
  }

  /** A raised bed: wooden border and corner posts, tilled soil with furrows; the tests bed gets a glass greenhouse. */
  private buildBed(b: { x: number; z: number; w: number; d: number; greenhouse: boolean }) {
    const t = 0.28, h = 0.42, wood = mat(PALETTE.wood), post = mat(PALETTE.woodDark), g = this.bedGroup;
    const sh = (o: THREE.Mesh, cast = true) => { o.castShadow = cast; o.receiveShadow = true; return o; };
    g.add(sh(mesh(geo.box, mat(PALETTE.soil), b.w - t * 2, 0.34, b.d - t * 2, b.x, 0.17, b.z), false));
    // furrows between plant rows (rows sit SPACING apart from BED_PAD)
    const rows = Math.max(1, Math.round((b.d - 2) / 1.7));
    for (let r = 0; r <= rows; r++) {
      const z = b.z - b.d / 2 + 1 + r * 1.7 - 0.85;
      if (z > b.z - b.d / 2 + t + 0.2 && z < b.z + b.d / 2 - t - 0.2) g.add(sh(mesh(geo.box, mat(PALETTE.furrow), b.w - t * 2 - 0.4, 0.05, 0.1, b.x, 0.35, z), false));
    }
    g.add(sh(mesh(geo.box, wood, b.w, h, t, b.x, h / 2, b.z - b.d / 2 + t / 2)), sh(mesh(geo.box, wood, b.w, h, t, b.x, h / 2, b.z + b.d / 2 - t / 2)));
    g.add(sh(mesh(geo.box, wood, t, h, b.d - t * 2, b.x - b.w / 2 + t / 2, h / 2, b.z)), sh(mesh(geo.box, wood, t, h, b.d - t * 2, b.x + b.w / 2 - t / 2, h / 2, b.z)));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(sh(mesh(geo.box, post, 0.36, h + 0.14, 0.36, b.x + sx * (b.w / 2 - 0.12), (h + 0.14) / 2, b.z + sz * (b.d / 2 - 0.12))));
    if (!b.greenhouse) return;
    const frame = mat(PALETTE.frame), pane = mat(PALETTE.glass, { opacity: 0.2 }), H = 2.3;
    const hw = b.w / 2, hd = b.d / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(geo.box, frame, 0.1, H, 0.1, b.x + sx * hw, H / 2 + 0.2, b.z + sz * hd));
    for (const sz of [-1, 1]) g.add(mesh(geo.box, frame, b.w, 0.08, 0.08, b.x, H + 0.2, b.z + sz * hd), mesh(geo.box, pane, b.w, H, 0.03, b.x, H / 2 + 0.2, b.z + sz * hd));
    for (const sx of [-1, 1]) g.add(mesh(geo.box, frame, 0.08, 0.08, b.d, b.x + sx * hw, H + 0.2, b.z), mesh(geo.box, pane, 0.03, H, b.d, b.x + sx * hw, H / 2 + 0.2, b.z));
    for (const sx of [-1, 1]) { // gabled glass roof
      const roof = mesh(geo.box, pane, hw + 0.15, 0.04, b.d, b.x + sx * hw / 2, H + 0.2 + 0.45, b.z); roof.rotation.z = -sx * 0.5; g.add(roof);
    }
    g.add(mesh(geo.box, frame, b.w, 0.1, 0.1, b.x, H + 0.2 + 0.85, b.z)); // ridge beam
    g.add(mesh(geo.box, post, 0.8, 1.7, 0.05, b.x, 1.05, b.z + hd + 0.02)); // door
  }

  private isClaimed(path: string) {
    for (const c of this.snap.claims) if (c.path === path || (c.path.endsWith('/') && path.startsWith(c.path))) return true;
    return false;
  }

  /** Readable mode (key L): every full plant gets a text label with its stage, so status never relies on colour alone. */
  setPlantLabels(on: boolean) { this.showPlantLabels = on; this.syncPlantLabels(); }
  private syncPlantLabels() {
    if (!this.showPlantLabels || !this.snap) {
      for (const v of this.plantLabels.values()) this.labels.remove(v.el);
      this.plantLabels.clear(); return;
    }
    const byPath = new Map(this.snap.plants.map((p) => [p.path, p]));
    const want = this.layout.plants.filter((p) => this.field.get(p.path)?.full).slice(0, 60);
    const keep = new Set(want.map((p) => p.path));
    for (const [path, v] of this.plantLabels) if (!keep.has(path)) { this.labels.remove(v.el); this.plantLabels.delete(path); }
    for (const lp of want) {
      const pv = byPath.get(lp.path)!, name = lp.path.split('/').pop()!;
      const text = `${name.length > 14 ? `${name.slice(0, 13)}…` : name} · ${pv.stage}${pv.bugs ? ` · ${pv.bugs} bug${pv.bugs === 1 ? '' : 's'}` : ''}`;
      const cur = this.plantLabels.get(lp.path);
      if (cur && cur.text === text) continue;
      if (cur) this.labels.remove(cur.el);
      const at = new THREE.Vector3(lp.x, 0.9 * lp.size + 0.7, lp.z);
      this.plantLabels.set(lp.path, { el: this.labels.add(text, () => at, 'label plant'), text });
    }
  }

  /** Toggle between ground cover for quiet plants and showing every plant in full (key B). */
  toggleExpand() { this.expandAll = !this.expandAll; if (this.snap) this.syncPlants(false); return this.expandAll; }

  private syncPlants(reset: boolean) {
    const now = this.time, plants = this.layout.plants;
    this.field.keep(new Set(plants.map((p) => p.path)));
    const byPath = new Map(this.snap.plants.map((p) => [p.path, p]));
    const lod = !this.expandAll && plants.length > LOD_LIMIT;
    const live = new Set<string>();
    if (lod) for (const a of this.snap.agents) if (a.currentPath && a.status !== 'dormant') live.add(a.currentPath);
    for (const lp of plants) {
      const pv = byPath.get(lp.path)!;
      let stage = pv.stage;
      const hold = this.pendingBloom.get(lp.path);
      if (stage === 'bloom' && hold !== undefined) { if (performance.now() < hold) stage = 'bud'; else this.pendingBloom.delete(lp.path); }
      // Large gardens: quiet plants shrink to ground cover; anything that matters stays full.
      const full = !lod || stage === 'bud' || stage === 'bloom' || pv.bugs > 0 || this.snap.at - pv.lastActivity < ACTIVE_MS || live.has(lp.path) || this.isClaimed(lp.path);
      const r = this.field.upsert(lp.path, lp.x, lp.z, lp.size, stage, pv.bugs, full, now, reset);
      if (r.inst.stage === 'bloom' && r.wasStage !== undefined && r.wasStage !== 'bloom') {
        this.fx.burst(this.tmpV.set(lp.x, 1, lp.z), flowerColor(lp.path).getHex(), 50, 2.6, 3);
      }
      if (pv.bugs < r.bugsBefore && r.bugsBefore > 0) this.fx.burst(this.tmpV.set(lp.x, 0.8, lp.z), 0x222222, 12, 1.2, 4);
    }
    if (this.showPlantLabels) this.syncPlantLabels();
    this.syncWarnIcons();
  }

  // ---- botanist hooks (WorldLookup) ----
  /** The botanist arrived: let the held-back bloom open now. */
  releaseBloom(path: string) {
    if (!this.pendingBloom.delete(path)) return;
    if (this.snap) this.syncPlants(false);
  }
  wobblePlant(path: string, seconds: number) { const n = this.field.get(path); if (n) n.wobbleUntil = this.time + seconds; }
  showLock(path: string | null) {
    const n = path ? this.field.get(path) : undefined;
    this.lockMesh.visible = !!n;
    if (n) this.lockMesh.position.set(n.x + 0.45, 1.35 * n.size + 0.2, n.z);
  }

  /** One animated fence per claim: grows in, pulses when about to expire, collapses when released. */
  private fences = new Map<string, { group: THREE.Group; born: number; dying?: number; expiresAt: number; mats: THREE.MeshStandardMaterial[]; base: THREE.Color }>();
  private warnIcons = new Map<string, THREE.Sprite>();

  private syncFences() {
    const color = (h: string) => this.snap.members.find((m) => m.handle === h)?.color ?? '#888';
    this.gates.clear();
    const want = new Set<string>();
    for (const c of this.snap.claims) {
      const r = this.fenceRect(c.path); if (!r) continue;
      this.gates.set(c.path, new THREE.Vector3((r.minX + r.maxX) / 2, 0, r.maxZ));
      const key = `${c.id}|${r.minX.toFixed(1)},${r.minZ.toFixed(1)},${r.maxX.toFixed(1)},${r.maxZ.toFixed(1)}`;
      want.add(key);
      const have = this.fences.get(key);
      if (have) { have.expiresAt = c.expiresAt; have.dying = undefined; continue; }
      const base = new THREE.Color(color(c.handle));
      const m = new THREE.MeshStandardMaterial({ color: base, flatShading: true, emissive: 0x000000, roughness: 0.8 });
      const group = new THREE.Group(); group.scale.y = 0.001;
      const add = (o: THREE.Mesh) => { o.castShadow = true; group.add(o); };
      if (!c.path.endsWith('/')) { // one file: a ring of posts around the plant, not a whole pen
        const hit = this.layout.plants.find((q) => q.path === c.path);
        const cx = hit?.x ?? (r.minX + r.maxX) / 2, cz = hit?.z ?? (r.minZ + r.maxZ) / 2;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 6, 24), m); ring.rotation.x = Math.PI / 2; ring.position.set(cx, 0.45, cz); add(ring);
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(mesh(geo.box, m, 0.08, 0.55, 0.08, cx + Math.cos(a) * 0.8, 0.4, cz + Math.sin(a) * 0.8)); }
      } else {
        const side = (x0: number, z0: number, x1: number, z1: number) => {
          const len = Math.hypot(x1 - x0, z1 - z0), posts = Math.max(2, Math.round(len / 1.1) + 1);
          for (let i = 0; i < posts; i++) { const t = i / (posts - 1); add(mesh(geo.box, m, 0.08, 0.6, 0.08, x0 + (x1 - x0) * t, 0.5, z0 + (z1 - z0) * t)); }
          const rail = mesh(geo.box, m, 0.05, 0.05, len, (x0 + x1) / 2, 0.62, (z0 + z1) / 2);
          rail.rotation.y = Math.atan2(x1 - x0, z1 - z0); // box length runs along +z
          add(rail);
        };
        side(r.minX, r.minZ, r.maxX, r.minZ); side(r.maxX, r.minZ, r.maxX, r.maxZ);
        side(r.maxX, r.maxZ, r.minX, r.maxZ); side(r.minX, r.maxZ, r.minX, r.minZ);
      }
      this.fenceGroup.add(group);
      this.fences.set(key, { group, born: this.time, expiresAt: c.expiresAt, mats: [m], base });
    }
    for (const [key, f] of this.fences) if (!want.has(key) && f.dying === undefined) f.dying = this.time;
  }

  private tickFences(t: number, mo: number) {
    const now = this.snap?.at ?? 0;
    for (const [key, f] of this.fences) {
      let k = Math.min(1, (t - f.born) / 0.5);
      if (f.dying !== undefined) k = Math.max(0, 1 - (t - f.dying) / 0.4);
      f.group.scale.y = Math.max(0.001, k * k * (3 - 2 * k)); // smoothstep
      const left = (f.expiresAt - now) / 60000;
      const m = f.mats[0]!;
      if (left < 5 && f.dying === undefined) { // about to expire: pulse red
        const pulse = 0.5 + 0.5 * Math.sin(t * 5 * Math.max(0.4, mo));
        m.emissive.setRGB(0.8, 0.1, 0.05); m.emissiveIntensity = 0.15 + 0.5 * pulse * (left < 1 ? 1 : 0.6);
      } else m.emissiveIntensity = 0;
      if (f.dying !== undefined && k <= 0) { this.fenceGroup.remove(f.group); m.dispose(); this.fences.delete(key); }
    }
  }

  /** A warning icon over any plant with three or more bugs. */
  private syncWarnIcons() {
    const want = new Set<string>();
    for (const lp of this.layout.plants) {
      const pv = this.snap.plants.find((p) => p.path === lp.path);
      if (!pv || pv.bugs < 3) continue;
      want.add(lp.path);
      if (!this.warnIcons.has(lp.path)) {
        const sp = new THREE.Sprite(iconMat('⚠️')); sp.scale.setScalar(0.55); sp.position.set(lp.x, 1.9 * lp.size + 0.3, lp.z);
        this.scene.add(sp); this.warnIcons.set(lp.path, sp);
      }
    }
    for (const [path, sp] of this.warnIcons) if (!want.has(path)) { this.scene.remove(sp); this.warnIcons.delete(path); }
  }

  /** Look at a plant/fence/member and ring it briefly so the eye finds it. */
  focus(kind: 'member' | 'plant' | 'fence', key: string) {
    let p: THREE.Vector3 | undefined;
    if (kind === 'member') { this.focusOnMember(this.follow === key ? null : key); p = this.actors.gardenerPos(key); }
    else if (kind === 'plant') p = this.plantXZ.get(key);
    else { const hit = this.layout.plants.find((q) => q.path === key || (key.endsWith('/') && q.path.startsWith(key))); p = hit ? this.plantXZ.get(hit.path) : undefined; }
    if (!p) return;
    if (kind !== 'member') { this.follow = null; this.director = false; this.rig.flyTo(p); }
    this.pulseAt.copy(p); this.pulseT = 2.4;
  }
  /** Instantly frame one bed from the current viewing direction (used for named screenshot shots). */
  focusBed(name: string, dist = 11) {
    const b = this.layout.beds.find((x) => x.name === name) ?? this.layout.beds[0];
    if (b) this.lookAt(b.x, b.z, dist);
  }
  focusBotanist(dist = 8) { const h = this.actors.botanistHome; this.lookAt(h.x, h.z, dist); }
  private lookAt(x: number, z: number, dist: number) {
    this.rig.userMoved = true;
    const dir = this.tmpV.set(0, Math.sin(0.62), Math.cos(0.62)).multiplyScalar(dist);
    this.controls.target.set(x, 0.4, z); this.camera.position.set(x + dir.x, 0.4 + dir.y, z + dir.z); this.controls.update();
  }
  private pulseAt = new THREE.Vector3();
  private pulseT = 0;

  focusOnMember(handle: string | null) { this.follow = handle; if (handle) this.director = false; }
  /** Everything that should be on screen: beds, the gardeners' row in front, the botanist at the right. */
  private fitBox() {
    const bs = this.layout.beds;
    const { halfW, frontZ } = this.homeFrame;
    let minX = -halfW, maxX = halfW + 3.5, minZ = -4, maxZ = frontZ + 1.4;
    minZ = Math.min(minZ, -Math.max(4, this.layout.depth / 2) - 8); // the shed behind the beds
    for (const b of bs) { minX = Math.min(minX, b.x - b.w / 2); maxX = Math.max(maxX, b.x + b.w / 2); minZ = Math.min(minZ, b.z - b.d / 2); }
    return { minX: minX - 1, maxX: maxX + 1, minZ: minZ - 1, maxZ };
  }
  reservedForShed() { return this.reservedPx(); }
  /** Space the shed takes: a column on the right on wide screens, a bottom sheet on narrow ones. */
  private reservedPx(): number {
    const shed = document.getElementById('shed');
    if (!shed || shed.offsetWidth === 0 || getComputedStyle(shed).display === 'none') { this.reservedBottom = 0; return 0; }
    if (shed.classList.contains('collapsed')) { this.reservedBottom = 0; return 0; } // just a small pill
    if (innerWidth < 900) { this.reservedBottom = shed.offsetHeight + 12; return 0; }
    this.reservedBottom = 0;
    return shed.offsetWidth + 24;
  }
  private reservedBottom = 0;
  refit(instant = false) {
    const r = this.reservedPx();
    this.rig.setReserved(r, this.reservedBottom);
    this.scaleToDistance(this.rig.fit(this.fitBox(), undefined, instant));
  }
  /** Big gardens need a farther camera, a deeper far plane and fog that starts later. */
  private scaleToDistance(dist: number) {
    const fog = this.scene.fog as THREE.Fog;
    fog.near = Math.max(40, dist * 0.9); fog.far = Math.max(120, dist * 3.2);
    const far = Math.max(400, dist * 5);
    if (this.camera.far !== far) { this.camera.far = far; this.camera.updateProjectionMatrix(); }
  }
  /** Reframe (F): clears manual moves and fits everything. */
  frameGarden(instant = false) { this.refit(instant); }

  private resize() {
    const w = this.host.clientWidth || innerWidth, h = this.host.clientHeight || innerHeight;
    if (this.available) this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const r = this.reservedPx();
    this.rig.setReserved(r, this.reservedBottom);
    if (!this.rig.userMoved) this.scaleToDistance(this.rig.fit(this.fitBox(), undefined, true));
  }

  /** Timelapse season grading (0..1), or null for normal. */
  setSeason(p: number | null) { this.props.setSeason(p); }
  get motionFactor() { return this.reducedMotion || this.calm ? 0.25 : 1; }
  /** Calm mode: gentler motion, no camera push-ins, fewer particles. */
  setCalm(on: boolean) {
    this.calm = on; this.rig.calm = on;
    this.actors.motion = this.motionFactor; this.fx.reducedMotion = on || this.reducedMotion;
  }

  /** Run the simulation for `seconds` of scene time in 1/30 s steps, rendering only the last frame. Debug/test use. */
  advance(seconds: number) {
    const steps = Math.max(1, Math.round(seconds * 30));
    for (let i = 0; i < steps; i++) this.frame(1 / 30, i === steps - 1);
  }

  /** Render `frames` frames back to back, forcing the GPU to finish each, and report honest per-frame timings. */
  benchFrames(frames = 120) {
    if (!this.available) return { error: 'no WebGL' };
    const gl = this.renderer.getContext(), times: number[] = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      this.frame(1 / 60, true);
      gl.finish();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return {
      frames, avgMs: +avg.toFixed(2), p95Ms: +times[Math.floor(times.length * 0.95)]!.toFixed(2), maxMs: +times[times.length - 1]!.toFixed(2),
      fps: +(1000 / avg).toFixed(1), plants: this.field.stats(), drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
    };
  }

  private frame(dtOverride?: number, render = true) {
    const dt = dtOverride ?? Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    const t = this.time, mo = this.motionFactor;
    this.actors.tick(dt); this.fx.update(dt);
    // Botanist shot: dim the scene a little, light the plant, push the camera in.
    const shot = this.actors.shot;
    this.dim += ((shot ? 0.72 : 1) - this.dim) * Math.min(1, dt * 3);
    this.hemi.intensity = this.baseHemi * this.dim; this.sun.intensity = this.baseSun * this.dim;
    const sm = this.shaft.material as THREE.MeshBasicMaterial, rm = this.spotRing.material as THREE.MeshBasicMaterial;
    sm.opacity += ((shot ? 0.16 : 0) - sm.opacity) * Math.min(1, dt * 4);
    rm.opacity += ((shot ? 0.55 : 0) - rm.opacity) * Math.min(1, dt * 4);
    this.shaft.visible = sm.opacity > 0.004;
    if (shot) {
      this.shaft.position.set(shot.point.x, 3.6, shot.point.z);
      this.spotRing.position.set(shot.point.x, 0.32, shot.point.z); this.spotRing.scale.setScalar(1 + Math.sin(t * 3) * 0.06 * mo);
      if (!this.rig.userMoved && !this.calm) this.rig.pushIn(shot.point, 6.6);
    } else if (this.rig.cinema) this.rig.release();
    this.field.update(t, mo);
    this.tickFences(t, mo);
    this.props.update(t, dt, 0, 0, mo);
    // Camera: follow a member, or director mode follows the latest action.
    let focus: THREE.Vector3 | undefined;
    if (shot) focus = undefined; // the cinematic shot owns the camera
    else if (this.follow) focus = this.actors.gardenerPos(this.follow);
    else if (this.director) focus = this.actors.focus;
    if (focus) {
      const d = this.tmpV.copy(focus).sub(this.controls.target).multiplyScalar(Math.min(1, dt * 1.6));
      this.controls.target.add(d); this.camera.position.add(d);
    }
    if (this.pulseT > 0) {
      this.pulseT -= dt;
      const k = Math.max(0, this.pulseT / 2.4), pm = this.pulse.material as THREE.MeshBasicMaterial;
      this.pulse.visible = true; this.pulse.position.set(this.pulseAt.x, 0.34, this.pulseAt.z);
      this.pulse.scale.setScalar(1 + (1 - k) * 2.2); pm.opacity = 0.75 * k;
    } else this.pulse.visible = false;
    this.rig.update(dt);
    this.controls.update();
    this.labels.update(this.host.clientWidth, this.host.clientHeight, this.rig.reservedRight, this.rig.reservedBottom);
    if (render && this.available) this.renderer.render(this.scene, this.camera);
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
  }
}
