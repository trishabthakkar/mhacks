// Pure: the pond is the shared repo. Commits flow into it; each commit from the last day floats as a lily pad.
import type { ActivityView } from '../../shared/types.ts';
import { layoutPaths, type GardenLayout, type PathLayout } from './layout.ts';

export const MAX_PADS = 14;
const DAY = 24 * 3_600_000, PAD = 0.32;

/** The bank reaches this far out, in pond radii (the outline wobbles up to ~18% and the bank is 1.18x the water). */
export const BANK = 1.42;

/** Where the pond sits: right of the beds, level with the middle row's path, so that path can lead to the water. */
export function pondSpot(l: GardenLayout): { x: number; z: number; r: number } {
  const r = Math.max(3, Math.min(5.5, l.depth / 4));
  const rows = layoutPaths(l).filter((p) => p.w > p.d);
  const right = Math.max(Math.max(6, l.width / 2), ...rows.map((p) => p.x + p.w / 2));
  const z = rows.length ? rows[Math.floor((rows.length - 1) / 2)]!.z : 0;
  return { x: right + 2.2 + r * BANK, z, r };
}

/** The gravel path from that row's path to the water's edge (a dock continues it over the water). */
export function pondLink(l: GardenLayout): PathLayout {
  const p = pondSpot(l);
  const row = layoutPaths(l).find((q) => q.w > q.d && q.z === p.z);
  const x0 = row ? row.x + row.w / 2 - 0.2 : p.x - p.r * BANK - 2, x1 = p.x - p.r;
  return { x: (x0 + x1) / 2, z: p.z, w: x1 - x0, d: 2.2 };
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
