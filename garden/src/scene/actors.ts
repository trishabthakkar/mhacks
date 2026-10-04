import * as THREE from 'three';
import type { Pick } from '../pick.ts';
import type { ActivityView, AgentView, GardenSnapshot, MessageView } from '../../../shared/types.ts';
import { geo, hashString, mat, mesh } from './materials.ts';
import { idleSpot, tendSpot } from './wander.ts';
import { CharacterKit, type Character } from './characters.ts';
import { BOTANIST_MODEL, characterFor } from './characterPick.ts';

const CHAR_SCALE = 2.3; // Kenney characters are ~0.6 units tall; our people are ~1.3
import type { Labels, Particles } from './effects.ts';
import type { Nav, Pt } from '../nav.ts';
import { currentTaskOf } from '../tasks.ts';
import { spiritText } from './spiritText.ts';

export interface WorldLookup {
  plantPos(path: string): THREE.Vector3 | undefined;
  taskPlantPos(handle: string): THREE.Vector3 | undefined;
  bedCenter(bed: string): THREE.Vector3 | undefined;
  bedOfPath(path: string): string | undefined;
  fenceGate(path: string): THREE.Vector3 | undefined;
  extent: number;
  homeFrame: { halfW: number; frontZ: number };
  nav: Nav;
  releaseBloom(path: string): void;
  wobblePlant(path: string, seconds: number): void;
  showLock(path: string | null): void;
}

class Mover {
  obj = new THREE.Group();
  target = new THREE.Vector3();
  moving = false;
  /** When set, walking follows paths around the beds instead of straight lines. */
  nav?: Nav;
  private navUsed?: Nav;
  private goal = new THREE.Vector3(1e9, 0, 1e9);
  private wp: Pt[] = [];
  constructor(public speed = 3) {}
  step(dt: number, lerpY = false) {
    const p = this.obj.position;
    if (this.nav) {
      // Re-plan only when the destination (or the garden layout) changed.
      if (this.nav !== this.navUsed || this.goal.distanceToSquared(this.target) > 0.36) {
        this.goal.copy(this.target); this.navUsed = this.nav;
        this.wp = this.nav.path(p.x, p.z, this.target.x, this.target.z);
      }
      while (this.wp.length > 1 && Math.hypot(this.wp[0]!.x - p.x, this.wp[0]!.z - p.z) < 0.3) this.wp.shift();
    }
    const w = this.nav && this.wp.length ? this.wp[0]! : null;
    const dx = (w ? w.x : this.target.x) - p.x, dz = (w ? w.z : this.target.z) - p.z, d = Math.hypot(dx, dz);
    this.moving = d > 0.06;
    if (this.moving) {
      const s = Math.min(d, this.speed * dt);
      p.x += (dx / d) * s; p.z += (dz / d) * s;
      this.obj.rotation.y = Math.atan2(dx, dz);
    }
    if (lerpY) p.y += (this.target.y - p.y) * Math.min(1, dt * 4);
  }
}

const SKIN = '#e8b98f';
// Geometry that never changes is created once: gardeners and tools appear and disappear all weekend.
const RING_OUT = new THREE.RingGeometry(0.34, 0.46, 24), RING_IN = new THREE.RingGeometry(0.2, 0.34, 24);
const GLASS_TORUS = new THREE.TorusGeometry(0.07, 0.015, 6, 14);
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x1d1d1d, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });

interface GardenerRig { armL: THREE.Object3D; armR: THREE.Object3D; legL: THREE.Object3D; legR: THREE.Object3D; tools: Record<string, THREE.Object3D>; tool: string }
function makeCan(): THREE.Group {
  const can = new THREE.Group(); // watering can
  can.add(mesh(geo.box, mat('#4a90c2'), 0.2, 0.16, 0.14, 0, 0, 0), mesh(geo.cyl, mat('#4a90c2'), 0.02, 0.2, 0.02, 0.16, 0.06, 0));
  (can.children[1] as THREE.Object3D).rotation.z = -0.9; can.add(mesh(geo.box, mat('#2f6a94'), 0.03, 0.14, 0.03, -0.08, 0.1, 0));
  return can;
}
function makeTools(): Record<string, THREE.Object3D> {
  const can = makeCan();
  const glass = new THREE.Group(); // magnifier
  const ring = new THREE.Mesh(GLASS_TORUS, mat('#8d6e4c')); ring.position.y = 0.13;
  glass.add(ring, mesh(geo.cyl, mat('#8d6e4c'), 0.015, 0.12, 0.015, 0, 0.03, 0), mesh(geo.sphere, mat('#bfe8f5', { opacity: 0.5 }), 0.065, 0.065, 0.01, 0, 0.13, 0));
  const clip = new THREE.Group(); // clipboard
  clip.add(mesh(geo.box, mat('#8d6e4c'), 0.2, 0.26, 0.02, 0, 0.05, 0), mesh(geo.box, mat('#fffdf2'), 0.17, 0.22, 0.025, 0, 0.05, 0.005), mesh(geo.box, mat('#9aa0a6'), 0.07, 0.03, 0.03, 0, 0.17, 0.01));
  const hammer = new THREE.Group(); // hammer
  hammer.add(mesh(geo.cyl, mat('#8d6e4c'), 0.02, 0.26, 0.02, 0, 0.05, 0), mesh(geo.box, mat('#6b7078'), 0.14, 0.06, 0.06, 0, 0.19, 0));
  const all: Record<string, THREE.Object3D> = { can, glass, clip, hammer };
  for (const t of Object.values(all)) t.visible = false;
  return all;
}

const limb = (color: string, len: number, r: number) => {
  const g = new THREE.Group();
  g.add(mesh(geo.cyl, mat(color), r, len, r, 0, -len / 2, 0));
  return g;
};

