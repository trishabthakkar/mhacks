// Pure: early collision warnings. Two teammates whose current work touches the same files are flagged before
// anyone hits a fence (Sprout's point is preventing merge conflicts, not just reporting them).
import type { GardenSnapshot } from '../../shared/types.ts';
import { botFor } from './bots.ts';
import { currentTaskOf } from './tasks.ts';

export interface Overlap { a: string; b: string; path: string }

/** If two repo paths overlap (same file, or a folder "x/" containing the other), the more specific one. */
export function touches(p: string, q: string): string | undefined {
  if (p === q) return p;
  if (p.endsWith('/') && q.startsWith(p)) return q;
  if (q.endsWith('/') && p.startsWith(q)) return p;
  return undefined;
}

/** What a member is working on now: their current task's paths plus the file their awake Claude is on. */
function workSet(s: GardenSnapshot, handle: string): string[] {
  const set = [...(currentTaskOf(s, handle)?.paths ?? [])];
  const { agent, asleep } = botFor(s, handle);
  if (!asleep && agent?.currentPath && !set.includes(agent.currentPath)) set.push(agent.currentPath);
  return set;
}

/** Each pair of present teammates whose work overlaps, once, at the most specific shared path. */
export function overlaps(s: GardenSnapshot): Overlap[] {
  const here = s.members.filter((m) => m.online && !m.paused).map((m) => ({ h: m.handle, w: workSet(s, m.handle) }));
  const out: Overlap[] = [];
  for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) {
    let best: string | undefined;
    for (const p of here[i]!.w) for (const q of here[j]!.w) { const t = touches(p, q); if (t && (!best || t.length > best.length)) best = t; }
    if (best) out.push({ a: here[i]!.h, b: here[j]!.h, path: best });
  }
  return out;
}
