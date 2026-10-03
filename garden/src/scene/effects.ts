import * as THREE from 'three';

interface Item {
  el: HTMLElement; pos: () => THREE.Vector3 | undefined; until: number; pri: number; edge: boolean;
  w: number; h: number; measured: boolean;
  x: number; y: number; vis: boolean; dist: number;
  lastX: number; lastY: number; lastS: number; lastO: number; lastDisplay: string;
  arrow?: HTMLElement; arrowText: string;
}
interface Rect { l: number; t: number; r: number; b: number }

const MAX_BUBBLES = 3;
const priorityOf = (cls: string) =>
  cls.includes('big') ? 5 : cls.includes('bubble') ? 4 : cls.includes('member') ? 3 : cls.includes('botanist') ? 2 : 1;

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
    const pri = priorityOf(cls);
    if (pri === 4) this.capBubbles();
    this.items.add({
      el, pos, until: ttlMs === Infinity ? Infinity : performance.now() + ttlMs, pri, edge: cls.includes('member'),
      w: 0, h: 0, measured: false, x: 0, y: 0, vis: false, dist: 0,
      lastX: -1e9, lastY: -1e9, lastS: -1, lastO: -1, lastDisplay: '', arrowText: text,
    });
    return el;
  }

  remove(el: HTMLElement) {
    for (const i of this.items) if (i.el === el) { el.remove(); i.arrow?.remove(); this.items.delete(i); }
  }

  /** Ordinary speech bubbles: keep the newest MAX_BUBBLES; older ones fade out. */
  private capBubbles() {
    const b = [...this.items].filter((i) => i.pri === 4);
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
  update(width: number, height: number, reservedRight = 0) {
    const now = performance.now();
    const ax0 = 8, ay0 = 44, ax1 = Math.max(ax0 + 100, width - reservedRight - 8), ay1 = height - 8;
    this.order.length = 0;
    for (const i of this.items) {
      const p = i.pos();
      if (now > i.until) { i.el.remove(); i.arrow?.remove(); this.items.delete(i); continue; }
      if (!p) { this.hide(i); continue; }
      this.v.copy(p).project(this.camera);
      i.dist = this.camera.position.distanceTo(p);
      i.x = ((this.v.x + 1) / 2) * width; i.y = ((1 - this.v.y) / 2) * height;
      const behind = this.v.z > 1;
      i.vis = !behind && i.x >= ax0 - 20 && i.x <= ax1 + 20 && i.y >= ay0 - 20 && i.y <= ay1 + 60;
      if (i.vis) this.order.push(i);
      else {
        this.hide(i);
        if (i.edge) this.showArrow(i, behind, ax0, ay0, ax1, ay1);
        else if (i.arrow) i.arrow.style.display = 'none';
      }
    }
    // Highest priority first; ties: nearer the camera first.
    this.order.sort((a, b) => b.pri - a.pri || a.dist - b.dist);
    this.placed.length = 0;
    for (const i of this.order) {
      if (!i.measured) { i.el.style.display = ''; i.w = i.el.offsetWidth; i.h = i.el.offsetHeight; i.measured = true; }
      const s = i.pri >= 4 ? 1 : Math.min(1.08, Math.max(0.92, 1.25 - i.dist / 70));
      const w = i.w * s, h = i.h * s;
      let x = Math.min(Math.max(i.x, ax0 + w / 2), ax1 - w / 2);
      let y = Math.min(Math.max(i.y, ay0 + h), ay1);
      const rect: Rect = { l: x - w / 2, r: x + w / 2, t: y - h, b: y };
      let tries = 0;
      while (this.hit(rect) && tries < 6) {
        const o = this.hit(rect)!;
        const dy = rect.b - o.t + 3; // lift above the label it collides with
        y -= dy; rect.t -= dy; rect.b -= dy; tries++;
        if (y - h < ay0) break;
      }
      const stillHit = !!this.hit(rect);
      // Low-priority labels that cannot be placed cleanly are hidden rather than drawn over something.
      if ((stillHit && i.pri <= 2) || rect.t < ay0 - 1) { this.hide(i); if (i.arrow) i.arrow.style.display = 'none'; continue; }
      this.placed.push(rect);
      const far = Math.min(1, Math.max(0, (i.dist - 60) / 40));
      this.show(i, x, y, s, i.pri >= 4 ? 1 : 1 - far * 0.7);
      if (i.arrow) i.arrow.style.display = 'none';
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
  }
}

interface Burst { pts: THREE.Points; vel: Float32Array; life: number; gravity: number }

/** Pooled particle bursts (bloom, pollen, bug scatter) and rain showers. */
export class Particles {
  private bursts: Burst[] = [];
  private rain: { pts: THREE.Points; until: number }[] = [];
  reducedMotion = false;
  constructor(private scene: THREE.Scene) {}

  burst(at: THREE.Vector3, color: number, count = 36, speed = 2.2, gravity = 4) {
    if (this.reducedMotion) count = Math.min(count, 8);
    const pos = new Float32Array(count * 3), vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos.set([at.x, at.y, at.z], i * 3);
      const a = (i * 2.399963) % (Math.PI * 2), up = 0.5 + ((i * 37) % 10) / 10;
      vel.set([Math.cos(a) * speed * 0.5 * up, speed * up, Math.sin(a) * speed * 0.5 * up], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 0.14, transparent: true, depthWrite: false }));
    this.scene.add(pts);
    this.bursts.push({ pts, vel, life: 1.4, gravity });
  }

  shower(center: THREE.Vector3, w: number, d: number, ms = 2800) {
    if (this.reducedMotion) return;
    const n = 220, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([center.x + (Math.random() - 0.5) * w, Math.random() * 5, center.z + (Math.random() - 0.5) * d], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9cc9ee, size: 0.09, transparent: true, opacity: 0.8, depthWrite: false }));
    this.scene.add(pts);
    this.rain.push({ pts, until: performance.now() + ms });
  }

  update(dt: number) {
    for (const b of [...this.bursts]) {
      b.life -= dt;
      const p = b.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        b.vel[i * 3 + 1]! -= b.gravity * dt;
        p.setXYZ(i, p.getX(i) + b.vel[i * 3]! * dt, Math.max(0.02, p.getY(i) + b.vel[i * 3 + 1]! * dt), p.getZ(i) + b.vel[i * 3 + 2]! * dt);
      }
      p.needsUpdate = true;
      (b.pts.material as THREE.PointsMaterial).opacity = Math.max(0, b.life / 1.4);
      if (b.life <= 0) { this.scene.remove(b.pts); b.pts.geometry.dispose(); (b.pts.material as THREE.Material).dispose(); this.bursts.splice(this.bursts.indexOf(b), 1); }
    }
    const now = performance.now();
    for (const r of [...this.rain]) {
      const p = r.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { let y = p.getY(i) - 9 * dt; if (y < 0) y += 5; p.setY(i, y); }
      p.needsUpdate = true;
      if (now > r.until) { this.scene.remove(r.pts); r.pts.geometry.dispose(); (r.pts.material as THREE.Material).dispose(); this.rain.splice(this.rain.indexOf(r), 1); }
    }
  }
  clear() {
    for (const b of this.bursts) this.scene.remove(b.pts);
    for (const r of this.rain) this.scene.remove(r.pts);
    this.bursts = []; this.rain = [];
  }
}
