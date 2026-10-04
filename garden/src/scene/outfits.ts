// Per-person looks, chosen by the person: a different Kenney model plus palette swaps.
// All Kenney models share one palette texture (colormap.png: 16 columns, a light band in
// rows 8-11 and a dark band in rows 12-15), so recolouring a part means moving its UVs to
// another column. Only the shading position inside the band is kept.
import * as THREE from 'three';

type Band = 'light' | 'dark';
interface Swap { bones: string[]; from: { col: number; band: Band }; to: { col: number; band: Band } }
interface Outfit { model: string; swaps: Swap[] }

const ARMS = ['arm-left', 'arm-right'];
const SKIN = { col: 15, band: 'dark' } as const;
const BLACK = { col: 1, band: 'dark' } as const;

export const OUTFITS: Record<string, Outfit> = {
  // Shriya: jeans, black halter-neck top, long black hair (the low-poly models have no curls;
  // female-f has the fullest hair and already wears jeans and a black top).
  shriya: {
    model: 'character-female-f',
    swaps: [
      { bones: ['head'], from: { col: 11, band: 'dark' }, to: { col: 0, band: 'dark' } }, // hair
      { bones: ['head'], from: { col: 13, band: 'dark' }, to: { col: 1, band: 'dark' } }, // hair, second tone
      { bones: ARMS, from: { col: 1, band: 'dark' }, to: SKIN }, // sleeves → bare arms (halter)
      { bones: ARMS, from: { col: 5, band: 'light' }, to: SKIN }, // wristband
      { bones: ['torso'], from: { col: 5, band: 'light' }, to: BLACK }, // yellow stripes
      { bones: ['torso'], from: { col: 7, band: 'dark' }, to: BLACK },
    ],
  },
};

/** The model a person picked, if any (else the hashed default applies). */
export function outfitModel(handle: string): string | undefined {
  return OUTFITS[handle]?.model;
}

const bandStart = (b: Band) => (b === 'light' ? 8 : 12);

/** Recolour a freshly cloned character for `handle`. Clones the geometry, so the cached model stays untouched. */
export function applyOutfit(root: THREE.Object3D, handle: string): void {
  const outfit = OUTFITS[handle];
  if (!outfit) return;
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const geo = mesh.geometry.clone();
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const idx = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
    const wt = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
    if (!uv || !idx || !wt) return;
    for (let i = 0; i < uv.count; i++) {
      let best = 0;
      for (let c = 1; c < 4; c++) if (wt.getComponent(i, c) > wt.getComponent(i, best)) best = c;
      const bone = mesh.skeleton.bones[idx.getComponent(i, best)]?.name ?? '';
      const u = uv.getX(i) * 16, v = uv.getY(i) * 16;
      const col = Math.floor(u), row = Math.floor(v);
      const band: Band = row >= 12 ? 'dark' : 'light';
      const s = outfit.swaps.find((w) => w.from.col === col && w.from.band === band && w.bones.includes(bone));
      if (!s) continue;
      uv.setXY(i, (s.to.col + (u - col)) / 16, (bandStart(s.to.band) + (v - bandStart(band))) / 16);
    }
    uv.needsUpdate = true;
    mesh.geometry = geo;
  });
}
