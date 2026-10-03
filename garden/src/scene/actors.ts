import * as THREE from 'three';
import type { ActivityView, AgentView, GardenSnapshot, MessageView } from '../../../shared/types.ts';
import { geo, mat, mesh } from './materials.ts';
import type { Labels, Particles } from './effects.ts';

export interface WorldLookup {
  plantPos(path: string): THREE.Vector3 | undefined;
  bedCenter(bed: string): THREE.Vector3 | undefined;
  bedOfPath(path: string): string | undefined;
  fenceGate(path: string): THREE.Vector3 | undefined;
  extent: number;
  homeFrame: { halfW: number; frontZ: number };
  releaseBloom(path: string): void;
  wobblePlant(path: string, seconds: number): void;
  showLock(path: string | null): void;
}

class Mover {
  obj = new THREE.Group();
  target = new THREE.Vector3();
  moving = false;
  constructor(public speed = 3) {}
  step(dt: number, lerpY = false) {
    const p = this.obj.position;
    const dx = this.target.x - p.x, dz = this.target.z - p.z, d = Math.hypot(dx, dz);
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
function makeGardener(color: string): Mover {
  const m = new Mover(3.2);
  m.obj.add(mesh(geo.cyl, mat(color), 0.22, 0.6, 0.22, 0, 0.5, 0));
  m.obj.add(mesh(geo.sphere, mat(SKIN), 0.17, 0.17, 0.17, 0, 0.95, 0));
  m.obj.add(mesh(geo.cyl, mat('#e9c46a'), 0.3, 0.03, 0.3, 0, 1.08, 0));
  m.obj.add(mesh(geo.cone, mat('#e9c46a'), 0.16, 0.18, 0.16, 0, 1.18, 0));
  return m;
}
function makeBot(color: string): { m: Mover; alert: THREE.Object3D; body: THREE.Object3D } {
  const m = new Mover(3.6);
  const body = mesh(geo.box, mat('#cfd6dc'), 0.34, 0.3, 0.34, 0, 0.32, 0);
  m.obj.add(body);
  m.obj.add(mesh(geo.box, mat(color), 0.36, 0.06, 0.36, 0, 0.4, 0));
  m.obj.add(mesh(geo.sphere, mat('#e6ecef'), 0.13, 0.13, 0.13, 0, 0.62, 0));
  m.obj.add(mesh(geo.sphere, mat('#222', {}), 0.03, 0.03, 0.03, 0.05, 0.64, 0.11));
  m.obj.add(mesh(geo.sphere, mat('#222', {}), 0.03, 0.03, 0.03, -0.05, 0.64, 0.11));
  m.obj.add(mesh(geo.cyl, mat('#888'), 0.012, 0.18, 0.012, 0, 0.8, 0));
  const alert = new THREE.Group();
  alert.add(mesh(geo.box, mat('#ffd23f', { emissive: 0x553d00 }), 0.05, 0.16, 0.05, 0, 1.05, 0));
  alert.add(mesh(geo.box, mat('#ffd23f', { emissive: 0x553d00 }), 0.05, 0.05, 0.05, 0, 0.9, 0));
  alert.visible = false;
  m.obj.add(alert);
  return { m, alert, body };
}
function makeBee(): Mover {
  const m = new Mover(5);
  m.obj.add(mesh(geo.sphere, mat('#f6c21a'), 0.1, 0.08, 0.14));
  m.obj.add(mesh(geo.box, mat('#222'), 0.105, 0.03, 0.04, 0, 0.01, 0.02));
  const w = mesh(geo.box, mat('#ffffff', { opacity: 0.6 }), 0.16, 0.01, 0.07, 0, 0.09, 0);
  m.obj.add(w);
  m.obj.userData.wing = w;
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
  m.obj.add(mesh(geo.cyl, mat('#f4f1e8'), 0.26, 0.85, 0.26, 0, 0.55, 0));
  m.obj.add(mesh(geo.sphere, mat(SKIN), 0.18, 0.18, 0.18, 0, 1.12, 0));
  m.obj.add(mesh(geo.cyl, mat('#6a4c93'), 0.24, 0.1, 0.24, 0, 1.28, 0));
  m.obj.add(mesh(geo.box, mat('#7ec8e3', { opacity: 0.8 }), 0.22, 0.06, 0.05, 0, 1.14, 0.16));
  m.obj.add(mesh(geo.box, mat('#8d6e4c'), 0.18, 0.24, 0.02, 0.28, 0.65, 0.1));
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
  private gardeners = new Map<string, { obj: THREE.Object3D; m: Mover; label: HTMLElement; kneel: number }>();
  private bots = new Map<string, { obj: THREE.Object3D; m: Mover; alert: THREE.Object3D; body: THREE.Object3D; agent: AgentView }>();
  private bees = new Map<string, { obj: THREE.Object3D; m: Mover; seed: number }>();
  private flies = new Map<string, Fly>();
  private meet = new Map<string, { pos: THREE.Vector3; until: number }>();
  private botanist = makeBotanist();
  private job: { j: BotanistJob; phase: 'walk' | 'hold' | 'home'; t: number; bubble?: HTMLElement } | null = null;
  private shotPoint = new THREE.Vector3();
  /** Set while the botanist is delivering a verdict: the world dims the scene and pushes the camera in. */
  shot: { point: THREE.Vector3 } | null = null;
  private queue: BotanistJob[] = [];
  private clock = 0;
  private homes = new Map<string, THREE.Vector3>();
  private botHome = new THREE.Vector3();
  get botanistHome() { return this.botHome; }
  private tmp = new THREE.Vector3();
  private tgt = new THREE.Vector3();
  private static OFF_GARDENER = new THREE.Vector3(-0.75, 0, 0.55);
  private static OFF_BOT_HOME = new THREE.Vector3(0.9, 0, 0.9);
  private static OFF_BOT_WORK = new THREE.Vector3(0.6, 0, 0.45);
  private static OFF_BOT_GATE = new THREE.Vector3(0, 0, 0.9);
  private off = new THREE.Vector3(1.3, 0, 0.9);
  private bubblePos = new THREE.Vector3();
  motion = 1;
  /** Latest place something happened, for director mode. */
  focus: THREE.Vector3 | undefined;

  constructor(private scene: THREE.Scene, private world: WorldLookup, private labels: Labels, private fx: Particles) {
    this.botHome.set(world.homeFrame.halfW + 2.5, 0, world.homeFrame.frontZ - 1);
    this.botanist.obj.position.copy(this.botHome);
    this.botanist.target.copy(this.botHome);
    scene.add(this.botanist.obj);
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
  gardenerPos(handle: string): THREE.Vector3 | undefined { return this.gardeners.get(handle)?.obj.position; }
  private claudeAgent(handle: string) { return this.snap.agents.find((a) => a.handle === handle && a.kind === 'claude'); }

  clearTransient() {
    this.meet.clear(); this.queue = []; this.shot = null; this.world.showLock(null);
    if (this.job?.bubble) this.labels.remove(this.job.bubble);
    this.job = null;
  }

  sync(snap: GardenSnapshot) {
    this.snap = snap;
    this.refreshHomes();
    reconcile(this.gardeners, snap.members.filter((m) => m.online).map((m) => m.handle), (h) => {
      const m = makeGardener(this.memberColor(h));
      m.obj.position.copy(this.home(h)); m.target.copy(m.obj.position);
      const lp = new THREE.Vector3();
      const label = this.labels.add(h, () => lp.copy(m.obj.position).setY(1.6), 'label member');
      label.style.borderColor = this.memberColor(h);
      return { obj: m.obj, m, label, kneel: 0 };
    }, this.scene, (g) => this.labels.remove(g.label));

    // Ended sessions leave dormant rows behind; don't draw a bot for each one.
    const claudes = snap.agents.filter((a) => a.kind === 'claude' && a.status !== 'dormant');
    reconcile(this.bots, claudes.map((a) => a.sessionId), (id) => {
      const a = claudes.find((x) => x.sessionId === id)!;
      const b = makeBot(this.memberColor(a.handle));
      b.m.obj.position.copy(this.home(a.handle)).add(new THREE.Vector3(0.8, 0, 0.8));
      b.m.target.copy(b.m.obj.position);
      return { obj: b.m.obj, m: b.m, alert: b.alert, body: b.body, agent: a };
    }, this.scene);
    for (const a of claudes) { const b = this.bots.get(a.sessionId); if (b) b.agent = a; }

    const subs = snap.agents.filter((a) => a.kind === 'subagent' && a.status !== 'dormant');
    reconcile(this.bees, subs.map((a) => a.sessionId), (id) => {
      const a = subs.find((x) => x.sessionId === id)!;
      const m = makeBee();
      const parent = this.bots.get(a.parentSessionId ?? '');
      m.obj.position.copy(parent ? parent.obj.position : this.home(a.handle)).setY(1);
      return { obj: m.obj, m, seed: m.obj.position.x };
    }, this.scene);
    for (const a of subs) {
      const b = this.bees.get(a.sessionId);
      if (b) b.m.target.copy((a.currentPath ? this.world.plantPos(a.currentPath) : undefined) ?? this.home(a.handle)).setY(1.1);
    }

    // Butterflies live until acked; acking bursts the pollen where they landed.
    // Very old unacked messages would circle forever; keep the garden readable.
    const msgs = snap.messages.filter((m) => m.status !== 'acked' &&
      snap.at - (m.status === 'sent' ? m.sentAt : (m.deliveredAt ?? m.sentAt)) < (m.status === 'sent' ? 30 : 10) * 60_000);
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
        this.meet.set(a.handle, { pos: gate.clone().add(new THREE.Vector3(0.5, 0, 0.3)), until });
        if (owner) this.meet.set(owner, { pos: gate.clone().add(new THREE.Vector3(-0.5, 0, 0.3)), until });
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
      if (g) this.fx.burst(g.clone().setY(1), a.kind === 'test_pass' ? 0x7ee081 : 0x333333, 14, 1.2, 3);
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

  tick(dt: number) {
    this.clock += dt;
    const t = this.clock, now = performance.now(), mo = this.motion;

    for (const [h, g] of this.gardeners) {
      const ov = this.meet.get(h);
      if (ov && now > ov.until) this.meet.delete(h);
      const agent = this.claudeAgent(h);
      let target: THREE.Vector3 = this.home(h), kneel = false;
      if (ov && now <= ov.until) target = ov.pos;
      else if (agent?.currentPath && (agent.status === 'working' || agent.status === 'blocked')) {
        const p = this.world.plantPos(agent.currentPath);
        if (p) { target = this.tgt.copy(p).add(Actors.OFF_GARDENER); kneel = agent.status === 'working'; }
      }
      g.m.target.copy(target); g.m.step(dt);
      g.kneel += ((kneel && !g.m.moving ? 1 : 0) - g.kneel) * Math.min(1, dt * 6);
      g.obj.scale.y = 1 - 0.3 * g.kneel;
      g.obj.position.y = g.m.moving ? Math.abs(Math.sin(t * 9)) * 0.06 * mo : 0;
    }

    for (const b of this.bots.values()) {
      const a = b.agent;
      const gp = this.gardenerPos(a.handle) ?? this.home(a.handle);
      let target: THREE.Vector3 = this.tgt.copy(gp).add(Actors.OFF_BOT_HOME);
      if (a.currentPath && (a.status === 'working' || a.status === 'blocked' || a.status === 'waiting')) {
        const p = this.world.plantPos(a.currentPath);
        if (p) target = a.status === 'blocked' ? this.tgt.copy(this.world.fenceGate(a.currentPath) ?? p).add(Actors.OFF_BOT_GATE) : this.tgt.copy(p).add(Actors.OFF_BOT_WORK);
      }
      b.m.target.copy(target); b.m.step(dt);
      b.alert.visible = a.status === 'waiting';
      b.body.position.y = (a.status === 'idle' || a.status === 'dormant' ? 0.22 : 0.32) + (a.status === 'working' ? Math.sin(t * 8) * 0.025 * mo : 0);
      b.obj.scale.setScalar(a.status === 'dormant' ? 0.8 : 1);
    }

    for (const b of this.bees.values()) {
      b.m.step(dt, true);
      b.obj.position.y += Math.sin(t * 5 + b.seed) * 0.004 * mo;
      b.obj.position.x += Math.cos(t * 3 + b.seed) * 0.01 * mo;
      (b.obj.userData.wing as THREE.Object3D).scale.z = 0.07 * (0.5 + Math.abs(Math.sin(t * 40)));
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

    this.tickBotanist(dt, now, t);
  }

  private tickBotanist(dt: number, _now: number, t: number) {
    const b = this.botanist;
    const homePos = this.botHome;
    if (!this.job && this.queue.length) this.job = { j: this.queue.shift()!, phase: 'walk', t: 0 };
    const job = this.job;
    if (!job) { b.target.copy(homePos); b.step(dt); b.obj.rotation.x = 0; this.shot = null; return; }
    const p = this.world.plantPos(job.j.path);
    if (job.phase === 'walk') {
      if (p) { this.tmp.copy(p).add(this.off); b.target.copy(this.tmp); } else b.target.copy(homePos);
      b.step(dt);
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
      if (job.j.result === 'refused') b.obj.rotation.y += Math.sin(t * 14) * 0.25 * Math.max(0.2, this.motion); // head shake
      else b.obj.rotation.x = Math.sin(t * 8) * 0.12 * this.motion; // nod
      const hold = job.j.result === 'refused' ? 4.8 : 4.2;
      if (job.t > hold) {
        if (job.bubble) this.labels.remove(job.bubble);
        b.obj.rotation.x = 0; job.phase = 'home'; this.shot = null; this.world.showLock(null);
      }
    } else {
      b.target.copy(homePos); b.step(dt);
      if (!b.moving) this.job = null;
    }
  }
}
