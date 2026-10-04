// Pure: what is under the pointer. The world fills a PickScene (characters projected to the screen, everything else
// on the ground) and passes raycast results for the few real meshes (task pots, shed, arch); this picks by priority.

export type Pick =
  | { kind: 'plant'; key: string } | { kind: 'bed'; key: string } | { kind: 'member'; key: string }
  | { kind: 'task'; key: number } | { kind: 'commit'; key: number }
  | { kind: 'botanist' } | { kind: 'pond' } | { kind: 'garden' } | { kind: 'shed' };

export interface PickScene {
  /** Gardeners and the botanist as screen-space circles (px); depth = distance to the camera. */
  people: Array<{ pick: Pick; sx: number; sy: number; r: number; depth: number }>;
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
}

export const CLICK_PX = 5;
export const isClick = (down: { x: number; y: number } | undefined, up: { x: number; y: number }) =>
  !!down && Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_PX;

const plantR = (size: number) => Math.max(0.6, size * 0.55);

export function pickAt(inp: PickInput, sc: PickScene): Pick | null {
  let best: { pick: Pick; depth: number } | undefined;
  for (const p of sc.people) {
    if (Math.hypot(inp.screen.x - p.sx, inp.screen.y - p.sy) <= p.r && (!best || p.depth < best.depth)) best = { pick: p.pick, depth: p.depth };
  }
  if (best) return best.pick;
  if (inp.task !== undefined) return { kind: 'task', key: inp.task };
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
