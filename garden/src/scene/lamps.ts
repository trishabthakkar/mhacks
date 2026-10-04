// The garden's night lights: lantern posts (instanced), warm bulbs that bloom, a soft pool of light on the ground under
// each, and a handful of real point lights (arch, shed, a corner). Everything fades with lampLevel; hidden by day.
import * as THREE from 'three';
import type { Lamp } from '../lamps.ts';
import { geo } from './materials.ts';
import { PALETTE } from './palette.ts';

const WARM = 0xffcf7a, MAX_REAL = 4;
const height = (l: Lamp) => (l.kind === 'path' ? 0.55 : l.kind === 'arch' ? 2.2 : 1.35);

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,214,140,0.9)'); grd.addColorStop(0.45, 'rgba(255,190,100,0.35)'); grd.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class GardenLamps {
  readonly group = new THREE.Group();
  private posts?: THREE.InstancedMesh;
  private bulbs?: THREE.InstancedMesh;
  private glows?: THREE.InstancedMesh;
  private lights: THREE.PointLight[] = [];
  private postMat = new THREE.MeshStandardMaterial({ color: PALETTE.woodDark, flatShading: true, roughness: 0.9 });
  private bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: WARM, emissiveIntensity: 0 });
  private glowMat = new THREE.MeshBasicMaterial({ map: typeof document === 'undefined' ? null : glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  private glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private level = -1;

  constructor(scene: THREE.Scene, private quality: 'low' | 'high') {
    this.group.visible = false; scene.add(this.group);
    if (quality !== 'low') for (let i = 0; i < MAX_REAL; i++) {
      const p = new THREE.PointLight(WARM, 0, 9, 2); p.visible = false; this.lights.push(p); this.group.add(p);
    }
  }

  rebuild(lamps: Lamp[]) {
    for (const m of [this.posts, this.bulbs, this.glows]) if (m) { this.group.remove(m); m.dispose(); }
    const n = lamps.length, d = new THREE.Object3D();
    this.posts = new THREE.InstancedMesh(geo.cyl, this.postMat, n);
    this.bulbs = new THREE.InstancedMesh(geo.sphere, this.bulbMat, n);
    this.glows = new THREE.InstancedMesh(this.glowGeo, this.glowMat, this.quality === 'low' ? 0 : n);
    lamps.forEach((l, i) => {
      const h = height(l);
      d.position.set(l.x, h / 2, l.z); d.scale.set(0.06, h, 0.06); d.updateMatrix(); this.posts!.setMatrixAt(i, d.matrix);
      d.position.set(l.x, h + 0.09, l.z); d.scale.setScalar(l.kind === 'path' ? 0.09 : 0.13); d.updateMatrix(); this.bulbs!.setMatrixAt(i, d.matrix);
      if (this.quality !== 'low') { const r = l.kind === 'path' ? 2.2 : 3.4; d.position.set(l.x, 0.04, l.z); d.scale.set(r, 1, r); d.updateMatrix(); this.glows!.setMatrixAt(i, d.matrix); }
    });
    this.posts.castShadow = true;
    this.glows.renderOrder = 1;
    this.group.add(this.posts, this.bulbs, this.glows);
    const real = lamps.filter((l) => l.real).slice(0, this.lights.length);
    this.lights.forEach((p, i) => { const l = real[i]; p.visible = !!l; if (l) p.position.set(l.x, height(l) + 0.3, l.z); });
    const lv = this.level; this.level = -1; this.setLevel(Math.max(0, lv));
  }

  private warmed = false;
  /**
   * Compile the scene once with the lamp lights on, so switching them on at dusk reuses the cached shaders instead of
   * recompiling every lit material mid-demo. Call after the first rebuild; it runs once.
   */
  prewarm(renderer: Pick<THREE.WebGLRenderer, 'compile'>, camera: THREE.Camera) {
    if (this.warmed || !this.lights.some((p) => p.visible)) return;
    this.warmed = true;
    const was = this.group.visible;
    this.group.visible = true;
    try { renderer.compile(this.group.parent ?? this.group, camera); } catch { /* best effort */ }
    this.group.visible = was;
  }

  /** 0 = day (hidden) … 1 = full night. */
  setLevel(l: number) {
    if (Math.abs(l - this.level) < 0.005) return;
    this.level = l;
    this.group.visible = l > 0.01;
    this.bulbMat.emissiveIntensity = 2.2 * l;
    this.glowMat.opacity = 0.8 * l;
    for (const p of this.lights) p.intensity = 6 * l;
  }
}
