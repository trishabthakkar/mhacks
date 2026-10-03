import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const geo = {
  sphere: new THREE.SphereGeometry(1, 12, 9),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cone: new THREE.ConeGeometry(1, 1, 8),
};

const cache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string | number, opts: { opacity?: number; emissive?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.opacity ?? 1}|${opts.emissive ?? 0}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, flatShading: true, roughness: 0.85, metalness: 0,
      transparent: opts.opacity !== undefined && opts.opacity < 1, opacity: opts.opacity ?? 1,
      emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissive ? 0.6 : 0,
    });
    cache.set(key, m);
  }
  return m;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Stable per-path flower color. */
export function flowerColor(path: string): THREE.Color {
  const h = hashString(path);
  return new THREE.Color().setHSL(((h % 360) / 360), 0.7, 0.62);
}

export function mesh(g: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.scale.set(sx, sy, sz); o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

/**
 * Bake every static mesh under `root` into one mesh per material (fewer draw calls). Meshes flagged
 * `userData.keep`, instanced meshes and anything `skip` rejects stay as they are. `root` must sit at the origin.
 */
export function mergeByMaterial(root: THREE.Object3D, skip: (o: THREE.Mesh) => boolean = () => false) {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const doomed: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || m.userData.keep || skip(m) || Array.isArray(m.material)) return;
    const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    const list = groups.get(m.material); if (list) list.push(g); else groups.set(m.material, [g]);
    doomed.push(m);
  });
  for (const m of doomed) m.parent?.remove(m);
  for (const [material, list] of groups) {
    const merged = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    for (const g of list) g.dispose();
    if (!merged) continue;
    const out = new THREE.Mesh(merged, material);
    out.castShadow = true; out.receiveShadow = true;
    root.add(out);
  }
}
