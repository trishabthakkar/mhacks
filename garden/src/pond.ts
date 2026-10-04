// Pure: the pond is the shared repo. Commits flow into it; each commit from the last day floats as a lily pad.
import type { ActivityView } from '../../shared/types.ts';
import type { GardenLayout } from './layout.ts';

export const MAX_PADS = 14;
const DAY = 24 * 3_600_000, PAD = 0.32;

/** Where the pond sits: to the right of the beds, in the upper half of the garden (the botanist waits front-right). */
export function pondSpot(l: GardenLayout): { x: number; z: number; r: number } {
  const r = Math.max(3, Math.min(5.5, l.depth / 4));
  return { x: Math.max(6, l.width / 2) + 2.6 + r, z: -l.depth / 4, r };
}

const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Lily pads for the newest commits of the last day, as offsets from the pond centre. A pad's place depends only on its commit. */
export function lilyPads(activity: ActivityView[], now: number, r: number): { id: number; x: number; z: number; size: number }[] {
  return activity.filter((a) => a.kind === 'commit' && now - a.at <= DAY)
    .sort((a, b) => b.at - a.at || b.id - a.id).slice(0, MAX_PADS)
    .map((a) => {
      const size = PAD * (0.8 + hash(a.id, 3) * 0.5), ang = hash(a.id, 1) * Math.PI * 2;
      const rad = Math.sqrt(hash(a.id, 2)) * (r * 0.9 - size);
      return { id: a.id, x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, size };
    });
}
