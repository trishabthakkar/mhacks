import type { ActivityKind, ActivityView, GardenSnapshot } from '../../../shared/types.ts';
import { sentence } from './sentences.ts';

/** Kinds worth speaking to a screen reader; reads, searches and prompts would just be noise. */
export const SPOKEN: ReadonlySet<ActivityKind> = new Set<ActivityKind>([
  'claim', 'release', 'blocked_edit', 'message_sent', 'message_delivered', 'message_acked', 'handoff_offered', 'handoff_accepted',
  'test_pass', 'test_fail', 'commit', 'certify_bloom', 'certify_refused', 'session_start',
]);

/** Pure: pick what to say from queued activity: at most `max`, newest wins, spoken kinds only. */
export function pickSpoken(queue: readonly ActivityView[], max = 3): string[] {
  return queue.filter((a) => SPOKEN.has(a.kind)).slice(-max).map(sentence);
}

/**
 * A persistent live region, written to at most once every `every` ms. Writing to a long-lived region (instead of
 * re-rendering the visible feed) is what makes screen readers announce the change.
 */
export function createAnnouncer(el: HTMLElement, every = 2500) {
  let queue: ActivityView[] = [];
  const timer = setInterval(() => {
    if (!queue.length) return;
    const lines = pickSpoken(queue);
    queue = [];
    if (lines.length) { el.textContent = ''; el.textContent = lines.join('. '); }
  }, every);
  return { push(a: ActivityView) { queue.push(a); if (queue.length > 30) queue.shift(); }, stop() { clearInterval(timer); } };
}

/** One sentence describing the whole garden, for the 3D view's text alternative. */
export function summarize(s: GardenSnapshot): string {
  const online = s.members.filter((m) => m.online).length;
  const working = s.agents.filter((a) => a.kind === 'claude' && a.status === 'working').length;
  const stages = new Map<string, number>();
  for (const p of s.plants) stages.set(p.stage, (stages.get(p.stage) ?? 0) + 1);
  const bugs = s.plants.reduce((n, p) => n + p.bugs, 0);
  const open = s.messages.filter((m) => m.status !== 'acked').length;
  const parts = [
    `${online} of ${s.members.length} gardeners online, ${working} agents working`,
    `${s.plants.length} plants${s.plants.length ? ` (${['bloom', 'bud', 'growing', 'sprout', 'seed', 'dormant'].filter((k) => stages.get(k)).map((k) => `${stages.get(k)} ${k}`).join(', ')})` : ''}`,
    bugs ? `${bugs} bugs on leaves` : 'no bugs',
    `${s.claims.length} fenced ${s.claims.length === 1 ? 'area' : 'areas'}`,
    `${open} open ${open === 1 ? 'request' : 'requests'}`,
  ];
  return `Garden: ${parts.join('; ')}. Press P for the garden plan, a text map of every file.`;
}