function makeGardener(color: string): Mover & { rig: GardenerRig } {
  const m = new Mover(3.2) as Mover & { rig: GardenerRig };
  // Feet ring in the member colour with a dark outline: stays readable on any ground.
  const outline = new THREE.Mesh(RING_OUT, OUTLINE_MAT);
  const ringM = new THREE.Mesh(RING_IN, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  ringM.name = 'ring-colour';
  outline.rotation.x = ringM.rotation.x = -Math.PI / 2; outline.position.y = 0.025; ringM.position.y = 0.03;
  m.obj.add(outline, ringM);
  const proc = new THREE.Group(); proc.name = 'proc'; m.obj.add(proc); // the simple figure, hidden once the animated model loads
  proc.add(mesh(geo.cyl, mat(color), 0.22, 0.5, 0.22, 0, 0.55, 0));
  proc.add(mesh(geo.sphere, mat(SKIN), 0.17, 0.17, 0.17, 0, 0.98, 0));
  proc.add(mesh(geo.cyl, mat('#e9c46a'), 0.3, 0.03, 0.3, 0, 1.11, 0));
  proc.add(mesh(geo.cone, mat('#e9c46a'), 0.16, 0.18, 0.16, 0, 1.21, 0));
  const legL = limb('#4b4f5c', 0.3, 0.07), legR = limb('#4b4f5c', 0.3, 0.07);
  legL.position.set(-0.1, 0.32, 0); legR.position.set(0.1, 0.32, 0);
  const armL = limb(color, 0.4, 0.055), armR = limb(color, 0.4, 0.055);
  armL.position.set(-0.27, 0.78, 0); armR.position.set(0.27, 0.78, 0);
  armL.add(mesh(geo.sphere, mat(SKIN), 0.06, 0.06, 0.06, 0, -0.42, 0)); armR.add(mesh(geo.sphere, mat(SKIN), 0.06, 0.06, 0.06, 0, -0.42, 0));
  const tools = makeTools();
  for (const t of Object.values(tools)) { t.position.set(0, -0.44, 0.08); armR.add(t); }
  proc.add(legL, legR, armL, armR);
  m.rig = { armL, armR, legL, legR, tools, tool: '' };
  return m;
}

// Little status icons floating over a bot (shared canvas textures).
const iconCache = new Map<string, THREE.SpriteMaterial>();
export function iconMat(glyph: string): THREE.SpriteMaterial {
  let m = iconCache.get(glyph);
  if (!m) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.font = '44px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(glyph, 32, 36);
    m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
    iconCache.set(glyph, m);
  }
  return m;
}
const ICON: Record<string, string> = { idle: '💤', working: '⚙️', blocked: '✋', dormant: '', needs_review: '👀', waiting: '' };

interface BotRig { wheelL: THREE.Object3D; wheelR: THREE.Object3D; tip: THREE.Mesh; icon: THREE.Sprite; iconFor: string }
function makeBot(color: string): { m: Mover; alert: THREE.Object3D; body: THREE.Object3D; rig: BotRig } {
  const m = new Mover(3.6);
  const body = mesh(geo.box, mat('#cfd6dc'), 0.34, 0.3, 0.34, 0, 0.32, 0);
  m.obj.add(body);
  m.obj.add(mesh(geo.box, mat(color), 0.36, 0.06, 0.36, 0, 0.4, 0));
  m.obj.add(mesh(geo.sphere, mat('#e6ecef'), 0.13, 0.13, 0.13, 0, 0.62, 0));
  m.obj.add(mesh(geo.sphere, mat('#222', {}), 0.03, 0.03, 0.03, 0.05, 0.64, 0.11));
  m.obj.add(mesh(geo.sphere, mat('#222', {}), 0.03, 0.03, 0.03, -0.05, 0.64, 0.11));
  m.obj.add(mesh(geo.cyl, mat('#888'), 0.012, 0.18, 0.012, 0, 0.8, 0));
  const tip = new THREE.Mesh(geo.sphere, new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0xff2a2a, emissiveIntensity: 0.2 }));
  tip.scale.setScalar(0.035); tip.position.y = 0.9; m.obj.add(tip);
  const wheelL = mesh(geo.cyl, mat('#3a3d44'), 0.07, 0.05, 0.07, -0.2, 0.09, 0), wheelR = mesh(geo.cyl, mat('#3a3d44'), 0.07, 0.05, 0.07, 0.2, 0.09, 0);
  for (const w of [wheelL, wheelR]) w.add(mesh(geo.box, mat('#c9cdd3'), 1.6, 1.3, 0.22, 0, 0, 0));
  wheelL.rotation.z = wheelR.rotation.z = Math.PI / 2; m.obj.add(wheelL, wheelR);
  const icon = new THREE.Sprite(iconMat('💤')); icon.scale.setScalar(0.42); icon.position.y = 1.2; icon.visible = false; m.obj.add(icon);
  const alert = new THREE.Group();
  alert.add(mesh(geo.box, mat('#ffd23f', { emissive: 0x553d00 }), 0.05, 0.16, 0.05, 0, 1.05, 0));
  alert.add(mesh(geo.box, mat('#ffd23f', { emissive: 0x553d00 }), 0.05, 0.05, 0.05, 0, 0.9, 0));
  alert.visible = false;
  m.obj.add(alert);
  return { m, alert, body, rig: { wheelL, wheelR, tip, icon, iconFor: '' } };
}
function makeSpirit(color: string): Mover {
  const m = new Mover(4.5);
  const body = mesh(geo.sphere, mat('#fffaf0', { emissive: new THREE.Color(color).multiplyScalar(0.35).getHex() }), 0.2, 0.22, 0.2, 0, 0.2, 0);
  m.obj.add(body);
  for (const sx of [-1, 1]) m.obj.add(mesh(geo.sphere, mat('#1c1c1c'), 0.035, 0.045, 0.02, sx * 0.06, 0.24, 0.18)); // eyes
  const hat = mesh(geo.cone, mat('#58a24a'), 0.16, 0.2, 0.16, 0, 0.46, 0); m.obj.add(hat);                       // leaf hat
  m.obj.add(mesh(geo.sphere, mat(color, { emissive: new THREE.Color(color).multiplyScalar(0.6).getHex() }), 0.06, 0.06, 0.06, 0, 0.6, 0)); // glow tip in owner colour
  return m;
}
function makeButterfly(color: string): Mover {
  const m = new Mover(4.5);
  const wm = mat(color, { emissive: 0x222222 });
  const l = mesh(geo.box, wm, 0.16, 0.01, 0.12, -0.09, 0, 0), r = mesh(geo.box, wm, 0.16, 0.01, 0.12, 0.09, 0, 0);
  m.obj.add(l, r);
  m.obj.add(mesh(geo.sphere, mat('#fff4b0', { emissive: 0xffd34d }), 0.05, 0.05, 0.05, 0, -0.05, 0));
  m.obj.userData.wings = [l, r];
  return m;
}
function makeBotanist(): Mover {
  const m = new Mover(2.6);
  const proc = new THREE.Group(); proc.name = 'proc'; m.obj.add(proc);
  proc.add(mesh(geo.cyl, mat('#f4f1e8'), 0.26, 0.85, 0.26, 0, 0.55, 0));
  proc.add(mesh(geo.sphere, mat(SKIN), 0.18, 0.18, 0.18, 0, 1.12, 0));
  proc.add(mesh(geo.cyl, mat('#6a4c93'), 0.24, 0.1, 0.24, 0, 1.28, 0));
  proc.add(mesh(geo.box, mat('#7ec8e3', { opacity: 0.8 }), 0.22, 0.06, 0.05, 0, 1.14, 0.16));
  proc.add(mesh(geo.box, mat('#8d6e4c'), 0.18, 0.24, 0.02, 0.28, 0.65, 0.1));
  return m;
}

