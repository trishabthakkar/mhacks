import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GardenSnapshot, PlantStage } from '../../../shared/types.ts';
import { layoutGarden, type GardenLayout } from '../layout.ts';
import type { Store, StoreUpdate } from '../data/store.ts';
import { Actors, type WorldLookup } from './actors.ts';
import { Labels, Particles } from './effects.ts';
import { flowerColor, geo, mat, mesh } from './materials.ts';
import { buildPlant } from './plantMesh.ts';

interface PlantNode { group: THREE.Group; holder: THREE.Group; stage: PlantStage; size: number; bugs: number; bugGroup: THREE.Group; born: number; phase: number; x: number; z: number; path: string }

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
  private fenceKey = '';
  private snap!: GardenSnapshot;
  private plantXZ = new Map<string, THREE.Vector3>();
  private clock = new THREE.Clock();
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
    this.sun.position.set(18, 26, 12); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -35; sc.right = sc.top = 35; sc.far = 90;
    const disc = mesh(new THREE.CylinderGeometry(1, 1, 1, 48), mat('#8fc268'), 60, 0.2, 60, 0, -0.12, 0);
    disc.castShadow = false; disc.receiveShadow = true;
    this.ground.add(disc);

    this.camera.position.set(0, 18, 22);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.48; this.controls.maxDistance = 90;
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
    this.hemi.intensity = night ? 0.9 : 1.1; this.sun.intensity = night ? 0.8 : hour > 17.5 ? 1.8 : 2.2;
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
      for (const b of this.layout.beds) {
        const soil = mesh(geo.box, mat('#7a5a3a'), b.w, 0.3, b.d, b.x, 0.05, b.z); soil.castShadow = false; soil.receiveShadow = true;
        const top = mesh(geo.box, mat('#5b4129'), b.w - 0.5, 0.05, b.d - 0.5, b.x, 0.22, b.z); top.castShadow = false; top.receiveShadow = true;
        this.bedGroup.add(soil, top);
        if (b.greenhouse) {
          const glass = mesh(geo.box, mat('#bfe8f5', { opacity: 0.22 }), b.w, 2.4, b.d, b.x, 1.3, b.z); glass.castShadow = false;
          this.bedGroup.add(glass);
        }
        this.labels.add(b.greenhouse ? `${b.name} (greenhouse)` : b.name, () => new THREE.Vector3(b.x, 0.35, b.z + b.d / 2 + 0.2), 'label bed');
      }
      this.fenceKey = '';
    }
    this.onLayout(this.layout);
  }

  private syncPlants(reset: boolean) {
    const now = this.clock.elapsedTime;
    const want = new Set(this.layout.plants.map((p) => p.path));
    for (const [path, n] of this.nodes) if (!want.has(path)) { this.scene.remove(n.group); this.nodes.delete(path); }
    const byPath = new Map(this.snap.plants.map((p) => [p.path, p]));
    for (const lp of this.layout.plants) {
      const pv = byPath.get(lp.path)!;
      let n = this.nodes.get(lp.path);
      const stage = pv.stage;
      if (!n || n.stage !== stage || Math.abs(n.size - lp.size) > 0.05) {
        const wasStage = n?.stage;
        if (n) n.holder.clear(); else {
          const group = new THREE.Group(), holder = new THREE.Group(), bugGroup = new THREE.Group();
          group.add(holder, bugGroup); this.scene.add(group);
          n = { group, holder, stage, size: lp.size, bugs: 0, bugGroup, born: now, phase: Math.random() * 6, x: lp.x, z: lp.z, path: lp.path };
          this.nodes.set(lp.path, n);
        }
        n.holder.add(buildPlant(stage, lp.path, lp.size));
        n.stage = stage; n.size = lp.size; n.born = reset ? now - 5 : now;
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
  frameGarden() {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, this.extent * 1.4 + 8, this.extent * 1.7 + 12);
  }

  private resize() {
    const w = this.host.clientWidth || innerWidth, h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1), t = this.clock.elapsedTime, mo = this.reducedMotion ? 0.25 : 1;
    this.actors.tick(dt); this.fx.update(dt);
    for (const n of this.nodes.values()) {
      const age = Math.min(1, (t - n.born) / 0.7), pop = 0.15 + 0.85 * (1 - Math.pow(1 - age, 3));
      n.holder.scale.setScalar(pop);
      n.group.rotation.z = Math.sin(t * 1.3 + n.phase) * 0.035 * mo;
      n.holder.rotation.x = n.bugs * 0.07;
      n.bugGroup.children.forEach((b, i) => {
        const a = t * 1.5 + i * 2.1 + n.phase; b.position.set(Math.cos(a) * 0.3 * n.size, 0.3 * n.size + (i % 3) * 0.2 * n.size, Math.sin(a) * 0.3 * n.size);
      });
    }
    // Camera: follow a member, or director mode follows the latest action.
    let focus: THREE.Vector3 | undefined;
    if (this.follow) focus = this.actors.gardenerPos(this.follow);
    else if (this.director) focus = this.actors.focus;
    if (focus) {
      const d = focus.clone().sub(this.controls.target).multiplyScalar(Math.min(1, dt * 1.6));
      this.controls.target.add(d); this.camera.position.add(d);
    }
    this.controls.update();
    this.labels.update(this.host.clientWidth, this.host.clientHeight);
    this.renderer.render(this.scene, this.camera);
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
  }
}
