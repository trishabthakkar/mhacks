import * as THREE from 'three';
import type { PlantStage } from '../../../shared/types.ts';
import { flowerColor, geo, mat, mesh } from './materials.ts';

const STEM_H: Record<PlantStage, number> = { seed: 0, sprout: 0.35, growing: 0.8, bud: 0.95, bloom: 1.0, dormant: 0.55 };

export function buildPlant(stage: PlantStage, path: string, size: number): THREE.Group {
  const g = new THREE.Group();
  const dormant = stage === 'dormant';
  g.add(mesh(geo.sphere, mat('#6b4a2f'), 0.5 * size, 0.2 * size, 0.5 * size, 0, 0.04, 0));
  if (stage === 'seed') return g;

  const h = STEM_H[stage] * size;
  const stemM = mat(dormant ? '#8a8570' : '#3f7d3a');
  const leafM = mat(dormant ? '#a39f86' : stage === 'sprout' ? '#7fc36a' : '#58a24a');
  g.add(mesh(geo.cyl, stemM, 0.05 * size, h, 0.05 * size, 0, h / 2, 0));

  const leaves = stage === 'sprout' ? 2 : stage === 'growing' ? 5 : 4;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + 0.5;
    const y = h * (0.3 + 0.6 * ((i % 3) / 3));
    const leaf = mesh(geo.sphere, leafM, 0.3 * size, 0.06 * size, 0.14 * size, Math.cos(a) * 0.25 * size, y, Math.sin(a) * 0.25 * size);
    leaf.rotation.y = -a; leaf.rotation.z = 0.35;
    g.add(leaf);
  }
  if (stage === 'bud') g.add(mesh(geo.sphere, mat(dormant ? '#a39f86' : '#9ac26b'), 0.17 * size, 0.24 * size, 0.17 * size, 0, h + 0.1 * size, 0));
  if (stage === 'bloom') {
    const pm = mat(`#${flowerColor(path).getHexString()}`);
    const petals: THREE.Object3D[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const petal = mesh(geo.sphere, pm, 0.17 * size, 0.05 * size, 0.1 * size, Math.cos(a) * 0.2 * size, h + 0.05 * size, Math.sin(a) * 0.2 * size);
      petal.rotation.y = -a;
      petal.userData.base = petal.scale.clone();
      petals.push(petal);
      g.add(petal);
    }
    const center = mesh(geo.sphere, mat('#f2c230', { emissive: 0x3a2a00 }), 0.12 * size, 0.1 * size, 0.12 * size, 0, h + 0.07 * size, 0);
    center.userData.base = center.scale.clone();
    g.add(center);
    g.userData.petals = petals; g.userData.center = center;
  }
  return g;
}