function reconcile<T extends { obj: THREE.Object3D }>(
  map: Map<string, T>, keys: string[], create: (k: string) => T, scene: THREE.Scene, onRemove?: (t: T) => void,
) {
  const want = new Set(keys);
  for (const [k, v] of map) if (!want.has(k)) { scene.remove(v.obj); onRemove?.(v); map.delete(k); }
  for (const k of keys) if (!map.has(k)) { const v = create(k); map.set(k, v); scene.add(v.obj); }
}

interface BotanistJob { path: string; result: 'bloom' | 'refused'; reason: string; task: string }
type Fly = { obj: THREE.Object3D; m: Mover; msg: MessageView; seed: number };

export class Actors {
  private snap: GardenSnapshot = { at: 0, members: [], agents: [], plants: [], claims: [], messages: [], testRuns: [], certifications: [], activity: [] };
  private gardeners = new Map<string, { obj: THREE.Object3D; m: Mover; label: HTMLElement; kneel: number; rig: GardenerRig; body?: Character }>();
  private kit = new CharacterKit();
  private botanistBody?: Character;
  private bots = new Map<string, { obj: THREE.Object3D; m: Mover; alert: THREE.Object3D; body: THREE.Object3D; agent: AgentView; rig: BotRig }>();
  private bees = new Map<string, { obj: THREE.Object3D; m: Mover; seed: number; parent: string; handle: string; returning: boolean; bubble: HTMLElement; text: string; hop: number }>();
  private flies = new Map<string, Fly>();
  private meet = new Map<string, { pos: THREE.Vector3; until: number; with?: string }>();
  private botanist = makeBotanist();
  private job: { j: BotanistJob; phase: 'walk' | 'hold' | 'home'; t: number; bubble?: HTMLElement } | null = null;
  private shotPoint = new THREE.Vector3();
  /** Set while the botanist is delivering a verdict: the world dims the scene and pushes the camera in. */
  shot: { point: THREE.Vector3 } | null = null;
  private queue: BotanistJob[] = [];
  private clock = 0;
  private homes = new Map<string, THREE.Vector3>();
  private handoffs = new Map<number, { id: number; from: string; to: string; task: string; phase: 'walk' | 'pass' | 'hold' | 'accepted' | 'declined'; t: number; tag: THREE.Group; can: THREE.Object3D; chip?: HTMLElement; sprout?: THREE.Group }>();
  private sprouts: Array<{ g: THREE.Group; until: number }> = [];
  private botHome = new THREE.Vector3();
  get botanistHome() { return this.botHome; }
  private tmp = new THREE.Vector3();
  private tgt = new THREE.Vector3(); private tgt2 = new THREE.Vector3();
  private static OFF_GARDENER = new THREE.Vector3(-0.75, 0, 0.55);
  private static OFF_BOT_HOME = new THREE.Vector3(0.9, 0, 0.9);
  private static OFF_BOT_WORK = new THREE.Vector3(0.6, 0, 0.45);
  private static OFF_BOT_GATE = new THREE.Vector3(0, 0, 0.9);
  private off = new THREE.Vector3(1.3, 0, 0.9);
  private bubblePos = new THREE.Vector3();
  private bp = new THREE.Vector3();
  motion = 1;
  /** Latest place something happened, for director mode. */
  focus: THREE.Vector3 | undefined;

  constructor(private scene: THREE.Scene, private world: WorldLookup, private labels: Labels, private fx: Particles) {
    this.botHome.set(world.homeFrame.halfW + 2.5, 0, world.homeFrame.frontZ - 1);
    this.botanist.obj.position.copy(this.botHome);
    this.botanist.target.copy(this.botHome);
    scene.add(this.botanist.obj);
    void this.kit.make(BOTANIST_MODEL).then((c) => { if (c) { this.botanistBody = c; this.wear(this.botanist.obj, c); } });
    const bl = new THREE.Vector3();
    labels.add('Botanist', () => bl.copy(this.botanist.obj.position).setY(1.7), 'label botanist');
  }

