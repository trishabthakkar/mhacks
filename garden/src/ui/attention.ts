// Pure: what needs a human right now, ranked, for the shed's top strip; and feed grouping. (The team board keeps
// its own broader list in tasks.ts: this one is time-bounded and short on purpose.)
import type { ActivityView, GardenSnapshot } from '../../../shared/types.ts';
import { normalizeBed } from '../layout.ts';
import type { Pick } from '../pick.ts';
import { base, clip, esc } from './fmt.ts';

export interface AttentionItem { rank: number; icon: string; text: string; pick: Pick | null; at: number }

const MIN = 60_000;

export function shedAttention(s: GardenSnapshot): AttentionItem[] {
  const out: AttentionItem[] = [];
  const seen = new Set<string>();
  for (const a of s.activity) {
    if (a.kind !== 'blocked_edit' || s.at - a.at > 10 * MIN) continue;
    const k = `${a.handle}|${a.path}`; if (seen.has(k)) continue; seen.add(k);
    out.push({ rank: 1, icon: '🚧', at: a.at, text: `<b>${esc(a.handle)}</b> was stopped at a fence${a.path ? ` on <code>${esc(clip(base(a.path), 28))}</code>` : ''}`,
      pick: a.path ? { kind: 'plant', key: a.path } : { kind: 'member', key: a.handle } });
  }
  const latest = new Map<string, (typeof s.certifications)[number]>();
  for (const c of s.certifications) { const p = latest.get(c.path); if (!p || c.at >= p.at) latest.set(c.path, c); }
  for (const c of latest.values()) if (c.result === 'refused') {
    out.push({ rank: 2, icon: '✋', at: c.at, text: `Botanist refused <code>${esc(clip(base(c.path), 28))}</code> (${esc(c.handle)})`, pick: { kind: 'plant', key: c.path } });
  }
  const lastRun = new Map<string, (typeof s.testRuns)[number]>();
  for (const t of s.testRuns) { const p = lastRun.get(t.handle); if (!p || t.at >= p.at) lastRun.set(t.handle, t); }
  for (const t of lastRun.values()) if (t.exitCode !== 0) {
    out.push({ rank: 3, icon: '🐛', at: t.at, text: `Tests failing for <b>${esc(t.handle)}</b>`, pick: { kind: 'member', key: t.handle } });
  }
  for (const c of s.claims) {
    const left = c.expiresAt - s.at;
    if (left <= 0 || left > 5 * MIN) continue;
    const inFolder = c.path.endsWith('/') ? s.plants.find((p) => p.path.startsWith(c.path)) : undefined;
    out.push({ rank: 4, icon: '⏰', at: c.createdAt, text: `<b>${esc(c.handle)}</b>'s fence on <code>${esc(clip(c.path, 28))}</code> ends in ${Math.max(1, Math.round(left / MIN))} min`,
      pick: inFolder ? { kind: 'bed', key: normalizeBed(inFolder.bed) } : c.path.endsWith('/') ? null : { kind: 'plant', key: c.path } });
  }
  for (const m of s.messages) {
    if (m.status !== 'sent' || s.at - m.sentAt < 5 * MIN) continue;
    out.push({ rank: 5, icon: '🦋', at: m.sentAt, text: `Message <b>${esc(m.fromHandle)}</b> → <b>${esc(m.toHandle)}</b> not delivered yet (${Math.round((s.at - m.sentAt) / MIN)} min)`, pick: { kind: 'member', key: m.toHandle } });
  }
  for (const h of s.handoffs ?? []) if (h.status === 'offered') {
    out.push({ rank: 6, icon: '🤝', at: h.createdAt, text: `<b>${esc(h.toHandle)}</b> has a handoff to accept: ${esc(clip(h.task, 40))}`, pick: { kind: 'member', key: h.toHandle } });
  }
  return out.sort((a, b) => a.rank - b.rank || b.at - a.at);
}

/** Consecutive rows with the same kind, person and path collapse into the newest one with a count (oldest first in, oldest first out). */
export function groupFeed(rows: ActivityView[]): Array<{ a: ActivityView; count: number }> {
  const out: Array<{ a: ActivityView; count: number }> = [];
  for (const a of rows) {
    const last = out.at(-1);
    if (last && last.a.kind === a.kind && last.a.handle === a.handle && last.a.path === a.path) { last.a = a; last.count++; }
    else out.push({ a, count: 1 });
  }
  return out;
}
