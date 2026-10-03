import * as THREE from 'three';

/** HTML labels / speech bubbles pinned to world positions. */
export class Labels {
  private items = new Set<{ el: HTMLElement; pos: () => THREE.Vector3 | undefined; until: number }>();
  constructor(private host: HTMLElement, private camera: THREE.Camera) {}

  /** `lines` makes a titled list (title = text); used by the botanist's verdict. */
  add(text: string, pos: () => THREE.Vector3 | undefined, cls = 'label', ttlMs = Infinity, lines?: string[]): HTMLElement {
    const el = document.createElement('div');
    el.className = cls;
    if (lines && lines.length) {
      const t = document.createElement('strong'); t.textContent = text; el.appendChild(t);
      const ul = document.createElement('ul');
      for (const l of lines) { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); }
      el.appendChild(ul);
    } else el.textContent = text;
    this.host.appendChild(el);
    this.items.add({ el, pos, until: ttlMs === Infinity ? Infinity : performance.now() + ttlMs });
    return el;
  }
  remove(el: HTMLElement) { for (const i of this.items) if (i.el === el) { el.remove(); this.items.delete(i); } }

  update(width: number, height: number) {
    const now = performance.now();
    const v = new THREE.Vector3();
    for (const i of this.items) {
      const p = i.pos();
      if (now > i.until || !p) { if (now > i.until) { i.el.remove(); this.items.delete(i); } else i.el.style.display = 'none'; continue; }
      v.copy(p).project(this.camera);
      if (v.z > 1) { i.el.style.display = 'none'; continue; }
      i.el.style.display = '';
      i.el.style.transform = `translate(-50%,-100%) translate(${((v.x + 1) / 2) * width}px,${((1 - v.y) / 2) * height}px)`;
    }
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