  private memberColor(h: string) { return this.snap.members.find((m) => m.handle === h)?.color ?? '#888888'; }
  /** Where a member waits: a row along the front edge of the garden (toward the camera), spread left to right. */
  home(handle: string): THREE.Vector3 {
    return this.homes.get(handle) ?? this.computeHome(Math.max(0, this.snap.members.findIndex((m) => m.handle === handle)), Math.max(1, this.snap.members.length));
  }
  private computeHome(i: number, n: number): THREE.Vector3 {
    const { halfW, frontZ } = this.world.homeFrame;
    const a = Math.PI * (0.08 + 0.84 * ((i + 0.5) / n));
    return new THREE.Vector3(-Math.cos(a) * Math.max(4, halfW - 1), 0, frontZ + 0.7 * Math.sin(a));
  }
  private refreshHomes() {
    const n = Math.max(1, this.snap.members.length);
    this.homes.clear();
    this.snap.members.forEach((m, i) => this.homes.set(m.handle, this.computeHome(i, n)));
    this.botHome.set(this.world.homeFrame.halfW + 2.5, 0, this.world.homeFrame.frontZ - 1);
  }
  botanistPos(): THREE.Vector3 { return this.botanist.obj.position; }
  /** Every clickable character: gardeners by handle, then the botanist. */
  forEachPerson(cb: (pick: Pick, pos: THREE.Vector3) => void) {
    for (const [handle, g] of this.gardeners) cb({ kind: 'member', key: handle }, g.obj.position);
    cb({ kind: 'botanist' }, this.botanist.obj.position);
  }
  gardenerPos(handle: string): THREE.Vector3 | undefined { return this.gardeners.get(handle)?.obj.position; }
  /** Where a bot (main session) or spirit (subagent) is right now. */
  agentPos(sessionId: string): THREE.Vector3 | undefined { return this.bots.get(sessionId)?.obj.position ?? this.bees.get(sessionId)?.obj.position; }
  private claudeAgent(handle: string) { return this.snap.agents.find((a) => a.handle === handle && a.kind === 'claude'); }

  clearTransient() {
    this.meet.clear(); this.queue = []; this.shot = null; this.world.showLock(null);
    for (const [id, a] of [...this.handoffs]) this.endHandoff(id, a);
    if (this.job?.bubble) this.labels.remove(this.job.bubble);
    this.job = null;
  }

  sync(snap: GardenSnapshot) {
    this.snap = snap;
    this.refreshHomes();
    reconcile(this.gardeners, snap.members.filter((m) => m.online).map((m) => m.handle), (h) => {
      const m = makeGardener(this.memberColor(h));
      m.obj.position.copy(this.home(h)); m.target.copy(m.obj.position);
      m.obj.rotation.order = 'YXZ'; // so leaning in (x) is relative to where they face
      const lp = new THREE.Vector3();
      const label = this.labels.add(h, () => lp.copy(m.obj.position).setY(1.6), 'label member');
      label.style.borderColor = this.memberColor(h);
      const entry: { obj: THREE.Object3D; m: Mover; label: HTMLElement; kneel: number; rig: GardenerRig; body?: Character } = { obj: m.obj, m, label, kneel: 0, rig: m.rig };
      void this.kit.make(characterFor(h)).then((c) => { if (c && this.gardeners.get(h) === entry) { entry.body = c; this.wear(m.obj, c, m.rig.tools); } });
      return entry;
    }, this.scene, (g) => { this.labels.remove(g.label); g.obj.traverse((o) => { if (o.name === 'ring-colour') ((o as THREE.Mesh).material as THREE.Material).dispose(); }); });

    // Ended sessions leave dormant rows behind; don't draw a bot for each one.
    // Members who share a colour get a shape in front of their name, so the label never relies on colour alone.
    const SHAPES = ['●', '▲', '■', '◆', '★'];
    const byColor = new Map<string, string[]>();
    for (const m of snap.members) { const l = byColor.get(m.color.toLowerCase()); if (l) l.push(m.handle); else byColor.set(m.color.toLowerCase(), [m.handle]); }
    for (const [handle, g] of this.gardeners) {
      const group = byColor.get(this.memberColor(handle).toLowerCase()) ?? [];
      const cur = currentTaskOf(this.snap, handle);
      const name = group.length > 1 ? `${SHAPES[group.indexOf(handle) % SHAPES.length]} ${handle}` : handle;
      const text = cur ? `${name} · ${cur.title.length > 18 ? `${cur.title.slice(0, 17)}…` : cur.title}` : name;
      if (g.label.dataset.text !== text) { g.label.dataset.text = text; this.labels.setText(g.label, text); }
    }
    const claudes = snap.agents.filter((a) => a.kind === 'claude' && a.status !== 'dormant');
    reconcile(this.bots, claudes.map((a) => a.sessionId), (id) => {
      const a = claudes.find((x) => x.sessionId === id)!;
      const b = makeBot(this.memberColor(a.handle));
      b.m.obj.position.copy(this.home(a.handle)).add(new THREE.Vector3(0.8, 0, 0.8));
      b.m.target.copy(b.m.obj.position);
      return { obj: b.m.obj, m: b.m, alert: b.alert, body: b.body, agent: a, rig: b.rig };
    }, this.scene, (b) => (b.rig.tip.material as THREE.Material).dispose());
    for (const a of claudes) { const b = this.bots.get(a.sessionId); if (b) b.agent = a; }

    // Spirits: one per subagent, hopping between its owner's task plant and the file it's on; a finished one flies home and pops.
    const subs = snap.agents.filter((a) => a.kind === 'subagent' && a.status !== 'dormant');
    const live = new Set(subs.map((a) => a.sessionId));
    for (const a of subs) {
      let b = this.bees.get(a.sessionId);
      if (!b) {
        const m = makeSpirit(this.memberColor(a.handle));
        const start = this.world.taskPlantPos(a.handle) ?? this.bots.get(a.parentSessionId ?? '')?.obj.position ?? this.home(a.handle);
        m.obj.position.copy(start).setY(0.6);
        this.scene.add(m.obj);
        const bp = new THREE.Vector3();
        const text = spiritText(a.currentAction, a.currentPath);
        const bubble = this.labels.add(text, () => bp.copy(m.obj.position).setY(m.obj.position.y + 0.9), 'bubble spirit');
        b = { obj: m.obj, m, seed: m.obj.position.x, parent: a.parentSessionId ?? '', handle: a.handle, returning: false, bubble, text, hop: 0 };
        this.bees.set(a.sessionId, b);
      }
      b.returning = false;
      const text = spiritText(a.currentAction, a.currentPath);
      if (text !== b.text) { b.text = text; this.labels.setText(b.bubble, text); }
      b.m.target.copy((a.currentPath ? this.world.plantPos(a.currentPath) : undefined) ?? this.world.taskPlantPos(a.handle) ?? this.home(a.handle)).setY(0.35);
    }
    for (const [id, b] of this.bees) if (!live.has(id)) b.returning = true; // flies home in tick(), then is removed

    // Butterflies live until acked; acking bursts the pollen where they landed.
    // Very old unacked messages would circle forever; keep the garden readable.
    const fresh = snap.messages.filter((m) => m.status !== 'acked' &&
      snap.at - (m.status === 'sent' ? m.sentAt : (m.deliveredAt ?? m.sentAt)) < (m.status === 'sent' ? 30 : 10) * 60_000);
    // A flood of messages (a stuck inbox) stays readable: newest first, at most 3 per pair and 10 in the air.
    const perPair = new Map<string, number>();
    const msgs = fresh.slice().sort((a, b) => b.sentAt - a.sentAt || b.id - a.id).filter((m) => {
      const k = `${m.fromHandle}>${m.toHandle}`, n = perPair.get(k) ?? 0;
      if (n >= 3) return false;
      perPair.set(k, n + 1); return true;
    }).slice(0, 10);
    const seen = new Set(msgs.map((m) => String(m.id)));
    for (const [k, f] of this.flies) if (!seen.has(k)) {
      this.fx.burst(f.obj.position.clone(), 0xffd34d, 30, 1.6, 2.5);
      this.scene.remove(f.obj); this.flies.delete(k);
    }
    for (const msg of msgs) {
      let f = this.flies.get(String(msg.id));
      if (!f) {
        const m = makeButterfly(this.memberColor(msg.fromHandle));
        m.obj.position.copy(this.gardenerPos(msg.fromHandle) ?? this.home(msg.fromHandle)).setY(1.4);
        f = { obj: m.obj, m, msg, seed: msg.id * 1.7 };
        this.flies.set(String(msg.id), f); this.scene.add(m.obj);
      }
      f.msg = msg;
    }
  }

