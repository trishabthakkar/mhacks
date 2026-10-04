import * as THREE from 'three';
import type { TaskModel } from '../tasks.ts';
import type { TaskPlantLayout } from '../layout.ts';
import type { Labels } from './effects.ts';
import { geo, mat, mesh } from './materials.ts';
import { iconMat } from './actors.ts';

interface TP { id: number; g: THREE.Group; key: string; label: HTMLElement; labelText: string; hand?: THREE.Sprite; x: number; z: number; status: string; born: number }
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One tall plant per task: owner-coloured pot, leaves = paths, buds = checklist, bloom when certified, droop + ✋ when blocked. */
export class TaskPlants {
  private items = new Map<number, TP>();
  readonly group = new THREE.Group();
  constructor(scene: THREE.Scene, private labels: Labels) { scene.add(this.group); }

  posOf(id: number) { const t = this.items.get(id); return t ? new THREE.Vector3(t.x, 0, t.z) : undefined; }

  sync(models: TaskModel[], layout: TaskPlantLayout[], now: number) {
    const pos = new Map(layout.map((p) => [p.id, p]));
    for (const [id, t] of this.items) if (!pos.has(id) || !models.some((m) => m.id === id)) this.drop(id, t);
    for (const m of models) {
      const p = pos.get(m.id); if (!p) continue;
      const key = JSON.stringify([m.status, m.color, m.items.map((i) => i.state), Math.min(8, m.paths.length), m.roadblocks.length > 0]);
      let t = this.items.get(m.id);
      if (!t) {
        const at = new THREE.Vector3();
        const label = this.labels.add('', () => at.set(t!.x, 3.1, t!.z), 'label task');
        t = { id: m.id, g: new THREE.Group(), key: '', label, labelText: '', x: p.x, z: p.z, status: m.status, born: now };
        this.items.set(m.id, t); this.group.add(t.g);
      }
      t.x = p.x; t.z = p.z; t.g.position.set(p.x, 0, p.z); t.status = m.status;
      const text = clip(m.title, 24); // the pot colour already says whose it is
      if (text !== t.labelText) { t.labelText = text; this.labels.setText(t.label, text); t.label.style.borderColor = m.color; }
      t.label.classList.toggle('done', m.status === 'done'); // done tasks show their flower, not a label
      if (key !== t.key) { t.key = key; this.build(t, m); }
    }
  }

  private build(t: TP, m: TaskModel) {
    for (const c of [...t.g.children]) { t.g.remove(c); }
    const owner = mat(m.color), stem = mat('#3f7d3a'), leaf = mat('#58a24a');
    t.g.add(mesh(geo.cyl, owner, 0.55, 0.45, 0.55, 0, 0.22, 0));                    // pot in the owner's colour
    t.g.add(mesh(geo.cyl, stem, 0.08, 2.2, 0.08, 0, 1.45, 0));                       // tall stem
    const leaves = Math.max(2, Math.min(8, m.paths.length));
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2, y = 0.8 + (i / leaves) * 1.4;
      const l = mesh(geo.sphere, leaf, 0.42, 0.07, 0.18, Math.cos(a) * 0.3, y, Math.sin(a) * 0.3); l.rotation.y = -a; l.rotation.z = 0.35; t.g.add(l);
    }
    const n = Math.min(m.items.length, 12);
    for (let i = 0; i < n; i++) {                                                        // buds spiral up the top third
      const it = m.items[i]!, a = i * 2.4, y = 1.9 + (i / Math.max(1, n)) * 0.7;
      const c = it.state === 'completed' ? mat('#ffffff', { emissive: 0x222222 }) : it.state === 'in_progress' ? mat('#ffd23f', { emissive: 0x6b4f00 }) : mat('#9ac26b');
      const s = it.state === 'completed' ? 0.2 : 0.14;
      t.g.add(mesh(geo.sphere, c, s, s, s, Math.cos(a) * 0.32, y, Math.sin(a) * 0.32));
    }
    if (m.status === 'done') {                                                           // certified: big bloom on top
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; t.g.add(mesh(geo.sphere, owner, 0.32, 0.08, 0.2, Math.cos(a) * 0.36, 2.65, Math.sin(a) * 0.36)); }
      t.g.add(mesh(geo.sphere, mat('#f2c230'), 0.24, 0.18, 0.24, 0, 2.68, 0));
    }
    t.hand = undefined;
    if (m.status === 'blocked' || m.roadblocks.length) {
      t.hand = new THREE.Sprite(iconMat('✋')); t.hand.scale.setScalar(0.6); t.hand.position.set(0.55, 2.6, 0); t.g.add(t.hand);
    }
  }

  /** Sway; blocked tasks droop. */
  update(time: number, mo: number) {
    for (const t of this.items.values()) {
      const droop = t.status === 'blocked' ? 0.28 : 0;
      t.g.rotation.z = droop + Math.sin(time * 1.1 + t.id) * 0.03 * mo;
      const k = Math.min(1, (time - t.born) / 0.8); t.g.scale.setScalar(0.2 + 0.8 * (1 - Math.pow(1 - k, 3)));
    }
  }

  /** Task id under the ray, if any. */
  pick(ray: THREE.Raycaster): number | undefined {
    const hit = ray.intersectObjects(this.group.children, true)[0];
    if (!hit) return undefined;
    for (const t of this.items.values()) { let o: THREE.Object3D | null = hit.object; while (o) { if (o === t.g) return t.id; o = o.parent; } }
    return undefined;
  }

  private drop(id: number, t: TP) { this.group.remove(t.g); this.labels.remove(t.label); this.items.delete(id); }
}
