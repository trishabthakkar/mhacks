// Pure: the white picket fence around the whole garden (with a gate on the front lane) and the name on the arch.
import type { GardenSnapshot } from '../../shared/types.ts';
import { layoutPaths, type GardenLayout } from './layout.ts';
import { BANK, pondSpot } from './pond.ts';

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface GardenFence { rect: Rect; gate: { x: number; z: number; w: number }; pickets: Array<{ x: number; z: number; ry: number }> }

export const PICKET_STEP = 0.55;
const GATE_W = 3.6;
export const inRect = (r: Rect, x: number, z: number, margin = 0) => x >= r.minX + margin && x <= r.maxX - margin && z >= r.minZ + margin && z <= r.maxZ - margin;

/** Encloses beds, paths, the pond, the shed (behind the beds), the bench and well (front-left) and the gardeners' lane. */
export function gardenFence(l: GardenLayout, frontZ: number): GardenFence {
  const halfW = Math.max(6, l.width / 2), halfD = Math.max(4, l.depth / 2), ps = pondSpot(l), pr = ps.r * BANK;
  let minX = -halfW - 7, maxX = Math.max(halfW + 5.5, ps.x + pr + 1.5), minZ = Math.min(-halfD - 8, ps.z - pr - 1.5), maxZ = Math.max(frontZ + 3.2, ps.z + pr + 1.5);
  for (const p of layoutPaths(l)) { minX = Math.min(minX, p.x - p.w / 2 - 1.5); maxX = Math.max(maxX, p.x + p.w / 2 + 1.5); }
  const rect = { minX, maxX, minZ, maxZ }, gate = { x: Math.round((minX + maxX) / 2 * 100) / 100, z: maxZ, w: GATE_W }; // centred on the front
  const pickets: GardenFence['pickets'] = [];
  const side = (x0: number, z0: number, x1: number, z1: number, ry: number, front = false) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / PICKET_STEP));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      if (front && Math.abs(x - gate.x) < gate.w / 2) continue;
      pickets.push({ x, z, ry });
    }
  };
  side(minX, minZ, maxX, minZ, 0); side(minX, maxZ, maxX, maxZ, 0, true);
  side(minX, minZ, minX, maxZ, Math.PI / 2); side(maxX, minZ, maxX, maxZ, Math.PI / 2);
  return { rect, gate, pickets };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** The name painted on the arch: ?repo=, else the newest test run's repo folder, else the db name without "sprout-". */
export function repoName(q: URLSearchParams, s: GardenSnapshot, db: string): string {
  const fromParam = q.get('repo')?.trim();
  if (fromParam) return clip(fromParam, 28);
  const run = [...s.testRuns].sort((a, b) => b.at - a.at).find((t) => t.repo.trim());
  if (run) {
    const last = run.repo.trim().replace(/\.git$/, '').split(/[/:\\]/).filter(Boolean).pop();
    if (last) return clip(last, 28);
  }
  const d = db.replace(/^sprout-/, '').trim();
  return d ? clip(d, 28) : 'our garden';
}

/** The smaller line under the name. */
export function signLine(s: GardenSnapshot): string {
  const online = s.members.filter((m) => m.online).length;
  const today = s.plants.filter((p) => p.stage === 'bloom' && p.lastBloomAt !== undefined && s.at - p.lastBloomAt < 86_400_000).length;
  return `${online} gardener${online === 1 ? '' : 's'} · ${s.plants.length} plant${s.plants.length === 1 ? '' : 's'} · ${today} 🌸 today`;
}

type Box = { x: number; z: number; w: number; d: number };
const BORDER_IN = 0.35, BORDER_D = 0.9, CELL = 0.5, MIN_STRIP = 1.5, GAP = 0.4;

/**
 * Cottage flower borders along the inside of the fence: a 0.9 m strip on each side, broken wherever something stands
 * (gate, shed, lane, paths, the pond...), with no stubs shorter than 1.5 m. Corners are left to the side strips.
 */
export function borderStrips(r: Rect, gate: { x: number; w: number }, boxes: Box[], circles: { x: number; z: number; r: number }[] = []): Box[] {
  const out: Box[] = [];
  const blocked = (c: Box, front: boolean) =>
    (front && Math.abs(c.x - gate.x) < gate.w / 2 + 0.9) ||
    boxes.some((b) => Math.abs(c.x - b.x) < (c.w + b.w) / 2 + GAP && Math.abs(c.z - b.z) < (c.d + b.d) / 2 + GAP) ||
    circles.some((k) => Math.hypot(Math.max(Math.abs(k.x - c.x) - c.w / 2, 0), Math.max(Math.abs(k.z - c.z) - c.d / 2, 0)) < k.r + GAP);
  const run = (along: 'x' | 'z', fixed: number, from: number, to: number, front = false) => {
    let start: number | null = null;
    const flush = (end: number) => {
      if (start !== null && end - start >= MIN_STRIP) out.push(along === 'x' ? { x: (start + end) / 2, z: fixed, w: end - start, d: BORDER_D } : { x: fixed, z: (start + end) / 2, w: BORDER_D, d: end - start });
      start = null;
    };
    for (let a = from; a + CELL <= to + 1e-9; a += CELL) {
      const c = along === 'x' ? { x: a + CELL / 2, z: fixed, w: CELL, d: BORDER_D } : { x: fixed, z: a + CELL / 2, w: BORDER_D, d: CELL };
      if (blocked(c, front)) flush(a); else if (start === null) start = a;
    }
    flush(Math.floor((to - from) / CELL) * CELL + from);
  };
  const inset = BORDER_IN + BORDER_D / 2, corner = BORDER_IN + BORDER_D;
  run('x', r.minZ + inset, r.minX + corner, r.maxX - corner);        // back
  run('x', r.maxZ - inset, r.minX + corner, r.maxX - corner, true); // front, gate left open
  run('z', r.minX + inset, r.minZ + BORDER_IN, r.maxZ - BORDER_IN);   // left
  run('z', r.maxX - inset, r.minZ + BORDER_IN, r.maxZ - BORDER_IN);   // right
  return out.map((b) => ({ x: Math.round(b.x * 100) / 100, z: Math.round(b.z * 100) / 100, w: Math.round(b.w * 100) / 100, d: Math.round(b.d * 100) / 100 }));
}