  onActivity(a: ActivityView) {
    if (a.path) { const p = this.world.plantPos(a.path); if (p) this.focus = p.clone(); }
    if (a.kind === 'blocked_edit' && a.path) {
      const owner = this.snap.claims.find((c) => (c.path === a.path || (c.path.endsWith('/') && a.path!.startsWith(c.path))) && c.handle !== a.handle)?.handle;
      const gate = this.world.fenceGate(a.path) ?? this.world.plantPos(a.path);
      if (gate) {
        const until = performance.now() + 5500;
        this.meet.set(a.handle, { pos: gate.clone().add(new THREE.Vector3(0.5, 0, 0.3)), until, with: owner });
        if (owner) this.meet.set(owner, { pos: gate.clone().add(new THREE.Vector3(-0.5, 0, 0.3)), until, with: a.handle });
        const bot = this.claudeAgent(a.handle);
        const target = bot && this.bots.get(bot.sessionId);
        const bp = new THREE.Vector3();
        this.labels.add(owner ? `Fenced by ${owner}: asking instead of editing` : 'Fenced: asking instead of editing',
          () => (target ? bp.copy(target.obj.position) : bp.copy(gate)).setY(1.5), 'bubble', 5500);
      }
    }
    if (a.kind === 'commit' && a.path) {
      const bed = this.world.bedOfPath(a.path); const c = bed ? this.world.bedCenter(bed) : undefined;
      if (c) this.fx.shower(c, 6, 6);
    }
    if (a.kind === 'test_pass' || a.kind === 'test_fail') {
      const g = this.gardenerPos(a.handle);
      if (g) { this.fx.burst(this.tmp.copy(g).setY(1), a.kind === 'test_pass' ? 0x7ee081 : 0x333333, 14, 1.2, 3); this.fx.ring(g, a.kind === 'test_pass' ? 0x4cc46f : 0xe5484d); }
    }
    if (a.kind === 'certify_bloom' || a.kind === 'certify_refused') {
      const cert = [...this.snap.certifications].reverse().find((c) => c.path === a.path);
      const bloom = a.kind === 'certify_bloom';
      this.queue.push({
        path: a.path ?? '', result: bloom ? 'bloom' : 'refused', task: cert?.task ?? '',
        reason: bloom ? (cert?.task ? cert.task : 'diff and passing tests seen') : (cert?.reason ?? a.detail),
      });
      // A burst of verdicts: only animate the newest two; the shed still lists them all.
      while (this.queue.length > 2) { const dropped = this.queue.shift()!; this.world.releaseBloom(dropped.path); }
    }
  }

