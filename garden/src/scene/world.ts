import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GardenSnapshot, PlantStage, PlantView } from '../../../shared/types.ts';
import { BED_PAD, layoutGarden, layoutPaths, layoutTaskPlants, SPACING, type BedLayout, type GardenLayout, type PathLayout, type PlantLayout } from '../layout.ts';
import { bedStyleOf, collapseGenerated, speciesOf } from '../species.ts';
import { TaskPlants } from './taskPlants.ts';
import { currentTaskOf, taskModels } from '../tasks.ts';
import { hoverText } from '../ui/inspect.ts';
import { isClick, personAt, pickAt, pickColumn, samePick, type Pick, type PickScene } from '../pick.ts';
import type { Store, StoreUpdate } from '../data/store.ts';
import { Actors, iconMat, type WorldLookup } from './actors.ts';
import type { Spot } from './wander.ts';
import { GardenLamps } from './lamps.ts';
import { lampLevel, lampSpots } from '../lamps.ts';
import { Labels, Particles } from './effects.ts';
import { geo, mat, mergeByMaterial, mesh } from './materials.ts';
import { PlantField, plantHeight } from './plantField.ts';
import { Pond } from './pond.ts';
import { pondLink, pondSpot } from '../pond.ts';
import { Nav } from '../nav.ts';
import { CameraRig } from './camera.ts';
import { PALETTE } from './palette.ts';
import { Props, type Quality } from './props.ts';
import { GardenBoundary } from './boundary.ts';
import { ContactShadows } from './contactShadows.ts';
import { SWAY } from './sway.ts';
import { Post } from './post.ts';
import { paintSign } from './signTexture.ts';
import { gardenFence, signLine, type Rect } from '../boundary.ts';

const FENCE_RING = new THREE.TorusGeometry(0.8, 0.05, 6, 24); // one-file fences share this
const LOD_LIMIT = 80; // above this many plants, quiet ones become ground cover
const ACTIVE_MS = 30 * 60_000;
const AO_MAX_DIST = 160; // camera distance beyond which ambient occlusion is skipped (depth precision gives artifacts)

/** Free the GPU buffers of baked (merged) scenery before it is rebuilt; the shared unit shapes are left alone. */
/** The row path level with the pond simply carries on to the water (one path, no seam where two would meet). */
function withPondLink(paths: PathLayout[], link: PathLayout): PathLayout[] {
  return paths.map((p) => {
    if (p.w <= p.d || p.z !== link.z) return p;
    const x0 = p.x - p.w / 2, x1 = Math.max(p.x + p.w / 2, link.x + link.w / 2);
    return { ...p, x: (x0 + x1) / 2, w: x1 - x0 };
  });
}

const capC = new THREE.Color();
/** A bed border's top edge: the border colour, a little lighter. */
const capColor = (border: string) => `#${capC.set(border).offsetHSL(0, -0.04, 0.1).getHexString()}`;

export function disposeGeometries(root: THREE.Object3D) {
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && m.geometry !== geo.box && m.geometry !== geo.sphere && m.geometry !== geo.cyl && m.geometry !== geo.cone) m.geometry.dispose(); });
}

