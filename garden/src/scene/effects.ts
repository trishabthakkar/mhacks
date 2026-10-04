import * as THREE from 'three';
import { labelRule } from './labelRules.ts';

interface Item {
  el: HTMLElement; pos: () => THREE.Vector3 | undefined; until: number; pri: number; nudge: boolean; maxDist: number; edge: boolean;
  w: number; h: number; measured: boolean;
  x: number; y: number; vis: boolean; dist: number;
  lastX: number; lastY: number; lastS: number; lastO: number; lastDisplay: string;
  arrow?: HTMLElement; arrowText: string; arrowRect?: Rect;
}
interface Rect { l: number; t: number; r: number; b: number }

const MAX_BUBBLES = 3;

/**
 * HTML labels and speech bubbles pinned to world positions, with declutter:
 * priority order (verdict > bubble > member > botanist > bed), no overlaps (lower priority nudges up or hides),
 * clamped to the free screen area (not under the shed), distance scaling, edge arrows for off-screen members,
 * at most 3 ordinary bubbles, and DOM writes only when something moved.
 */
export class Labels {
  private items = new Set<Item>();
  private order: Item[] = [];
  private placed: Rect[] = [];
  private v = new THREE.Vector3();

  constructor(private host: HTMLElement, private camera: THREE.PerspectiveCamera) {}