  /** A handoff row appeared or changed: the sender carries a watering can and a seed tag over to the receiver. */
  onHandoff(h: { id: number; fromHandle: string; toHandle: string; task: string; status: string }, op: 'inserted' | 'updated') {
    const cur = this.handoffs.get(h.id);
    if (op === 'inserted' && h.status === 'offered' && !cur) {
      if (!this.gardeners.has(h.fromHandle) || !this.gardeners.has(h.toHandle)) return; // nobody to animate
      const tag = new THREE.Group();
      tag.add(mesh(geo.box, mat('#c8a165'), 0.22, 0.3, 0.03, 0, 0, 0), mesh(geo.cyl, mat('#8d6e4c'), 0.008, 0.18, 0.008, 0, 0.22, 0), mesh(geo.sphere, mat('#7fc36a'), 0.06, 0.06, 0.02, 0, 0.05, 0.02));
      const can = makeCan();
      tag.add(can); can.position.set(-0.28, -0.1, 0);
      this.scene.add(tag);
      this.handoffs.set(h.id, { id: h.id, from: h.fromHandle, to: h.toHandle, task: h.task, phase: 'walk', t: 0, tag, can });
      const g = this.gardeners.get(h.toHandle)!;
      this.meet.set(h.fromHandle, { pos: g.obj.position.clone().add(new THREE.Vector3(0.9, 0, 0.5)), until: performance.now() + 14000, with: h.toHandle });
    } else if (cur && op === 'updated') {
      if (h.status === 'accepted') { cur.phase = 'accepted'; cur.t = 0; }
      else if (h.status === 'declined') { cur.phase = 'declined'; cur.t = 0; }
    }
  }

  private tickHandoffs(dt: number, t: number) {
    for (const [id, a] of this.handoffs) {
      const from = this.gardeners.get(a.from), to = this.gardeners.get(a.to);
      if (!from || !to) { this.endHandoff(id, a); continue; }
      a.t += dt;
      const carry = this.tmp.copy(from.obj.position).setY(1.55);
      if (a.phase === 'walk') {
        a.tag.position.copy(carry);
        if (!from.m.moving && from.obj.position.distanceToSquared(to.obj.position) < 4) { a.phase = 'pass'; a.t = 0; }
        else if (a.t > 12) { a.phase = 'pass'; a.t = 0; }
      } else if (a.phase === 'pass') {
        const k = Math.min(1, a.t / 1.2);
        a.tag.position.copy(carry).lerp(this.bp.copy(to.obj.position).setY(1.6), k);
        a.tag.position.y += Math.sin(k * Math.PI) * 0.5;
        if (k >= 1) {
          a.phase = 'hold'; a.t = 0;
          const chip = this.labels.add(`🌱 ${a.from} → ${a.to}: ${a.task.length > 60 ? `${a.task.slice(0, 59)}…` : a.task}`, () => this.bp.copy(a.tag.position).setY(2.1), 'bubble', 6000);
          a.chip = chip;
        }
      } else if (a.phase === 'hold') {
        a.tag.position.copy(to.obj.position).setY(1.65 + Math.sin(t * 3) * 0.05);
        a.tag.rotation.y = t * 1.5;
      } else if (a.phase === 'accepted') {
        const k = Math.min(1, a.t / 1.0);
        a.tag.position.copy(to.obj.position).setY(1.65 * (1 - k) + 0.25);
        if (k >= 1) {
          this.plantSprout(to.obj.position, 28000); this.fx.burst(this.bp.copy(to.obj.position).setY(0.5), 0x7fc36a, 24, 1.6, 2.5); this.endHandoff(id, a);
        }
      } else if (a.phase === 'declined') {
        const k = Math.min(1, a.t / 1.4);
        a.tag.position.copy(to.obj.position).setY(1.65).lerp(this.bp.copy(from.obj.position).setY(1.55), k);
        if (k >= 1) { this.fx.burst(this.bp.copy(from.obj.position).setY(1.5), 0x888888, 14, 0.8, 0.5); this.endHandoff(id, a); }
      }
      a.can.visible = a.phase === 'walk' || a.phase === 'pass';
    }
    const now = performance.now();
    for (const sp of [...this.sprouts]) {
      const left = (sp.until - now) / 1000;
      sp.g.scale.setScalar(Math.min(1, (28 - left) / 0.8, Math.max(0, left / 2)));
      if (left <= 0) { this.scene.remove(sp.g); this.sprouts.splice(this.sprouts.indexOf(sp), 1); }
    }
  }

  private plantSprout(at: THREE.Vector3, ms: number) {
    const g = new THREE.Group();
    g.add(mesh(geo.cyl, mat('#3f7d3a'), 0.03, 0.4, 0.03, 0, 0.2, 0));
    for (const a of [0.6, 2.7]) { const l = mesh(geo.sphere, mat('#7fc36a'), 0.2, 0.05, 0.1, Math.cos(a) * 0.13, 0.36, Math.sin(a) * 0.13); l.rotation.y = -a; l.rotation.z = 0.4; g.add(l); }
    g.position.set(at.x + 0.7, 0.2, at.z + 0.5); g.scale.setScalar(0.001);
    this.scene.add(g); this.sprouts.push({ g, until: performance.now() + ms });
  }

  private endHandoff(id: number, a: { tag: THREE.Group; chip?: HTMLElement }) {
    this.scene.remove(a.tag); if (a.chip) this.labels.remove(a.chip); this.handoffs.delete(id);
  }

  private dropBee(id: string, b: { obj: THREE.Object3D; bubble: HTMLElement }) {
    this.scene.remove(b.obj); this.labels.remove(b.bubble); this.bees.delete(id);
  }

  /** Swap a figure's simple body for an animated model; tools move into the model's right hand. */
  private wear(obj: THREE.Object3D, c: Character, tools?: Record<string, THREE.Object3D>) {
    c.root.scale.setScalar(CHAR_SCALE); obj.add(c.root); // Kenney models face +z, like our movers
    const proc = obj.getObjectByName('proc'); if (proc) proc.visible = false;
    const hand = c.bone('arm-right');
    if (hand && tools) for (const t of Object.values(tools)) { hand.add(t); t.scale.setScalar(1 / CHAR_SCALE); t.position.set(-0.02, -0.17, 0.05); }
    c.play('idle');
  }

