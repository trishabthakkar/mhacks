// Pure: what is under the pointer. The world fills a PickScene (characters projected to the screen, everything else
// on the ground) and passes raycast results for the few real meshes (task pots, shed, arch); this picks by priority.

export type Pick =
  | { kind: 'plant'; key: string } | { kind: 'bed'; key: string } | { kind: 'member'; key: string }
  | { kind: 'task'; key: number } | { kind: 'commit'; key: number }
  | { kind: 'botanist' } | { kind: 'pond' } | { kind: 'garden' } | { kind: 'shed' };

export interface PickScene {
  /** Gardeners and the botanist as screen-space circles (px); depth = distance to the camera. */
  people: Array<{ pick: Pick; sx: number; sy: number; r: number; depth: number; at?: { x: number; z: number } }>;
  plants: Array<{ path: string; x: number; z: number; size: number }>;
  commits: Array<{ id: number; x: number; z: number; size: number }>;
  pond?: { x: number; z: number; r: number };
  beds: Array<{ name: string; x: number; z: number; w: number; d: number }>;
}
export interface PickInput {
  screen: { x: number; y: number };
  /** Where the pointer ray meets the plant-height plane, or null (pointing at the sky). */
  ground: { x: number; z: number } | null;
  task?: number; shed: boolean; arch: boolean;
  /** The plant column the pointer ray enters first (see pickColumn); beats the ground-distance plant search. */
  plant?: string;
}

export interface Column { path: string; x: number; z: number; r: number; y0: number; y1: number }
type V3 = { x: number; y: number; z: number };
/** The plant the ray enters first, each plant a vertical cylinder from its soil (y0) to its top (y1). */
export function pickColumn(o: V3, d: V3, cols: Column[]): string | undefined {
  let best: string | undefined, bt = Infinity;
  const a = d.x * d.x + d.z * d.z;
  for (const c of cols) {
    const fx = o.x - c.x, fz = o.z - c.z;
    let t0 = -Infinity, t1 = Infinity;
    if (a < 1e-12) { if (fx * fx + fz * fz > c.r * c.r) continue; }
    else {
      const b = 2 * (fx * d.x + fz * d.z), cc = fx * fx + fz * fz - c.r * c.r, disc = b * b - 4 * a * cc;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc); t0 = (-b - sq) / (2 * a); t1 = (-b + sq) / (2 * a);
    }
    if (Math.abs(d.y) > 1e-12) {
      let ya = (c.y0 - o.y) / d.y, yb = (c.y1 - o.y) / d.y; if (ya > yb) [ya, yb] = [yb, ya];
      t0 = Math.max(t0, ya); t1 = Math.min(t1, yb);
    } else if (o.y < c.y0 || o.y > c.y1) continue;
    const t = Math.max(t0, 0);
    if (t1 < t) continue;
    if (t < bt) { bt = t; best = c.path; }
  }
  return best;
}

export const CLICK_PX = 5;

type Person = PickScene['people'][number];
/** The person circle under the pointer, nearest to the camera first (its `at` is where to draw their ring). */
export function personAt(screen: { x: number; y: number }, people: Person[]): Person | undefined {
  let best: Person | undefined;
  for (const p of people) if (Math.hypot(screen.x - p.sx, screen.y - p.sy) <= p.r && (!best || p.depth < best.depth)) best = p;
  return best;
}
export const isClick = (down: { x: number; y: number } | undefined, up: { x: number; y: number }) =>
  !!down && Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_PX;

const plantR = (size: number) => Math.max(0.6, size * 0.55);

export function pickAt(inp: PickInput, sc: PickScene): Pick | null {
  const person = personAt(inp.screen, sc.people);
  if (person) return person.pick;
  if (inp.task !== undefined) return { kind: 'task', key: inp.task };
  if (inp.plant !== undefined) return { kind: 'plant', key: inp.plant };
  const g = inp.ground;
  if (g) {
    let plant: string | undefined, pd = Infinity;
    for (const p of sc.plants) {
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      if (d <= plantR(p.size) && d < pd) { pd = d; plant = p.path; }
    }
    if (plant !== undefined) return { kind: 'plant', key: plant };
    for (const c of sc.commits) if (Math.hypot(g.x - c.x, g.z - c.z) <= c.size + 0.15) return { kind: 'commit', key: c.id };
    if (sc.pond && Math.hypot(g.x - sc.pond.x, g.z - sc.pond.z) <= sc.pond.r) return { kind: 'pond' };
    for (const b of sc.beds) if (Math.abs(g.x - b.x) <= b.w / 2 && Math.abs(g.z - b.z) <= b.d / 2) return { kind: 'bed', key: b.name };
  }
  if (inp.shed) return { kind: 'shed' };
  if (inp.arch) return { kind: 'garden' };
  return null;
}

const KEYED = new Set(['plant', 'bed', 'member', 'task', 'commit']);
const NUMERIC = new Set(['task', 'commit']);
const BARE = new Set(['botanist', 'pond', 'garden', 'shed']);

/** A stable string for a pick ("plant:src/a.ts", "pond"), used in data attributes and comparisons. */
export function pickKey(p: Pick): string { return 'key' in p ? `${p.kind}:${p.key}` : p.kind; }
export function parsePick(s: string): Pick | null {
  const i = s.indexOf(':');
  const kind = i < 0 ? s : s.slice(0, i), rest = i < 0 ? '' : s.slice(i + 1);
  if (BARE.has(kind) && i < 0) return { kind } as Pick;
  if (!KEYED.has(kind) || !rest) return null;
  if (NUMERIC.has(kind)) { const n = Number(rest); return Number.isFinite(n) ? ({ kind, key: n } as Pick) : null; }
  return { kind, key: rest } as Pick;
}
export const samePick = (a: Pick | null, b: Pick | null) => !!a && !!b && pickKey(a) === pickKey(b);
