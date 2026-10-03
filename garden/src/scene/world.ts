import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GardenSnapshot, PlantStage } from '../../../shared/types.ts';
import { layoutGarden, type GardenLayout } from '../layout.ts';
import type { Store, StoreUpdate } from '../data/store.ts';
import { Actors, type WorldLookup } from './actors.ts';
import { Labels, Particles } from './effects.ts';
import { flowerColor, geo, mat, mesh } from './materials.ts';
import { buildPlant } from './plantMesh.ts';
import { CameraRig } from './camera.ts';

interface PlantNode { group: THREE.Group; holder: THREE.Group; stage: PlantStage; size: number; bugs: number; bugGroup: THREE.Group; born: number; phase: number; x: number; z: number; path: string; openAt?: number; wobbleUntil?: number }

// Hour-of-day sky: night is kept readable for the projector.
const SKY: Array<[number, string]> = [[0, '#26335c'], [5, '#e8a07e'], [8, '#bfe3f5'], [16, '#cfe6ee'], [18.5, '#f6b073'], [20.5, '#3a3f74'], [24, '#26335c']];
function skyAt(hour: number): THREE.Color {
  for (let i = 1; i < SKY.length; i++) {
    const [h1, c1] = SKY[i]!, [h0, c0] = SKY[i - 1]!;
    if (hour <= h1) return new THREE.Color(c0).lerp(new THREE.Color(c1), (hour - h0) / (h1 - h0));
  }
  return new THREE.Color(SKY[0]![1]);
}

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
  private ground = new THREE.Group();
  private bedGroup = new THREE.Group();
  private fenceGroup = new THREE.Group();
  private nodes = new Map<string, PlantNode>();
  private layout: GardenLayout = { beds: [], plants: [], width: 0, depth: 0 };
  private layoutKey = '';
  private layoutFirst = true;
  private fenceKey = '';
  private snap!: GardenSnapshot;
  private plantXZ = new Map<string, THREE.Vector3>();
  private bedLabels: HTMLElement[] = [];
  /** Blooms held back until the botanist reaches the plant (path -> deadline in performance.now ms). */
  private pendingBloom = new Map<string, number>();
  // A cheap "spotlight": a soft additive light shaft (a real SpotLight costs per-pixel lighting on every material).
  private shaft = new THREE.Mesh(new THREE.ConeGeometry(1.7, 7, 28, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  private spotRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false }));
  private lockMesh = new THREE.Group();
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

  constructor(private host: HTMLElement, store: Store) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    const labelHost = document.createElement('div'); labelHost.className = 'labels'; host.appendChild(labelHost);
    this.labels = new Labels(labelHost, this.camera);
    this.fx = new Particles(this.scene);
    this.actors = new Actors(this.scene, this, this.labels, this.fx);
    this.actors.motion = this.reducedMotion ? 0.25 : 1;
    this.fx.reducedMotion = this.reducedMotion;

    this.scene.fog = new THREE.Fog('#cfe6ee', 40, 120);
    this.scene.add(this.hemi, this.sun, this.ground, this.bedGroup, this.fenceGroup);
    this.shaft.position.y = 3.6; this.scene.add(this.shaft);
    this.spotRing.rotation.x = -Math.PI / 2; this.spotRing.position.y = 0.32; this.scene.add(this.spotRing);
    this.lockMesh.add(mesh(geo.box, mat('#c9a227'), 0.28, 0.22, 0.12, 0, 0, 0));
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12, Math.PI), mat('#8d8d8d')); shackle.position.y = 0.11;
    this.lockMesh.add(shackle); this.lockMesh.scale.setScalar(0.6); this.lockMesh.visible = false; this.scene.add(this.lockMesh);
    this.sun.position.set(18, 26, 12); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -35; sc.right = sc.top = 35; sc.far = 90;
    const disc = mesh(new THREE.CylinderGeometry(1, 1, 1, 48), mat('#8fc268'), 60, 0.2, 60, 0, -0.12, 0);
    disc.castShadow = false; disc.receiveShadow = true;
    this.ground.add(disc);

    this.camera.position.set(0, 18, 22);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.48; this.controls.maxDistance = 90;
    this.rig = new CameraRig(this.camera, this.controls, host);
    this.resize(); addEventListener('resize', () => this.resize());

    store.subscribe((u) => this.onUpdate(u));
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- WorldLookup ----
  plantPos(path: string) { return this.plantXZ.get(path); }
  bedCenter(bed: string) { const b = this.layout.beds.find((x) => x.name === bed); return b ? new THREE.Vector3(b.x, 0, b.z) : undefined; }
  bedOfPath(path: string) { return this.layout.plants.find((p) => p.path === path)?.bed; }
  fenceGate(path: string) {
    const claim = this.snap?.claims.find((c) => c.path === path || (c.path.endsWith('/') && path.startsWith(c.path)));
    const r = claim && this.fenceRect(claim.path);
    return r ? new THREE.Vector3((r.minX + r.maxX) / 2, 0, r.maxZ) : undefined;
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
    for (const a of u.newActivity) this.actors.onActivity(a);
    const d = new Date(u.snapshot.at || Date.now());
    const hour = d.getHours() + d.getMinutes() / 60;
    const c = skyAt(hour);
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
        const soil = mesh(geo.box, mat('#7a5a3a'), b.w, 0.3, b.d, b.x, 0.05, b.z); soil.castShadow = false; soil.receiveShadow = true;
        const top = mesh(geo.box, mat('#5b4129'), b.w - 0.5, 0.05, b.d - 0.5, b.x, 0.22, b.z); top.castShadow = false; top.receiveShadow = true;
        this.bedGroup.add(soil, top);
        if (b.greenhouse) {
          const glass = mesh(geo.box, mat('#bfe8f5', { opacity: 0.22 }), b.w, 2.4, b.d, b.x, 1.3, b.z); glass.castShadow = false;
          this.bedGroup.add(glass);
        }
        this.bedLabels.push(this.labels.add(b.greenhouse ? `${b.name} (greenhouse)` : b.name, () => new THREE.Vector3(b.x, 0.35, b.z + b.d / 2 + 0.2), 'label bed'));
      }
      this.fenceKey = '';
      if (!this.rig.userMoved) this.refit(this.layoutFirst);
      this.layoutFirst = false;
    }
    this.onLayout(this.layout);
  }

  private syncPlants(reset: boolean) {
    const now = this.time;
    const want = new Set(this.layout.plants.map((p) => p.path));
    for (const [path, n] of this.nodes) if (!want.has(path)) { this.scene.remove(n.group); this.nodes.delete(path); }
    const byPath = new Map(this.snap.plants.map((p) => [p.path, p]));
    for (const lp of this.layout.plants) {
      const pv = byPath.get(lp.path)!;
      let n = this.nodes.get(lp.path);
      let stage = pv.stage;
      const hold = this.pendingBloom.get(lp.path);
      if (stage === 'bloom' && hold !== undefined) { if (performance.now() < hold) stage = 'bud'; else this.pendingBloom.delete(lp.path); }
      if (!n || n.stage !== stage || Math.abs(n.size - lp.size) > 0.05) {
        const wasStage = n?.stage;
        if (n) n.holder.clear(); else {
          const group = new THREE.Group(), holder = new THREE.Group(), bugGroup = new THREE.Group();
          group.add(holder, bugGroup); this.scene.add(group);
          n = { group, holder, stage, size: lp.size, bugs: 0, bugGroup, born: now, phase: Math.random() * 6, x: lp.x, z: lp.z, path: lp.path };
          this.nodes.set(lp.path, n);
        }
        n.holder.add(buildPlant(stage, lp.path, lp.size));
        n.stage = stage; n.size = lp.size; n.born = reset || (wasStage === 'bud' && stage === 'bloom') ? now - 5 : now;
        if (stage === 'bloom' && wasStage === 'bud') n.openAt = now; // petals open one by one
        if (stage === 'bloom' && wasStage && wasStage !== 'bloom') {
          this.fx.burst(new THREE.Vector3(lp.x, 1, lp.z), flowerColor(lp.path).getHex(), 50, 2.6, 3);
        }
      }
      n.x = lp.x; n.z = lp.z; n.group.position.set(lp.x, 0.2, lp.z);
      if (n.bugs !== pv.bugs) {
        if (pv.bugs < n.bugs && n.bugs > 0) this.fx.burst(new THREE.Vector3(lp.x, 0.8, lp.z), 0x222222, 12, 1.2, 4);
        n.bugGroup.clear();
        for (let i = 0; i < pv.bugs; i++) n.bugGroup.add(mesh(geo.sphere, mat('#1c1c1c'), 0.06, 0.05, 0.08));
        n.bugs = pv.bugs;
      }
    }
  }

  // ---- botanist hooks (WorldLookup) ----
  /** The botanist arrived: let the held-back bloom open now. */
  releaseBloom(path: string) {
    if (!this.pendingBloom.delete(path)) return;
    if (this.snap) this.syncPlants(false);
  }
  wobblePlant(path: string, seconds: number) { const n = this.nodes.get(path); if (n) n.wobbleUntil = this.time + seconds; }
  showLock(path: string | null) {
    const n = path ? this.nodes.get(path) : undefined;
    this.lockMesh.visible = !!n;
    if (n) this.lockMesh.position.set(n.x + 0.45, 1.35 * n.size + 0.2, n.z);
  }

  private syncFences() {
    const color = (h: string) => this.snap.members.find((m) => m.handle === h)?.color ?? '#888';
    const key = JSON.stringify(this.snap.claims.map((c) => [c.id, c.path, c.handle])) + this.layoutKey + this.snap.plants.length;
    if (key === this.fenceKey) return;
    this.fenceKey = key; this.fenceGroup.clear();
    for (const c of this.snap.claims) {
      const r = this.fenceRect(c.path); if (!r) continue;
      const m = mat(color(c.handle), { emissive: 0x111111 });
      const side = (x0: number, z0: number, x1: number, z1: number) => {
        const len = Math.hypot(x1 - x0, z1 - z0), posts = Math.max(2, Math.round(len / 1.1) + 1);
        for (let i = 0; i < posts; i++) {
          const t = i / (posts - 1);
          this.fenceGroup.add(mesh(geo.box, m, 0.08, 0.6, 0.08, x0 + (x1 - x0) * t, 0.5, z0 + (z1 - z0) * t));
        }
        const rail = mesh(geo.box, m, 0.05, 0.05, len, (x0 + x1) / 2, 0.62, (z0 + z1) / 2);
        rail.rotation.y = Math.atan2(x1 - x0, z1 - z0); // box length runs along +z
        this.fenceGroup.add(rail);
      };
      side(r.minX, r.minZ, r.maxX, r.minZ); side(r.maxX, r.minZ, r.maxX, r.maxZ);
      side(r.maxX, r.maxZ, r.minX, r.maxZ); side(r.minX, r.maxZ, r.minX, r.minZ);
    }
  }

  focusOnMember(handle: string | null) { this.follow = handle; if (handle) this.director = false; }
  /** Everything that should be on screen: beds, the gardeners' row in front, the botanist at the right. */
  private fitBox() {
    const bs = this.layout.beds;
    const { halfW, frontZ } = this.homeFrame;
    let minX = -halfW, maxX = halfW + 3.5, minZ = -4, maxZ = frontZ + 1.4;
    for (const b of bs) { minX = Math.min(minX, b.x - b.w / 2); maxX = Math.max(maxX, b.x + b.w / 2); minZ = Math.min(minZ, b.z - b.d / 2); }
    return { minX: minX - 1, maxX: maxX + 1, minZ: minZ - 1, maxZ };
  }
  reservedForShed() { return this.reservedPx(); }
  private reservedPx() {
    const shed = document.getElementById('shed');
    return shed && shed.offsetWidth > 0 && getComputedStyle(shed).display !== 'none' ? shed.offsetWidth + 24 : 0;
  }
  refit(instant = false) {
    this.rig.setReserved(this.reservedPx());
    this.rig.fit(this.fitBox(), undefined, instant);
  }
  /** Reframe (F): clears manual moves and fits everything. */
  frameGarden(instant = false) { this.refit(instant); }

  private resize() {
    const w = this.host.clientWidth || innerWidth, h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.rig.setReserved(this.reservedPx());
    if (!this.rig.userMoved) this.rig.fit(this.fitBox(), undefined, true);
  }

  /** Run the simulation for `seconds` of scene time in 1/30 s steps, rendering only the last frame. Debug/test use. */
  advance(seconds: number) {
    const steps = Math.max(1, Math.round(seconds * 30));
    for (let i = 0; i < steps; i++) this.frame(1 / 30, i === steps - 1);
  }

  private frame(dtOverride?: number, render = true) {
    const dt = dtOverride ?? Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    const t = this.time, mo = this.reducedMotion ? 0.25 : 1;
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
      if (!this.rig.userMoved) this.rig.pushIn(shot.point, 6.6);
    } else if (this.rig.cinema) this.rig.release();
    for (const n of this.nodes.values()) {
      const age = Math.min(1, (t - n.born) / 0.7), pop = 0.15 + 0.85 * (1 - Math.pow(1 - age, 3));
      n.holder.scale.setScalar(pop);
      n.group.rotation.z = Math.sin(t * 1.3 + n.phase) * 0.035 * mo;
      n.holder.rotation.x = n.bugs * 0.07;
      n.holder.rotation.z = n.wobbleUntil && n.wobbleUntil > t ? Math.sin(t * 22) * 0.1 * Math.min(1, n.wobbleUntil - t) * mo : 0;
      if (n.openAt !== undefined) {
        const g = n.holder.children[n.holder.children.length - 1] as THREE.Object3D | undefined;
        const petals = g?.userData.petals as THREE.Object3D[] | undefined;
        const el = t - n.openAt;
        if (petals) {
          petals.forEach((pt, i) => {
            const k = Math.min(1, Math.max(0, (el - i * 0.09) / 0.55)), e = 1 - Math.pow(1 - k, 3);
            pt.scale.copy(pt.userData.base as THREE.Vector3).multiplyScalar(e);
          });
          const c = g?.userData.center as THREE.Object3D | undefined;
          if (c) c.scale.copy(c.userData.base as THREE.Vector3).multiplyScalar(Math.min(1, Math.max(0, el / 0.4)));
        }
        if (el > 1.6) n.openAt = undefined;
      }
      n.bugGroup.children.forEach((b, i) => {
        const a = t * 1.5 + i * 2.1 + n.phase; b.position.set(Math.cos(a) * 0.3 * n.size, 0.3 * n.size + (i % 3) * 0.2 * n.size, Math.sin(a) * 0.3 * n.size);
      });
    }
    // Camera: follow a member, or director mode follows the latest action.
    let focus: THREE.Vector3 | undefined;
    if (shot) focus = undefined; // the cinematic shot owns the camera
    else if (this.follow) focus = this.actors.gardenerPos(this.follow);
    else if (this.director) focus = this.actors.focus;
    if (focus) {
      const d = focus.clone().sub(this.controls.target).multiplyScalar(Math.min(1, dt * 1.6));
      this.controls.target.add(d); this.camera.position.add(d);
    }
    this.rig.update(dt);
    this.controls.update();
    this.labels.update(this.host.clientWidth, this.host.clientHeight);
    if (render) this.renderer.render(this.scene, this.camera);
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
  }
}