  tick(dt: number) {
    this.clock += dt;
    const t = this.clock, now = performance.now(), mo = this.motion;

    for (const [h, g] of this.gardeners) {
      const ov = this.meet.get(h);
      if (ov && now > ov.until) this.meet.delete(h);
      const agent = this.claudeAgent(h);
      // People move: a working gardener tends the plant from one side then another; an idle one strolls along the lane.
      // Calm mode keeps everyone on one spot.
      const seed = hashString(h) % 97, wt = mo < 0.5 ? 0 : t;
      let target: THREE.Vector3 = this.home(h), kneel = false, plant: THREE.Vector3 | undefined;
      if (ov && now <= ov.until) target = ov.pos;
      else if (agent?.currentPath && (agent.status === 'working' || agent.status === 'blocked')) {
        const p = this.world.plantPos(agent.currentPath);
        if (p && agent.status === 'working') { const o = tendSpot(wt, seed); target = this.tgt.set(p.x + o.x, 0, p.z + o.z); kneel = true; plant = p; }
        else if (p) target = this.tgt.copy(p).add(Actors.OFF_GARDENER);
      } else if (agent?.status !== 'waiting') { const o = idleSpot(wt, seed); target = this.tgt.copy(this.home(h)).add(this.tgt2.set(o.x, 0, o.z)); }
      g.m.nav = this.world.nav; g.m.target.copy(target); g.m.step(dt);
      // Tool in hand matches what the agent is doing; limbs swing while walking.
      const act = agent && agent.status === 'working' ? agent.currentAction : '';
      const tool = act === 'edit' || act === 'create' ? 'can' : act === 'read' ? 'glass' : act === 'search' ? 'clip' : act === 'bash' ? 'hammer' : '';
      const rg = g.rig;
      if (tool !== rg.tool) { const old = rg.tools[rg.tool]; if (old) old.visible = false; const nw = rg.tools[tool]; if (nw) nw.visible = true; rg.tool = tool; }
      const swing = g.m.moving ? Math.sin(t * 9) * 0.7 * Math.max(0.3, mo) : 0;
      rg.armL.rotation.x = swing; rg.legL.rotation.x = -swing * 0.8; rg.legR.rotation.x = swing * 0.8;
      // Working with a tool: hammer chops, the can pours (tilts), the glass leans in, the clipboard jots.
      const work = !g.m.moving && tool !== '';
      rg.armR.rotation.x = g.m.moving ? -swing
        : tool === 'hammer' ? -2.2 + Math.abs(Math.sin(t * 7)) * 1.5 * Math.max(0.3, mo)
        : tool === 'can' ? -1.25 + Math.sin(t * 2) * 0.12 * mo
        : tool ? -1.0 + Math.sin(t * 7) * 0.3 * mo : 0;
      const can = rg.tools.can; if (can) can.rotation.x = work && tool === 'can' ? 0.5 + Math.sin(t * 2) * 0.25 * mo : 0;
      g.obj.rotation.x = work && tool === 'glass' ? 0.22 : 0;
      // Stopped at the gate: face the other person and wave. Waiting on permission: look at the bot.
      if (!g.m.moving) {
        let look: THREE.Vector3 | undefined;
        if (ov && now <= ov.until && ov.with) { look = this.gardenerPos(ov.with); if (look) rg.armR.rotation.x = -1.3 + Math.sin(t * 6) * 0.4 * mo; }
        else if (agent?.status === 'waiting') look = this.bots.get(agent.sessionId)?.obj.position;
        else if (plant) look = plant; // face the plant being tended
        if (look) g.obj.rotation.y = Math.atan2(look.x - g.obj.position.x, look.z - g.obj.position.z);
      }
      g.kneel += ((kneel && !g.m.moving ? 1 : 0) - g.kneel) * Math.min(1, dt * 6);
      g.obj.scale.y = 1 - 0.3 * g.kneel;
      g.obj.position.y = g.m.moving ? Math.abs(Math.sin(t * 9)) * 0.06 * mo : 0;
      if (g.body) { // the animated model does its own walking, tending and waving
        const waving = ov && now <= ov.until && ov.with && !g.m.moving;
        g.body.play(g.m.moving ? 'walk' : waving ? 'emote-yes' : work ? 'interact-right' : 'idle');
        g.body.update(dt * Math.max(0.3, mo));
        g.obj.scale.y = 1; g.obj.position.y = 0;
      }
    }

    for (const b of this.bots.values()) {
      const a = b.agent;
      const gp = this.gardenerPos(a.handle) ?? this.home(a.handle);
      let target: THREE.Vector3 = this.tgt.copy(gp).add(Actors.OFF_BOT_HOME);
      if (a.currentPath && (a.status === 'working' || a.status === 'blocked' || a.status === 'waiting')) {
        const p = this.world.plantPos(a.currentPath);
        if (p) target = a.status === 'blocked' ? this.tgt.copy(this.world.fenceGate(a.currentPath) ?? p).add(Actors.OFF_BOT_GATE) : this.tgt.copy(p).add(Actors.OFF_BOT_WORK);
      }
      b.m.nav = this.world.nav; b.m.target.copy(target); b.m.step(dt);
      b.alert.visible = a.status === 'waiting';
      if (b.m.moving) { b.rig.wheelL.rotateY(dt * 10); b.rig.wheelR.rotateY(dt * 10); }
      (b.rig.tip.material as THREE.MeshStandardMaterial).emissiveIntensity = a.status === 'working' ? 0.4 + 0.6 * Math.abs(Math.sin(t * 6)) : 0.12 + 0.1 * Math.sin(t * 2);
      if (b.rig.iconFor !== a.status) {
        b.rig.iconFor = a.status;
        const glyph = ICON[a.status] ?? '';
        b.rig.icon.visible = glyph !== '';
        if (glyph) b.rig.icon.material = iconMat(glyph);
      }
      if (b.rig.icon.visible) b.rig.icon.position.y = 1.2 + Math.sin(t * 2.2) * 0.04 * mo;
      b.body.position.y = (a.status === 'idle' || a.status === 'dormant' ? 0.22 : 0.32) + (a.status === 'working' ? Math.sin(t * 8) * 0.025 * mo : 0);
      b.obj.scale.setScalar(a.status === 'dormant' ? 0.8 : 1);
    }

    for (const [id, b] of this.bees) {
      if (b.returning) {
        const home = this.world.taskPlantPos(b.handle) ?? this.bots.get(b.parent)?.obj.position;
        if (!home) { this.dropBee(id, b); continue; }
        b.m.target.copy(home).setY(0.6);
        if (b.obj.position.distanceToSquared(b.m.target) < 0.25) { this.fx.burst(b.obj.position, 0xfff1a8, 10, 0.8, 1.5); this.dropBee(id, b); continue; }
      }
      // Hop on top of the eased height; last frame's hop comes off first so it never feeds the easing (which would float the spirit ~2 units up).
      b.obj.position.y -= b.hop;
      b.m.step(dt, true);
      b.hop = Math.abs(Math.sin(t * 6 + b.seed)) * 0.18 * mo;
      b.obj.position.y = Math.max(b.obj.position.y, 0.15) + b.hop;
    }

    for (const f of this.flies.values()) {
      const recip = this.claudeAgent(f.msg.toHandle);
      const recipPos = this.gardenerPos(f.msg.toHandle) ?? this.home(f.msg.toHandle);
      if (f.msg.status === 'sent') {
        // Not delivered yet: circle the recipient's bed, honestly.
        const bed = recip?.currentPath ? this.world.bedOfPath(recip.currentPath) : undefined;
        const c = (bed ? this.world.bedCenter(bed) : undefined) ?? recipPos;
        const a = t * 1.6 + f.seed;
        f.m.target.set(c.x + Math.cos(a) * 2.2, 1.6 + Math.sin(t * 2 + f.seed) * 0.3 * mo, c.z + Math.sin(a) * 2.2);
        f.m.speed = 6;
      } else {
        f.m.target.set(recipPos.x + 0.3, 0.9, recipPos.z + 0.3); // landed on the recipient's shoulder
        f.m.speed = 3;
      }
      f.m.step(dt, true);
      const flap = f.msg.status === 'sent' ? 14 : 3;
      for (const w of f.obj.userData.wings as THREE.Object3D[]) w.rotation.z = Math.sin(t * flap) * 0.7 * (w.position.x > 0 ? -1 : 1) * Math.max(0.3, mo);
    }

    this.tickHandoffs(dt, t);
    this.tickBotanist(dt, now, t);
  }