export class GardenWorld implements WorldLookup {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  readonly controls: OrbitControls;
  readonly rig: CameraRig;
  private labels: Labels;
  private fx: Particles;
  private pond: Pond;
  private actors: Actors;
  private tasks!: TaskPlants;
  private hoverEl = document.createElement('div');
  private down: { x: number; y: number } | undefined;
  private hoverAt: { x: number; y: number } | undefined;
  private hovered: Pick | null = null;
  private hoverDirty = false; private hoverTick = 0;
  selected: Pick | null = null;
  /** A click in the garden picked something (or empty ground: null). */
  onSelect: (p: Pick | null) => void = () => {};
  private ray = new THREE.Raycaster(); private ndc = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3); // plant mid-height
  private hit = new THREE.Vector3();
  private selRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.2, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
  private hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.08, 48), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.55, depthWrite: false }));
  private sun = new THREE.DirectionalLight(0xffe2b0, 2.7); // warm sun, a little lower: longer shadows
  private hemi = new THREE.HemisphereLight(0xd4e9ff, 0x6b7a55, 1.2); // cool sky fill, cooler ground bounce in the shade
  nav = new Nav([]);
  private props!: Props;
  private boundary!: GardenBoundary;
  private lamps!: GardenLamps;
  /** ?hour=21 previews any time of day (sky, sun and lamps) instead of the local clock. */
  private hourOverride = (() => { const q = new URLSearchParams(globalThis.location?.search ?? ''); const h = Number(q.get('hour')); return q.has('hour') && Number.isFinite(h) ? Math.min(24, Math.max(0, h)) : undefined; })();
  private repoName = 'our garden';
  /** The repo name painted on the arch (set by the page; repaints at once, even with no data arriving). */
  set repo(name: string) { if (name === this.repoName) return; this.repoName = name; if (this.snap) this.boundary.setSign(name, signLine(this.snap)); }
  get repo() { return this.repoName; }
  private gardenRect?: Rect;
  private signGroup = new THREE.Group(); // painted bed signs (textured, so kept out of the merged bed group)
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
  private viewPlants: PlantView[] = []; // snapshot plants with each module_bindings folder folded into one hedge
  private hedgeOf = new Map<string, string>(); // generated file -> its hedge path
  private bedLabels: HTMLElement[] = [];
  /** Blooms held back until the botanist reaches the plant (path -> deadline in performance.now ms). */
  private pendingBloom = new Map<string, number>();
  // A cheap "spotlight": a soft additive light shaft (a real SpotLight costs per-pixel lighting on every material).
  private shaft = new THREE.Mesh(new THREE.ConeGeometry(1.7, 7, 28, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  private spotRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false }));
  private lockMesh = new THREE.Group();
  private pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 40), new THREE.MeshBasicMaterial({ color: 0xff7a59, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  private baseHemi = 1.2; private baseSun = 2.7; private moon = new THREE.Color('#9fb3ff');
  private contact!: ContactShadows;
  private post?: Post;
  private dim = 1;
  private clock = new THREE.Clock();
  /** Scene time in seconds; advances with real frames or with advance() (deterministic, for tests and hidden panes). */
  private time = 0;
  extent = 10;
  director = false;
  /** What the camera follows: a handle (the gardener) or "agent:<sessionId>" (a bot or helper spirit). */
  follow: string | null = null;
  private followZoom = false; // ease in close after a click; dropped as soon as the user moves the camera
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  onLayout: (l: GardenLayout) => void = () => {};
  /** Called when a followed agent disappears (it finished), so the UI can update. */
  onFollowEnd: () => void = () => {};
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
      gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 0.92; // filmic: richer colour, soft highlights
      host.appendChild(gl.domElement);
    }
    const labelHost = document.createElement('div'); labelHost.className = 'labels'; host.appendChild(labelHost);
    this.labels = new Labels(labelHost, this.camera);
    this.field = new PlantField(this.scene);
    this.fx = new Particles(this.scene);
    this.pond = new Pond(this.scene, this.labels);
    this.actors = new Actors(this.scene, this, this.labels, this.fx);
    this.actors.motion = this.reducedMotion ? 0.25 : 1;
    this.tasks = new TaskPlants(this.scene, this.labels); this.hoverEl.hidden = true; host.appendChild(this.hoverEl);
    this.fx.reducedMotion = this.reducedMotion;

    this.scene.fog = new THREE.Fog('#cfe6ee', 40, 120);
    this.props = new Props(this.scene, this.quality, () => this.onShedClick());
    this.boundary = new GardenBoundary(this.scene); this.scene.add(this.signGroup);
    this.scene.add(this.hemi, this.sun, this.bedGroup, this.fenceGroup);
    if (gl && this.quality === 'low') gl.shadowMap.enabled = false;
    this.shaft.position.y = 3.6; this.scene.add(this.shaft);
    this.pulse.rotation.x = -Math.PI / 2; this.pulse.visible = false; this.scene.add(this.pulse);
    this.spotRing.rotation.x = -Math.PI / 2; this.spotRing.position.y = 0.32; this.scene.add(this.spotRing);
    // rings sit just above the soil (ringY), so they stay depth-tested: people and trees in front still hide them
    for (const r of [this.selRing, this.hoverRing]) { r.rotation.x = -Math.PI / 2; r.visible = false; this.scene.add(r); }
    this.hoverEl.className = 'tip'; this.hoverEl.setAttribute('aria-hidden', 'true');
    this.lockMesh.add(mesh(geo.box, mat('#c9a227'), 0.28, 0.22, 0.12, 0, 0, 0));
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12, Math.PI), mat('#8d8d8d')); shackle.position.y = 0.11;
    this.lockMesh.add(shackle); this.lockMesh.scale.setScalar(0.6); this.lockMesh.visible = false; this.scene.add(this.lockMesh);
    this.sun.position.set(16, 21, 13); this.sun.castShadow = true; this.scene.add(this.sun.target);
    this.lamps = new GardenLamps(this.scene, this.quality);
    this.contact = new ContactShadows(this.scene); this.contact.visible = this.quality !== 'low';
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03; // no shadow acne (moire spokes on the meadow)

    this.camera.position.set(0, 18, 22);
    this.controls = new OrbitControls(this.camera, gl?.domElement ?? document.createElement('canvas'));
    this.controls.addEventListener('start', () => { this.followZoom = false; });
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.48; this.controls.maxDistance = 90;
    this.rig = new CameraRig(this.camera, this.controls, host);
    // Hover shows a one-line tooltip and a soft ring; a click (not a drag) selects. Hover is resolved once per frame.
    if (gl) {
      gl.domElement.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY }; });
      gl.domElement.addEventListener('pointerup', (e) => {
        const click = isClick(this.down, { x: e.clientX, y: e.clientY }); this.down = undefined;
        if (!click) return;
        const p = this.pickUnder(e.clientX, e.clientY);
        if (p?.kind === 'shed') { this.props.shedClicked(); return; }
        this.onSelect(p);
      });
      gl.domElement.addEventListener('pointermove', (e) => { this.hoverAt = { x: e.clientX, y: e.clientY }; this.hoverDirty = true; });
      gl.domElement.addEventListener('pointerleave', () => { this.hoverAt = undefined; this.setHover(null, 0, 0); });
    }
    if (gl && this.quality !== 'low') {
      const qp = new URLSearchParams(location.search);
      this.post = new Post(gl, this.scene, this.camera, { ao: qp.get('ao') !== '0', bloom: qp.get('bloom') !== '0' });
    }
    this.resize(); addEventListener('resize', () => this.resize());

    store.subscribe((u) => this.onUpdate(u));
    if (gl) gl.setAnimationLoop(() => { try { this.frame(); } catch (e) { this.onError(e); } });
  }

  // ---- WorldLookup ----
  plantPos(path: string) { return this.plantXZ.get(path); }
  taskPlantPos(handle: string) { const t = this.snap ? currentTaskOf(this.snap, handle) : undefined; return t ? this.tasks.posOf(t.id) : undefined; }
  bedCenter(bed: string) { const b = this.layout.beds.find((x) => x.name === bed); return b ? new THREE.Vector3(b.x, 0, b.z) : undefined; }
  bedOfPath(path: string) { const key = this.hedgeOf.get(path) ?? path; return this.layout.plants.find((p) => p.path === key)?.bed; }
  private gates = new Map<string, THREE.Vector3>(); // claim path -> gate point, rebuilt with the fences
  fenceGate(path: string) {
    const claim = this.snap?.claims.find((c) => c.path === path || (c.path.endsWith('/') && path.startsWith(c.path)));
    return claim ? this.gates.get(claim.path) : undefined;
  }
  /** Front edge of the garden where gardeners wait, and half the garden's width. */
  private fixedSpots: Spot[] = []; private potSpots: Spot[] = []; private allSpots: Spot[] = []; private potKey = '';
  get roamSpots() { return this.allSpots; }
  /** Task pots move as tasks come and go: refresh their visit spots (cheap; only rebuilt when they change). */
  private refreshPotSpots() {
    const pots: Spot[] = []; this.tasks.forEachPos((x, z) => pots.push({ x, z: z + 0.9, fx: x, fz: z }));
    const key = pots.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(';');
    if (key === this.potKey) return;
    this.potKey = key; this.potSpots = pots; this.allSpots = [...this.fixedSpots, ...pots];
  }
  get homeFrame() { return { halfW: Math.max(6, this.layout.width / 2), frontZ: Math.max(4, this.layout.depth / 2) + 3.6 }; }
  gardenerPos(handle: string) { return this.actors.gardenerPos(handle); }
  get botFocus() { return this.actors.focus; }
  setMotion(m: number) { this.actors.motion = m; this.fx.reducedMotion = m < 0.5; }

  private fenceRect(claimPath: string) {
    claimPath = this.hedgeOf.get(claimPath) ?? claimPath;
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
    this.boundary.setSign(this.repo, signLine(u.snapshot));
    this.pond.sync(u.snapshot.activity, u.snapshot.at, u.snapshot.members);
    this.actors.sync(u.snapshot);
    const models = taskModels(u.snapshot);
    this.tasks.sync(models, layoutTaskPlants(this.layout, models), this.time);
    this.refreshPotSpots();
    const notes: Array<'fence' | 'request' | 'handoff' | 'bloom' | 'refused'> = [];
    for (const _c of u.snapshot.claims) notes.push('fence');
    for (const m of u.snapshot.messages) if (m.status !== 'acked') notes.push('request');
    for (const h of u.snapshot.handoffs ?? []) if (h.status === 'offered') notes.push('handoff');
    for (const c of u.snapshot.certifications.slice(-2)) notes.push(c.result === 'bloom' ? 'bloom' : 'refused');
    this.props.setNotes(notes.slice(0, 8));
    for (const a of u.newActivity) this.actors.onActivity(a);
    for (const e of u.events) if (e.table === 'handoffs' && e.op !== 'deleted') this.actors.onHandoff(e.row as never, e.op);
    const d = new Date(u.snapshot.at || Date.now());
    const hour = this.hourOverride ?? d.getHours() + d.getMinutes() / 60;
    // Night falls as the lamps come on: dimmer, cooler moonlight (still readable on a projector), warm lamp pools.
    const lv = lampLevel(hour);
    this.lamps.setLevel(lv);
    const c = this.props.setHour(hour);
    (this.scene.background as THREE.Color | null) ? (this.scene.background as THREE.Color).copy(c) : (this.scene.background = c.clone());
    (this.scene.fog as THREE.Fog).color.copy(c);
    const daySun = hour > 17.5 || hour < 7 ? 2.1 : 2.7;
    this.baseHemi = 1.2 + (0.6 - 1.2) * lv; this.baseSun = daySun + (0.5 - daySun) * lv;
    this.sun.color.set(hour > 17.5 && hour < 20.5 ? '#ffc58a' : '#fff0d0').lerp(this.moon, lv);
  }

  private syncLayout() {
    const folded = collapseGenerated(this.snap.plants);
    this.viewPlants = folded.plants; this.hedgeOf = folded.hedgeOf;
    this.layout = layoutGarden(this.viewPlants);
    this.plantXZ.clear();
    for (const p of this.layout.plants) this.plantXZ.set(p.path, new THREE.Vector3(p.x, 0, p.z));
    for (const [file, hedge] of this.hedgeOf) { const at = this.plantXZ.get(hedge); if (at) this.plantXZ.set(file, at); }
    this.extent = Math.max(10, Math.max(this.layout.width, this.layout.depth) / 2 + 2);
    const hedges = this.layout.plants.filter((p) => speciesOf(p.path) === 'clover');
    const key = JSON.stringify([this.layout.beds, hedges]);
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      disposeGeometries(this.bedGroup);
      this.bedGroup.clear();
      for (const o of [...this.signGroup.children]) { const m = o as THREE.Mesh, sm = m.material as THREE.MeshStandardMaterial; sm.map?.dispose(); sm.dispose(); m.geometry.dispose(); }
      this.signGroup.clear();
      for (const el of this.bedLabels) this.labels.remove(el);
      this.bedLabels = [];
      for (const b of this.layout.beds) {
        const sign = this.buildBed(b, this.layout.plants.filter((p) => p.bed === b.name));
        const el = this.labels.add((b.greenhouse ? `${b.name} (greenhouse)` : b.name).replace(/^(.{22}).+$/, '$1…'), () => sign, 'label bed');
        el.classList.toggle('off', !this.showPlantLabels); // the painted sign names the bed; the pill only with L
        this.bedLabels.push(el);
      }
      for (const h of hedges) { const at = new THREE.Vector3(h.x, 0.75, h.z); this.bedLabels.push(this.labels.add('generated', () => at, 'label plant')); }
      mergeByMaterial(this.bedGroup);
      const ps = pondSpot(this.layout); this.pond.place(ps.x, ps.z, ps.r);
      this.nav = new Nav(this.layout.beds);
      const hf = this.homeFrame;
      const fence = gardenFence(this.layout, hf.frontZ); this.gardenRect = fence.rect;
      this.boundary.rebuild(fence); this.fitShadow(fence.rect);
      // where idle gardeners stroll: in front of each bed, the pond's near rim, inside the arch, the shed door
      const cx = (fence.rect.minX + fence.rect.maxX) / 2, cz = (fence.rect.minZ + fence.rect.maxZ) / 2;
      const pd = Math.hypot(cx - ps.x, cz - ps.z) || 1, rim = ps.r + 0.9;
      this.fixedSpots = [
        ...this.layout.beds.map((b) => ({ x: b.x, z: b.z + b.d / 2 + 0.9, fx: b.x, fz: b.z })),
        { x: ps.x + ((cx - ps.x) / pd) * rim, z: ps.z + ((cz - ps.z) / pd) * rim, fx: ps.x, fz: ps.z },
        { x: fence.gate.x, z: fence.rect.maxZ - 1.5, fx: fence.gate.x, fz: fence.rect.maxZ },
      ];
      this.props.rebuild(Math.max(6, this.layout.width / 2), Math.max(4, this.layout.depth / 2), hf.frontZ, withPondLink(layoutPaths(this.layout), pondLink(this.layout)), [(({ x, z, r }) => ({ x, z, r: r * 1.5 }))(pondSpot(this.layout))], fence.rect);
      const shed = this.props.shed.position, sr = this.props.shed.rotation.y;
      this.fixedSpots.push({ x: shed.x + Math.sin(sr) * 2, z: shed.z + Math.cos(sr) * 2, fx: shed.x, fz: shed.z });
      this.potKey = '\u0000'; this.refreshPotSpots();
      this.lamps.rebuild(lampSpots(fence, layoutPaths(this.layout), shed, { beds: this.layout.beds, pond: ps }));
      this.lamps.prewarm(this.renderer, this.camera); // no stutter when the lamps switch on at dusk
      this.rig.setLand(this.props.landRadius);
      if (!this.rig.userMoved) this.refit(this.layoutFirst);
      this.layoutFirst = false;
    }
    this.onLayout(this.layout);
  }

  /**
   * A bed, dressed by bedStyleOf: a raised bed with a border from a small palette (picked by folder name), tilled
   * soil and a signboard; the tests bed gets a glass greenhouse; root files sit on stepping stones. Returns where
   * the folder-name label goes (on the signboard).
   */
  private buildBed(b: BedLayout, plants: PlantLayout[]): THREE.Vector3 {
    const style = bedStyleOf(b.name), g = this.bedGroup;
    const sh = (o: THREE.Mesh, cast = true) => { o.castShadow = cast; o.receiveShadow = true; return o; };
    // signboard at the front-left corner, just outside the bed
    const sx0 = b.x - b.w / 2 + 1.7, sz0 = b.z + b.d / 2 + 0.4;
    g.add(sh(mesh(geo.box, mat(PALETTE.woodDark), 0.12, 1.1, 0.12, sx0 - 1.25, 0.55, sz0)), sh(mesh(geo.box, mat(PALETTE.woodDark), 0.12, 1.1, 0.12, sx0 + 1.25, 0.55, sz0)));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.75), new THREE.MeshStandardMaterial({ map: paintSign(b.greenhouse ? `${b.name} 🧪` : b.name, '', { w: 512, h: 128 }), roughness: 0.85 }));
    face.position.set(sx0, 0.95, sz0 + 0.08); face.rotation.x = -0.35; face.castShadow = true; this.signGroup.add(face);
    const sign = new THREE.Vector3(sx0, 0.95, sz0 + 0.1);
    if (style.kind === 'stones') {
      g.add(sh(mesh(geo.box, mat(PALETTE.path), b.w - 0.4, 0.04, b.d - 0.4, b.x, 0.02, b.z), false));
      for (const p of plants) g.add(sh(mesh(geo.cyl, mat(PALETTE.stone), 0.62, 0.14, 0.55, p.x, 0.07, p.z), false));
      return sign;
    }
    g.add(sh(mesh(geo.box, mat(PALETTE.mulch), b.w + 0.36, 0.04, b.d + 0.36, b.x, -0.04, b.z), false)); // bark mulch rim seats the bed in the grass
    const t = 0.28, h = 0.42, g2 = style.kind === 'greenhouse';
    const wood = mat(g2 ? PALETTE.wood : style.border), post = mat(g2 ? PALETTE.woodDark : style.post);
    g.add(sh(mesh(geo.box, mat(PALETTE.soil), b.w - t * 2, 0.34, b.d - t * 2, b.x, 0.17, b.z), false));
    // a raised, rounded mound under each row of plants (rows sit SPACING apart from BED_PAD)
    const rows = Math.max(1, Math.round((b.d - BED_PAD * 2) / SPACING)), moundM = mat(PALETTE.mound);
    for (let r = 0; r < rows; r++) {
      const mound = sh(mesh(geo.cyl, moundM, 0.07, b.w - t * 2 - 0.9, 0.55, b.x, 0.31, b.z - b.d / 2 + BED_PAD + SPACING * (r + 0.5)), false);
      mound.rotation.z = Math.PI / 2; g.add(mound);
    }
    g.add(sh(mesh(geo.box, wood, b.w, h, t, b.x, h / 2, b.z - b.d / 2 + t / 2)), sh(mesh(geo.box, wood, b.w, h, t, b.x, h / 2, b.z + b.d / 2 - t / 2)));
    g.add(sh(mesh(geo.box, wood, t, h, b.d - t * 2, b.x - b.w / 2 + t / 2, h / 2, b.z)), sh(mesh(geo.box, wood, t, h, b.d - t * 2, b.x + b.w / 2 - t / 2, h / 2, b.z)));
    const cap = mat(g2 ? PALETTE.woodLight : capColor(style.border)); // lighter top edge gives the border definition
    g.add(sh(mesh(geo.box, cap, b.w + 0.04, 0.05, t + 0.06, b.x, h + 0.025, b.z - b.d / 2 + t / 2)), sh(mesh(geo.box, cap, b.w + 0.04, 0.05, t + 0.06, b.x, h + 0.025, b.z + b.d / 2 - t / 2)));
    g.add(sh(mesh(geo.box, cap, t + 0.06, 0.05, b.d - t * 2, b.x - b.w / 2 + t / 2, h + 0.025, b.z)), sh(mesh(geo.box, cap, t + 0.06, 0.05, b.d - t * 2, b.x + b.w / 2 - t / 2, h + 0.025, b.z)));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(sh(mesh(geo.box, post, 0.36, h + 0.14, 0.36, b.x + sx * (b.w / 2 - 0.12), (h + 0.14) / 2, b.z + sz * (b.d / 2 - 0.12))));
    if (!g2) return sign;
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
    return sign;
  }

  private isClaimed(path: string) {
    for (const c of this.snap.claims) if (c.path === path || (c.path.endsWith('/') && path.startsWith(c.path))) return true;
    return false;
  }

  /** Readable mode (key L): every full plant gets a text label with its stage, so status never relies on colour alone. */
  setPlantLabels(on: boolean) { this.showPlantLabels = on; for (const el of this.bedLabels) if (el.classList.contains('bed')) el.classList.toggle('off', !on); this.syncPlantLabels(); }
  private syncPlantLabels() {
    if (!this.showPlantLabels || !this.snap) {
      for (const v of this.plantLabels.values()) this.labels.remove(v.el);
      this.plantLabels.clear(); return;
    }
    const byPath = new Map(this.viewPlants.map((p) => [p.path, p]));
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
    const byPath = new Map(this.viewPlants.map((p) => [p.path, p]));
    const lod = !this.expandAll && plants.length > LOD_LIMIT;
    const live = new Set<string>();
    const colorOf = new Map(this.snap.members.map((m) => [m.handle, m.color]));
    if (lod) for (const a of this.snap.agents) if (a.currentPath && a.status !== 'dormant') live.add(a.currentPath);
    for (const lp of plants) {
      const pv = byPath.get(lp.path)!;
      let stage = pv.stage;
      const hold = this.pendingBloom.get(lp.path);
      if (stage === 'bloom' && hold !== undefined) { if (performance.now() < hold) stage = 'bud'; else this.pendingBloom.delete(lp.path); }
      // Large gardens: quiet plants shrink to ground cover; anything that matters stays full.
      const full = !lod || speciesOf(lp.path) === 'clover' || stage === 'bud' || stage === 'bloom' || pv.bugs > 0 || this.snap.at - pv.lastActivity < ACTIVE_MS || live.has(lp.path) || this.isClaimed(lp.path);
      const owner = pv.lastTouchedBy ? colorOf.get(pv.lastTouchedBy) : undefined;
      const r = this.field.upsert(lp.path, lp.x, lp.z, lp.size, stage, pv.bugs, full, now, reset, owner);
      if (r.inst.stage === 'bloom' && r.wasStage !== undefined && r.wasStage !== 'bloom') {
        this.fx.burst(this.tmpV.set(lp.x, 1, lp.z), r.inst.bloom.getHex(), 50, 2.6, 3);
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
    if (n) this.lockMesh.position.set(n.x + 0.38, 1.0 * n.size + 0.45, n.z);
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
        const ring = new THREE.Mesh(FENCE_RING, m); ring.rotation.x = Math.PI / 2; ring.position.set(cx, 0.45, cz); add(ring);
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
      const pv = this.viewPlants.find((p) => p.path === lp.path);
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
  focus(kind: 'member' | 'agent' | 'plant' | 'fence', key: string) {
    let p: THREE.Vector3 | undefined;
    if (kind === 'member') { this.focusOnMember(this.follow === key ? null : key); p = this.actors.gardenerPos(key); }
    else if (kind === 'agent') { this.focusOnMember(this.follow === `agent:${key}` ? null : `agent:${key}`); p = this.actors.agentPos(key); }
    else if (kind === 'plant') p = this.plantXZ.get(key);
    else { const hit = this.layout.plants.find((q) => q.path === key || (key.endsWith('/') && q.path.startsWith(key))); p = hit ? this.plantXZ.get(hit.path) : undefined; }
    if (!p) return;
    if (kind !== 'member' && kind !== 'agent') { this.follow = null; this.director = false; this.rig.flyTo(p); }
    this.pulseAt.copy(p); this.pulseT = 2.4;
  }
  /** Shadows only where the garden is: a tight shadow frustum around the fence gives crisper shadows. */
  private fitShadow(r: Rect) {
    const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2, half = Math.max(r.maxX - r.minX, r.maxZ - r.minZ) / 2 + 3;
    this.sun.target.position.set(cx, 0, cz); this.sun.position.set(cx + 16, 21, cz + 13);
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.near = 1; sc.far = 80 + half; sc.updateProjectionMatrix();
    const size = half > 40 ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.setScalar(size); this.sun.shadow.map?.dispose(); (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null; }
  }

  /** Everything clickable, in pick order. Characters are projected to screen circles; the rest is on the ground. */
  private pickUnder(cx: number, cy: number): Pick | null {
    if (!this.snap || document.body.classList.contains('plan-open')) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const people: PickScene['people'] = [];
    this.actors.forEachPerson((pick, pos) => {
      const v = this.tmpV.copy(pos).setY(pos.y + 0.8).project(this.camera);
      if (v.z > 1) return;
      const depth = this.camera.position.distanceTo(pos);
      people.push({ pick, sx: r.left + ((v.x + 1) / 2) * r.width, sy: r.top + ((1 - v.y) / 2) * r.height, r: Math.max(14, 900 / depth), depth, at: { x: pos.x, z: pos.z } });
    });
    // a gardener and their bot both pick as the member: ring whichever one is under the pointer
    this.personAnchor = personAt({ x: cx, y: cy }, people)?.at;
    const g = this.ray.ray.intersectPlane(this.groundPlane, this.hit);
    // plants are columns from their soil to their top, so tall plants and plants on mounds pick where they are drawn
    const cols = this.layout.plants.map((p) => {
      const f = this.field.get(p.path), y0 = this.plantBase(p.bed);
      return { path: p.path, x: p.x, z: p.z, r: Math.max(0.45, p.size * 0.42), y0, y1: y0 + plantHeight(f?.stage ?? 'seed', p.size, f?.full !== false) };
    });
    return pickAt({
      screen: { x: cx, y: cy }, ground: g ? { x: g.x, z: g.z } : null,
      task: this.tasks.pick(this.ray), shed: this.props.hitShed(this.ray), arch: this.boundary.hit(this.ray),
      plant: pickColumn(this.ray.ray.origin, this.ray.ray.direction, cols),
    }, {
      people, plants: [],
      commits: this.pond.padSpots(), pond: this.pond.spot,
      beds: this.layout.beds.map((b) => ({ name: b.name, x: b.x, z: b.z, w: b.w, d: b.d })),
    });
  }

  /** Soil height under a bed's plants: stepping stones sit low, raised beds high. */
  private plantBase(bed: string) { return bedStyleOf(bed).kind === 'stones' ? 0.1 : 0.32; }

  private setHover(p: Pick | null, cx: number, cy: number) {
    this.hovered = p;
    const text = p && this.snap ? hoverText(p, this.snap) : null;
    if (!p || !text) { this.hoverEl.hidden = true; this.hoverRing.visible = false; this.renderer.domElement.style.cursor = ''; return; }
    this.renderer.domElement.style.cursor = 'pointer';
    // every pick hovers the same way: one plain line + a ring (a task's full card lives in the inspector)
    this.hoverEl.className = 'tip'; this.hoverEl.textContent = text; this.hoverEl.hidden = false;
    this.hoverEl.style.left = `${Math.min(innerWidth - 300, cx + 16)}px`; this.hoverEl.style.top = `${Math.max(8, cy - 34)}px`;
    const at = (p.kind === 'member' && this.personAnchor ? this.tmpV.set(this.personAnchor.x, 0, this.personAnchor.z) : undefined) ?? this.pickPos(p);
    this.hoverRing.visible = !!at && !samePick(p, this.selected);
    if (at) { this.hoverRing.position.set(at.x, this.ringY(p), at.z); this.hoverRing.scale.setScalar(this.ringSize(p)); }
  }

  private personAnchor?: { x: number; z: number };
  private ringY(p: Pick) { return p.kind === 'plant' ? this.plantBase(this.bedOfPath(p.key) ?? '') + 0.15 : 0.33; }
  private ringSize(p: Pick) {
    if (p.kind === 'plant') return Math.max(0.6, (this.layout.plants.find((x) => x.path === p.key)?.size ?? 1) * 0.65);
    if (p.kind === 'bed') { const b = this.layout.beds.find((x) => x.name === p.key); return b ? Math.max(b.w, b.d) * 0.6 : 2; }
    if (p.kind === 'pond') return this.pond.spot.r * 1.15;
    if (p.kind === 'garden') return 2.4;
    return 0.8;
  }

  /** Where a pick is in the world (for rings and the camera). */
  pickPos(p: Pick): THREE.Vector3 | undefined {
    switch (p.kind) {
      case 'plant': return this.plantXZ.get(p.key);
      case 'bed': return this.bedCenter(p.key);
      case 'member': return this.actors.gardenerPos(p.key) ?? this.actors.botPosOf(p.key); // offline: their sleeping bot
      case 'botanist': return this.actors.botanistPos();
      case 'task': return this.tasks.posOf(p.key);
      case 'pond': { const s = this.pond.spot; return new THREE.Vector3(s.x, 0, s.z); }
      case 'commit': { const c = this.pond.padSpots().find((x) => x.id === p.key); return c ? new THREE.Vector3(c.x, 0, c.z) : undefined; }
      case 'garden': return this.boundary.archPos();
      case 'shed': return undefined;
    }
  }

  /** The shed inspector opened/closed something: ring it, glide the camera there, give a plant a little wiggle. */
  setSelected(p: Pick | null) {
    const changed = !samePick(p, this.selected) && !(p === null && this.selected === null);
    this.selected = p;
    if (!p || !changed) return;
    const at = this.pickPos(p);
    if (!at) return;
    this.follow = null; this.director = false;
    if (p.kind !== 'garden') this.rig.flyTo(at);
    if (p.kind === 'plant' && !this.calm && !this.reducedMotion) this.wobblePlant(p.key, 0.7);
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

  focusOnMember(handle: string | null) { this.follow = handle; this.followZoom = !!handle; if (handle) this.director = false; }
  /** Human words for what the camera follows, e.g. "manahil's helper". */
  get followLabel(): string | null {
    if (!this.follow?.startsWith('agent:')) return this.follow;
    const a = this.snap?.agents.find((x) => x.sessionId === this.follow!.slice(6));
    return a ? `${a.handle}'s ${a.kind === 'subagent' ? 'helper' : 'bot'}` : 'an agent';
  }
  /** Everything that should be on screen: beds, the gardeners' row in front, the botanist at the right. */
  private fitBox() {
    const bs = this.layout.beds;
    const { halfW, frontZ } = this.homeFrame;
    let minX = -halfW, maxX = Math.max(halfW + 3.5, this.pond.extentX), minZ = -4, maxZ = frontZ + 1.4;
    minZ = Math.min(minZ, -Math.max(4, this.layout.depth / 2) - 8); // the shed behind the beds
    for (const b of bs) { minX = Math.min(minX, b.x - b.w / 2); maxX = Math.max(maxX, b.x + b.w / 2); minZ = Math.min(minZ, b.z - b.d / 2); }
    if (this.gardenRect) maxZ = Math.max(maxZ, this.gardenRect.maxZ + 0.5); // the arch with the repo name is part of the picture
    return { minX: minX - 1, maxX: maxX + 1, minZ: minZ - 1, maxZ };
  }
  reservedForShed() { return this.reservedPx(); }
  /** Space the shed takes: a column on the right on wide screens, a bottom sheet on narrow ones. */
  private reservedPx(): number {
    const shed = document.getElementById('shed');
    const strip = document.body.classList.contains('hide-ui') ? 0 : 52; // room for the status chip, so the gardeners' row is never under it
    if (!shed || shed.offsetWidth === 0 || getComputedStyle(shed).display === 'none') { this.reservedBottom = strip; return 0; }
    if (shed.classList.contains('collapsed')) { this.reservedBottom = strip; return 0; } // just a small pill
    if (innerWidth < 900) { this.reservedBottom = shed.offsetHeight + 12 + strip; return 0; }
    this.reservedBottom = strip;
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
    fog.near = Math.max(40, dist * 1.1); fog.far = Math.max(110, dist * 2.6); // fades the meadow's rim into the sky
    const far = Math.max(400, dist * 5);
    if (this.camera.far !== far) { this.camera.far = far; this.camera.updateProjectionMatrix(); }
  }
  /** Reframe (F): clears manual moves and fits everything. */
  frameGarden(instant = false) { this.refit(instant); }

  private resize() {
    const w = this.host.clientWidth || innerWidth, h = this.host.clientHeight || innerHeight;
    if (this.available) { this.renderer.setSize(w, h); this.post?.setSize(w, h); }
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
    if (this.quality !== 'low') { // soft contact blobs under everyone who stands on the ground, and the task pots
      this.contact.begin();
      this.actors.forEachBody((x, z, r) => this.contact.add(x, z, r));
      this.tasks.forEachPos((x, z) => this.contact.add(x, z, 0.5));
      this.contact.end();
    }
    SWAY.uTime.value = this.time; SWAY.uSway.value = this.calm || this.reducedMotion ? 0 : 1;
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
    this.actors.viewDist = this.camera.position.distanceTo(this.controls.target);
    this.field.update(t, mo);
    this.pond.update(dt, mo);
    this.tasks.update(t, mo);
    this.tickFences(t, mo);
    // re-pick when the pointer moved, and every 10th frame (things move under a still pointer)
    if (this.hoverAt && (this.hoverDirty || ++this.hoverTick % 10 === 0)) { this.hoverDirty = false; const h = this.pickUnder(this.hoverAt.x, this.hoverAt.y); if (h || this.hovered) this.setHover(h, this.hoverAt.x, this.hoverAt.y); }
    const sp = this.selected ? this.pickPos(this.selected) : undefined;
    this.selRing.visible = !!sp;
    const hp = this.hovered?.kind === 'plant' ? this.hovered.key : null, slp = this.selected?.kind === 'plant' ? this.selected.key : null;
    this.field.setHighlight(this.hedgeOf.get(hp ?? slp ?? '') ?? hp ?? slp, hp ? 0.35 : 0.5);
    if (sp) { this.selRing.position.set(sp.x, this.ringY(this.selected!) + 0.01, sp.z); this.selRing.scale.setScalar(this.ringSize(this.selected!) * (1 + Math.sin(t * 3) * 0.05 * mo)); }
    this.props.update(t, dt, 0, 0, mo);
    // Camera: follow a member, or director mode follows the latest action.
    let focus: THREE.Vector3 | undefined;
    if (shot) focus = undefined; // the cinematic shot owns the camera
    else if (this.follow) {
      focus = this.follow.startsWith('agent:') ? this.actors.agentPos(this.follow.slice(6)) : this.actors.gardenerPos(this.follow);
      if (!focus && this.follow.startsWith('agent:')) { this.follow = null; this.followZoom = false; this.onFollowEnd(); } // the agent finished
    }
    else if (this.director) focus = this.actors.focus;
    if (focus) {
      const d = this.tmpV.copy(focus).sub(this.controls.target).multiplyScalar(Math.min(1, dt * 1.6));
      this.controls.target.add(d); this.camera.position.add(d);
      if (this.follow && this.followZoom) { // glide in to a close view of who we follow
        const off = this.tmpV.subVectors(this.camera.position, this.controls.target), len = off.length(), want = 8;
        if (Math.abs(len - want) > 0.05) this.camera.position.copy(this.controls.target).add(off.multiplyScalar((len + (want - len) * Math.min(1, dt * 2)) / len));
        else this.followZoom = false;
      }
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
    if (render && this.available) { if (this.post) { this.post.setAO(this.camera.position.distanceTo(this.controls.target) < AO_MAX_DIST); this.post.render(); } else this.renderer.render(this.scene, this.camera); }
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
  }
}