  /** `lines` makes a titled list (title = text); used by the botanist's verdict. `edge` adds an off-screen arrow. */
  add(text: string, pos: () => THREE.Vector3 | undefined, cls = 'label', ttlMs = Infinity, lines?: string[]): HTMLElement {
    const el = document.createElement('div');
    el.className = cls;
    if (lines && lines.length) {
      const t = document.createElement('strong'); t.textContent = text; el.appendChild(t);
      const ul = document.createElement('ul');
      for (const l of lines) { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); }
      el.appendChild(ul);
    } else el.textContent = text;
    el.style.opacity = '0';
    this.host.appendChild(el);
    const { pri, nudge, maxDist } = labelRule(cls);
    if (pri === 5) this.capBubbles();
    this.items.add({
      el, pos, until: ttlMs === Infinity ? Infinity : performance.now() + ttlMs, pri, nudge, maxDist, edge: cls.includes('member'),
      w: 0, h: 0, measured: false, x: 0, y: 0, vis: false, dist: 0,
      lastX: -1e9, lastY: -1e9, lastS: -1, lastO: -1, lastDisplay: '', arrowText: text,
    });
    return el;
  }

  /** Change a label's text (its size is re-measured on the next frame). */
  setText(el: HTMLElement, text: string) {
    for (const i of this.items) if (i.el === el) { el.textContent = text; i.arrowText = text.split(' · ')[0]!; i.measured = false; } // arrows carry the name only
  }

  remove(el: HTMLElement) {
    for (const i of this.items) if (i.el === el) { el.remove(); i.arrow?.remove(); this.items.delete(i); }
  }

  /** Ordinary speech bubbles: keep the newest MAX_BUBBLES; older ones fade out. */
  private capBubbles() {
    const b = [...this.items].filter((i) => i.pri === 5);
    while (b.length >= MAX_BUBBLES) {
      const old = b.shift()!;
      old.el.style.opacity = '0';
      this.items.delete(old);
      setTimeout(() => old.el.remove(), 220);
    }
  }

  private hit(r: Rect) {
    for (const p of this.placed) if (r.l < p.r && r.r > p.l && r.t < p.b && r.b > p.t) return p;
    return undefined;
  }

  /** `reservedRight`: pixels at the right covered by the shed, which labels must stay out of. */
  update(width: number, height: number, reservedRight = 0, reservedBottom = 0) {
    const now = performance.now();
    const ax0 = 8, ay0 = 44, ax1 = Math.max(ax0 + 100, width - reservedRight - 8), ay1 = height - reservedBottom - 8;
    this.order.length = 0;
    for (const i of this.items) {
      const p = i.pos();
      if (now > i.until) { i.el.remove(); i.arrow?.remove(); this.items.delete(i); continue; }
      if (!p) { this.hide(i); continue; }
      this.v.copy(p).project(this.camera);
      i.dist = this.camera.position.distanceTo(p);
      i.x = ((this.v.x + 1) / 2) * width; i.y = ((1 - this.v.y) / 2) * height;
      const behind = this.v.z > 1;
      i.vis = i.dist <= i.maxDist && !behind && i.x >= ax0 - 20 && i.x <= ax1 + 20 && i.y >= ay0 - 20 && i.y <= ay1 + 60;
      if (i.vis) this.order.push(i);
      else {
        this.hide(i);
        if (i.edge) this.showArrow(i, behind, ax0, ay0, ax1, ay1);
        else if (i.arrow) { i.arrow.style.display = 'none'; i.arrowRect = undefined; }
      }
    }
    // Highest priority first; ties: nearer the camera first.
    this.order.sort((a, b) => b.pri - a.pri || a.dist - b.dist);
    this.placed.length = 0;
    for (const i of this.items) if (i.arrow && i.arrow.style.display !== 'none' && i.arrowRect) this.placed.push(i.arrowRect); // edge arrows are obstacles too
    for (const i of this.order) {
      if (!i.measured) { i.el.style.display = ''; i.w = i.el.offsetWidth; i.h = i.el.offsetHeight; i.measured = true; }
      const s = i.pri >= 5 ? 1 : Math.min(1.08, Math.max(0.92, 1.25 - i.dist / 70));
      const w = i.w * s, h = i.h * s;
      let x = Math.min(Math.max(i.x, ax0 + w / 2), ax1 - w / 2);
      let y = Math.min(Math.max(i.y, ay0 + h), ay1);
      const rect: Rect = { l: x - w / 2, r: x + w / 2, t: y - h, b: y };
      let tries = 0;
      while (i.nudge && this.hit(rect) && tries < 6) {
        const o = this.hit(rect)!;
        const dy = rect.b - o.t + 3; // lift above the label it collides with
        y -= dy; rect.t -= dy; rect.b -= dy; tries++;
        if (y - h < ay0) break;
      }
      const stillHit = !!this.hit(rect);
      // Low-priority labels that cannot be placed cleanly are hidden rather than drawn over something.
      if ((stillHit && !i.nudge) || rect.t < ay0 - 1) { this.hide(i); if (i.arrow) i.arrow.style.display = 'none'; continue; }
      this.placed.push(rect);
      const far = Math.min(1, Math.max(0, (i.dist - 60) / 40));
      this.show(i, x, y, s, i.pri >= 5 ? 1 : 1 - far * 0.7);
      if (i.arrow) { i.arrow.style.display = 'none'; i.arrowRect = undefined; }
    }
  }

  private hide(i: Item) {
    if (i.lastDisplay !== 'none') { i.el.style.display = 'none'; i.lastDisplay = 'none'; }
  }

  private show(i: Item, x: number, y: number, s: number, o: number) {
    if (i.lastDisplay !== '') { i.el.style.display = ''; i.lastDisplay = ''; }
    if (Math.abs(x - i.lastX) > 0.5 || Math.abs(y - i.lastY) > 0.5 || Math.abs(s - i.lastS) > 0.01) {
      i.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%) scale(${s.toFixed(2)})`;
      i.lastX = x; i.lastY = y; i.lastS = s;
    }
    if (Math.abs(o - i.lastO) > 0.02) { i.el.style.opacity = o.toFixed(2); i.lastO = o; }
  }

  /** A member who is off-screen gets an arrow at the screen edge pointing their way. */
  private showArrow(i: Item, behind: boolean, ax0: number, ay0: number, ax1: number, ay1: number) {
    if (!i.arrow) {
      i.arrow = document.createElement('div');
      i.arrow.className = 'edgearrow';
      this.host.appendChild(i.arrow);
    }
    const cx = (ax0 + ax1) / 2, cy = (ay0 + ay1) / 2;
    let dx = i.x - cx, dy = i.y - cy;
    if (behind) { dx = -dx; dy = -dy; }
    const k = Math.min((ax1 - ax0 - 90) / 2 / Math.max(Math.abs(dx), 1e-3), (ay1 - ay0 - 30) / 2 / Math.max(Math.abs(dy), 1e-3));
    const ex = cx + dx * k, ey = cy + dy * k;
    const glyph = Math.abs(dx) * 0.6 > Math.abs(dy) ? (dx > 0 ? '→' : '←') : dy > 0 ? '↓' : '↑';
    const text = glyph === '→' ? `${i.arrowText} ${glyph}` : `${glyph} ${i.arrowText}`;
    if (i.arrow.textContent !== text) i.arrow.textContent = text;
    i.arrow.style.display = '';
    i.arrow.style.transform = `translate(${ex.toFixed(1)}px,${ey.toFixed(1)}px) translate(-50%,-50%)`;
    const aw = i.arrow.offsetWidth || 70, ah = i.arrow.offsetHeight || 24;
    i.arrowRect = { l: ex - aw / 2, r: ex + aw / 2, t: ey - ah / 2, b: ey + ah / 2 };
  }
}

interface BurstSlot { pts: THREE.Points; pos: THREE.BufferAttribute; vel: Float32Array; life: number; gravity: number; count: number; active: boolean }
interface RainSlot { pts: THREE.Points; pos: THREE.BufferAttribute; until: number; active: boolean }

const BURST_MAX = 64, BURST_SLOTS = 8, RAIN_N = 220, RAIN_SLOTS = 3;

/** Pooled particle bursts (bloom, pollen, bug scatter) and rain showers. Nothing is created after construction. */
export class Particles {
  private bursts: BurstSlot[] = [];
  private rains: RainSlot[] = [];
  reducedMotion = false;
  private c = new THREE.Color();
  private rings: Array<{ mesh: THREE.Mesh; life: number }> = [];

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < BURST_SLOTS; i++) {
      const pos = new THREE.BufferAttribute(new Float32Array(BURST_MAX * 3), 3);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', pos); g.setDrawRange(0, 0);
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, depthWrite: false }));
      pts.visible = false; pts.frustumCulled = false; scene.add(pts);
      this.bursts.push({ pts, pos, vel: new Float32Array(BURST_MAX * 3), life: 0, gravity: 4, count: 0, active: false });
    }
    for (let i = 0; i < 4; i++) { // expanding ground rings (test results)
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2; mesh.visible = false; scene.add(mesh);
      this.rings.push({ mesh, life: 0 });
    }
    for (let i = 0; i < RAIN_SLOTS; i++) {
      const pos = new THREE.BufferAttribute(new Float32Array(RAIN_N * 3), 3);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', pos);
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9cc9ee, size: 0.09, transparent: true, opacity: 0.8, depthWrite: false }));
      pts.visible = false; pts.frustumCulled = false; scene.add(pts);
      this.rains.push({ pts, pos, until: 0, active: false });
    }
  }

  burst(at: THREE.Vector3, color: number, count = 36, speed = 2.2, gravity = 4) {
    count = Math.min(this.reducedMotion ? 8 : count, BURST_MAX);
    // Reuse a free slot, else steal the one closest to expiring.
    let slot = this.bursts.find((b) => !b.active);
    if (!slot) slot = this.bursts.reduce((m, b) => (b.life < m.life ? b : m));
    const arr = slot.pos.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3] = at.x; arr[i * 3 + 1] = at.y; arr[i * 3 + 2] = at.z;
      const a = (i * 2.399963) % (Math.PI * 2), up = 0.5 + ((i * 37) % 10) / 10;
      slot.vel[i * 3] = Math.cos(a) * speed * 0.5 * up; slot.vel[i * 3 + 1] = speed * up; slot.vel[i * 3 + 2] = Math.sin(a) * speed * 0.5 * up;
    }
    slot.pos.needsUpdate = true;
    slot.pts.geometry.setDrawRange(0, count);
    (slot.pts.material as THREE.PointsMaterial).color.copy(this.c.set(color));
    (slot.pts.material as THREE.PointsMaterial).opacity = 1;
    slot.count = count; slot.life = 1.4; slot.gravity = gravity; slot.active = true; slot.pts.visible = true;
  }

  /** An expanding ring on the ground (green for a passing test, red for a failing one). */
  ring(at: THREE.Vector3, color: number) {
    if (this.reducedMotion) return;
    const r = this.rings.find((x) => x.life <= 0) ?? this.rings[0]!;
    r.mesh.position.set(at.x, 0.36, at.z); r.mesh.visible = true; r.life = 1;
    (r.mesh.material as THREE.MeshBasicMaterial).color.set(color);
  }

  shower(center: THREE.Vector3, w: number, d: number, ms = 2800) {
    if (this.reducedMotion) return;
    const slot = this.rains.find((r) => !r.active) ?? this.rains[0]!;
    const arr = slot.pos.array as Float32Array;
    for (let i = 0; i < RAIN_N; i++) { arr[i * 3] = center.x + (Math.random() - 0.5) * w; arr[i * 3 + 1] = Math.random() * 5; arr[i * 3 + 2] = center.z + (Math.random() - 0.5) * d; }
    slot.pos.needsUpdate = true; slot.until = performance.now() + ms; slot.active = true; slot.pts.visible = true;
  }

  update(dt: number) {
    for (const b of this.bursts) {
      if (!b.active) continue;
      b.life -= dt;
      const arr = b.pos.array as Float32Array;
      for (let i = 0; i < b.count; i++) {
        const vy = b.vel[i * 3 + 1]! - b.gravity * dt;
        b.vel[i * 3 + 1] = vy;
        arr[i * 3] = arr[i * 3]! + b.vel[i * 3]! * dt; arr[i * 3 + 1] = Math.max(0.02, arr[i * 3 + 1]! + vy * dt); arr[i * 3 + 2] = arr[i * 3 + 2]! + b.vel[i * 3 + 2]! * dt;
      }
      b.pos.needsUpdate = true;
      (b.pts.material as THREE.PointsMaterial).opacity = Math.max(0, b.life / 1.4);
      if (b.life <= 0) { b.active = false; b.pts.visible = false; }
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt * 1.3;
      r.mesh.scale.setScalar(1 + (1 - Math.max(0, r.life)) * 4);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.life) * 0.8;
      if (r.life <= 0) r.mesh.visible = false;
    }
    const now = performance.now();
    for (const r of this.rains) {
      if (!r.active) continue;
      const arr = r.pos.array as Float32Array;
      for (let i = 0; i < RAIN_N; i++) { let y = arr[i * 3 + 1]! - 9 * dt; if (y < 0) y += 5; arr[i * 3 + 1] = y; }
      r.pos.needsUpdate = true;
      if (now > r.until) { r.active = false; r.pts.visible = false; }
    }
  }

  clear() {
    for (const b of this.bursts) { b.active = false; b.pts.visible = false; }
    for (const r of this.rains) { r.active = false; r.pts.visible = false; }
    for (const r of this.rings) { r.life = 0; r.mesh.visible = false; }
  }
}