  private tickBotanist(dt: number, _now: number, t: number) {
    const b = this.botanist;
    const homePos = this.botHome;
    if (!this.job && this.queue.length) this.job = { j: this.queue.shift()!, phase: 'walk', t: 0 };
    const job = this.job;
    const body = this.botanistBody;
    if (body) {
      body.play(b.moving ? 'walk' : job?.phase === 'hold' ? (job.j.result === 'refused' ? 'emote-no' : 'emote-yes') : 'idle');
      body.update(dt * Math.max(0.3, this.motion));
    }
    if (!job) {
      b.nav = this.world.nav; b.target.copy(homePos); b.step(dt); b.obj.rotation.x = 0; this.shot = null;
      if (!b.moving) { const r = b.obj.rotation.y, d = Math.atan2(Math.sin(-r), Math.cos(-r)); b.obj.rotation.y = r + d * Math.min(1, dt * 3); } // at home: turn to face the front
      return;
    }
    const p = this.world.plantPos(job.j.path);
    if (job.phase === 'walk') {
      if (p) { this.tmp.copy(p).add(this.off); b.target.copy(this.tmp); } else b.target.copy(homePos);
      b.nav = this.world.nav; b.step(dt);
      job.t += dt;
      if (!b.moving || job.t > 8) { // arrived (or took too long: show the verdict anyway)
        job.phase = 'hold'; job.t = 0;
        const refused = job.j.result === 'refused';
        if (p) { this.shotPoint.copy(p); this.shot = { point: this.shotPoint }; }
        const lines = refused ? job.j.reason.split(/;\s*/).filter(Boolean) : job.j.task ? [job.j.task] : [];
        job.bubble = this.labels.add(refused ? 'Botanist refused' : 'Bloom certified', () => this.bubblePos.copy(b.obj.position).setY(2.3),
          refused ? 'bubble big refused' : 'bubble big bloom', Infinity, lines);
        if (refused) { this.world.wobblePlant(job.j.path, 1.4); this.world.showLock(job.j.path); }
        else this.world.releaseBloom(job.j.path);
      }
    } else if (job.phase === 'hold') {
      job.t += dt;
      b.obj.lookAt(p ?? b.obj.position);
      if (!body) { // the animated model shakes its head or nods by itself
        if (job.j.result === 'refused') b.obj.rotation.y += Math.sin(t * 14) * 0.25 * Math.max(0.2, this.motion); // head shake
        else b.obj.rotation.x = Math.sin(t * 8) * 0.12 * this.motion; // nod
      }
      const hold = job.j.result === 'refused' ? 4.8 : 4.2;
      if (job.t > hold) {
        if (job.bubble) this.labels.remove(job.bubble);
        b.obj.rotation.x = 0; job.phase = 'home'; this.shot = null; this.world.showLock(null);
      }
    } else {
      b.nav = this.world.nav; b.target.copy(homePos); b.step(dt);
      if (!b.moving) this.job = null;
    }
  }
}
