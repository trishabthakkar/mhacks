// Pure: which of a member's Claude sessions the garden draws as their bot, and whether it is asleep.
// Every member always has a bot; it sleeps when there is no session, the session is idle or ended, or the person is away.
import type { AgentView, GardenSnapshot } from '../../shared/types.ts';
import { ago, base } from './ui/fmt.ts';

const RANK: Record<string, number> = { working: 5, waiting: 4, blocked: 3, needs_review: 2, idle: 1, dormant: 0 };

export function botFor(s: GardenSnapshot, handle: string): { agent?: AgentView; asleep: boolean } {
  let agent: AgentView | undefined;
  for (const a of s.agents) {
    if (a.handle !== handle || a.kind !== 'claude') continue;
    const r = RANK[a.status] ?? 0, br = agent ? RANK[agent.status] ?? 0 : -1;
    if (!agent || r > br || (r === br && a.lastSeen > agent.lastSeen)) agent = a;
  }
  const m = s.members.find((x) => x.handle === handle);
  return { agent, asleep: !agent || agent.status === 'idle' || agent.status === 'dormant' || !m || !m.online || m.paused };
}

/** The member to follow for a session: only the session their bot shows, and only until it ends (else the follow stops). */
export function followHandle(s: GardenSnapshot, sessionId: string): string | undefined {
  const h = botHandleOf(s, sessionId); if (!h) return undefined;
  const a = botFor(s, h).agent;
  return a && a.sessionId === sessionId && a.status !== 'dormant' ? h : undefined;
}

/** The member a session belongs to (bots are drawn per member, not per session). */
export const botHandleOf = (s: GardenSnapshot, sessionId: string) => s.agents.find((a) => a.sessionId === sessionId)?.handle;

const AWAKE: Record<string, string> = { needs_review: 'waiting for review', waiting: 'waiting for you', blocked: 'stuck at a fence' };
/** One plain line about a member's Claude, for tooltips. */
export function botLine(s: GardenSnapshot, handle: string): string {
  const { agent, asleep } = botFor(s, handle);
  if (!agent) return 'Claude asleep · no session yet';
  if (asleep) return `Claude asleep · last active ${ago(s.at - agent.lastSeen)}`;
  return `Claude ${AWAKE[agent.status] ?? agent.status}${agent.currentPath ? ` on ${base(agent.currentPath)}` : ''}`;
}

/** How much to enlarge a sleeping bot's z z z for a camera this far away: 1× up close, up to 3× from the overview. */
export const sleepZScale = (dist: number) => Math.min(3, Math.max(1, dist / 12));

/** Files a member touched in the last `windowMs` (any activity with a path), newest first, no repeats, at most `max`. */
export function recentFiles(s: GardenSnapshot, handle: string, windowMs = 30 * 60_000, max = 4): string[] {
  const out: string[] = [];
  for (const a of s.activity.filter((x) => x.handle === handle && x.path && s.at - x.at <= windowMs).sort((x, y) => y.at - x.at)) {
    if (!out.includes(a.path!)) out.push(a.path!);
    if (out.length >= max) break;
  }
  return out;
}
