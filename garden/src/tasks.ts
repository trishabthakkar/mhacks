// Pure: one TaskModel per task, built from a snapshot. The board, hover card, task plants and spirits all read this.
import type { GardenSnapshot, TaskItemState, TaskStatus, TaskView } from '../../shared/types.ts';

export interface AgentLine { kind: 'main' | 'spirit'; sessionId: string; status: string; action: string; path?: string; agoMs: number }
export interface TaskModel {
  id: number; handle: string; color: string; title: string; status: TaskStatus; bed: string; paths: string[];
  items: { text: string; state: TaskItemState }[]; done: number; total: number;
  fence?: { path: string; expiresAt: number }; roadblocks: string[]; agents: AgentLine[];
  current: boolean; createdAt: number; updatedAt: number; doneAt?: number;
}
export interface Attention { kind: 'blocked' | 'refused' | 'bugs' | 'message' | 'handoff'; text: string; focus: string }

const covers = (claim: string, file: string) => claim === file || (claim.endsWith('/') && file.startsWith(claim));
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p;

/** A member's most recently updated task that isn't done. */
export function currentTaskOf(s: GardenSnapshot, handle: string): TaskView | undefined {
  return (s.tasks ?? []).filter((t) => t.handle === handle && t.status !== 'done').sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function taskModels(s: GardenSnapshot): TaskModel[] {
  const color = (h: string) => s.members.find((m) => m.handle === h)?.color ?? '#888888';
  const out = (s.tasks ?? []).map((t): TaskModel => {
    const items = (s.taskItems ?? []).filter((i) => i.taskId === t.id).sort((a, b) => a.ord - b.ord).map((i) => ({ text: i.text, state: i.state }));
    const current = currentTaskOf(s, t.handle)?.id === t.id;
    const fenceRow = s.claims.find((c) => c.handle === t.handle && t.paths.some((p) => covers(c.path, p) || covers(p, c.path)));
    const roadblocks: string[] = [];
    if (t.blockedReason) roadblocks.push(t.blockedReason);
    else if (t.status === 'blocked') roadblocks.push('blocked');
    if (t.status !== 'done') {
      for (const p of s.plants) {
        if (p.bugs > 0 && t.paths.some((tp) => covers(tp, p.path))) roadblocks.push(`${p.bugs} failing-test bug${p.bugs === 1 ? '' : 's'} on ${base(p.path)}`);
      }
    }
    const agents: AgentLine[] = current
      ? s.agents.filter((a) => a.handle === t.handle && a.status !== 'dormant').map((a) => ({
          kind: a.kind === 'subagent' ? ('spirit' as const) : ('main' as const), sessionId: a.sessionId, status: a.status, action: a.currentAction,
          ...(a.currentPath ? { path: a.currentPath } : {}), agoMs: Math.max(0, s.at - a.lastSeen),
        }))
      : [];
    return {
      id: t.id, handle: t.handle, color: color(t.handle), title: t.title, status: t.status, bed: t.bed, paths: t.paths,
      items, done: items.filter((i) => i.state === 'completed').length, total: items.length,
      ...(fenceRow ? { fence: { path: fenceRow.path, expiresAt: fenceRow.expiresAt } } : {}),
      roadblocks, agents, current, createdAt: t.createdAt, updatedAt: t.updatedAt, ...(t.doneAt ? { doneAt: t.doneAt } : {}),
    };
  });
  return out.sort((a, b) => a.handle.localeCompare(b.handle) || Number(b.current) - Number(a.current) || b.updatedAt - a.updatedAt);
}

/** Everything that needs a human's attention, for the board's top strip. */
export function attention(s: GardenSnapshot): Attention[] {
  const out: Attention[] = [];
  for (const t of s.tasks ?? []) {
    if (t.status === 'blocked') out.push({ kind: 'blocked', text: `${t.handle} blocked: ${t.blockedReason ?? t.title}`, focus: t.paths[0] ?? '' });
  }
  const latest = new Map<string, (typeof s.certifications)[number]>();
  for (const c of s.certifications) { const p = latest.get(c.path); if (!p || c.at >= p.at) latest.set(c.path, c); }
  for (const c of latest.values()) if (c.result === 'refused') out.push({ kind: 'refused', text: `Botanist refused ${base(c.path)} (${c.handle}): ${c.reason}`, focus: c.path });
  for (const p of s.plants) if (p.bugs > 0) out.push({ kind: 'bugs', text: `${p.bugs} bug${p.bugs === 1 ? '' : 's'} on ${base(p.path)}`, focus: p.path });
  for (const m of s.messages) {
    if (m.status !== 'acked') out.push({ kind: 'message', text: `${m.fromHandle} → ${m.toHandle}: ${m.status === 'sent' ? 'waiting for delivery' : 'not acked yet'}`, focus: '' });
  }
  for (const h of s.handoffs ?? []) if (h.status === 'offered') out.push({ kind: 'handoff', text: `${h.fromHandle} → ${h.toHandle}: "${h.task}" needs accepting`, focus: '' });
  return out;
}
