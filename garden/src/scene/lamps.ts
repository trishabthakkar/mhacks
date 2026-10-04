// The garden's night lights: lantern posts with a little housing (instanced), warm panes that bloom, a soft halo around
// each lantern, a wide gentle pool of light on the ground, and a handful of real point lights (arch, shed, a corner).
// Everything fades with lampLevel; hidden by day.
import * as THREE from 'three';
import type { Lamp } from '../lamps.ts';
import { geo } from './materials.ts';
import { PALETTE } from './palette.ts';

const WARM = 0xffcf7a, MAX_REAL = 4;
const height = (l: Lamp) => (l.kind === 'path' ? 0.55 : l.kind === 'arch' ? 2.2 : 1.35);
const size = (l: Lamp) => (l.kind === 'path' ? 0.7 : 1);

/** A radial falloff with no visible edge: light fades smoothly to nothing (a hard-ish disc read as a sticker). */
function softTexture(peak: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null; // node tests: no canvas
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!, grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (let i = 0; i <= 10; i++) { const t = i / 10, a = peak * Math.pow(1 - t, 2.2); grd.addColorStop(t, `rgba(255,${Math.round(200 - 30 * t)},${Math.round(120 - 50 * t)},${a.toFixed(3)})`); }
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class GardenLamps {
  readonly group = new THREE.Group();
  private posts?: THREE.InstancedMesh;
  private panes?: THREE.InstancedMesh;
  private roofs?: THREE.InstancedMesh;
  private glows?: THREE.InstancedMesh;
  private halos?: THREE.Points;
  private lights: THREE.PointLight[] = [];
  private postMat = new THREE.MeshStandardMaterial({ color: PALETTE.woodDark, flatShading: true, roughness: 0.9 });
  private roofMat = new THREE.MeshStandardMaterial({ color: '#3b2f28', flatShading: true, roughness: 0.7, metalness: 0.2 });
  private paneMat = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: WARM, emissiveIntensity: 0, roughness: 0.4 });
  private glowMat = new THREE.MeshBasicMaterial({ map: softTexture(0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false });
  private haloMat = new THREE.PointsMaterial({ map: softTexture(0.9), size: 1.0, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false });
  private glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private roofGeo = new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4); // a little four-sided lantern roof
  private level = -1;

  constructor(scene: THREE.Scene, private quality: 'low' | 'high') {
    this.group.visible = false; scene.add(this.group);
    if (quality !== 'low') for (let i = 0; i < MAX_REAL; i++) {
      const p = new THREE.PointLight(WARM, 0, 10, 2); p.visible = false; this.lights.push(p); this.group.add(p);
    }
  }

  rebuild(lamps: Lamp[]) {
    for (const m of [this.posts, this.panes, this.roofs, this.glows]) if (m) { this.group.remove(m); m.dispose(); }
    if (this.halos) { this.group.remove(this.halos); this.halos.geometry.dispose(); }
    const n = lamps.length, d = new THREE.Object3D(), hi = this.quality !== 'low';
    this.posts = new THREE.InstancedMesh(geo.cyl, this.postMat, n);
    this.panes = new THREE.InstancedMesh(geo.box, this.paneMat, n);
    this.roofs = new THREE.InstancedMesh(this.roofGeo, this.roofMat, n);
    this.glows = new THREE.InstancedMesh(this.glowGeo, this.glowMat, hi ? n : 0);
    const halo = new Float32Array(n * 3);
    lamps.forEach((l, i) => {
      const h = height(l), s = size(l);
      d.rotation.set(0, 0, 0);
      d.position.set(l.x, h / 2, l.z); d.scale.set(0.055, h, 0.055); d.updateMatrix(); this.posts!.setMatrixAt(i, d.matrix);
      d.position.set(l.x, h + 0.11 * s, l.z); d.scale.set(0.17 * s, 0.22 * s, 0.17 * s); d.updateMatrix(); this.panes!.setMatrixAt(i, d.matrix);
      d.position.set(l.x, h + 0.29 * s, l.z); d.scale.set(0.2 * s, 0.15 * s, 0.2 * s); d.updateMatrix(); this.roofs!.setMatrixAt(i, d.matrix);
      if (hi) { const r = l.kind === 'path' ? 2.0 : 3.2; /* small: transparent overdraw stays cheap; the falloff keeps it soft */ d.position.set(l.x, 0.03, l.z); d.scale.set(r, 1, r); d.updateMatrix(); this.glows!.setMatrixAt(i, d.matrix); }
      halo.set([l.x, h + 0.11 * s, l.z], i * 3);
    });
    this.posts.castShadow = true; this.roofs.castShadow = true;
    this.glows.renderOrder = 1;
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(halo, 3));
    this.halos = new THREE.Points(hg, this.haloMat); this.halos.renderOrder = 2; this.halos.frustumCulled = false;
    this.group.add(this.posts, this.panes, this.roofs, this.glows); if (hi) this.group.add(this.halos); // low quality: no halos
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
    this.paneMat.emissiveIntensity = 1.8 * l;
    this.glowMat.opacity = 0.85 * l;
    this.haloMat.opacity = 0.75 * l;
    for (const p of this.lights) p.intensity = 7 * l;
  }
}
