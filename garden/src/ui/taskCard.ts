// One task as an HTML card: the board (P) shows it compact, the 3D hover shows it full. Pure; every agent-written string is escaped.
import type { TaskModel } from '../tasks.ts';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
const ago = (ms: number) => (ms < 15_000 ? 'just now' : ms < 3_600_000 ? `${Math.round(ms / 60_000) || 1} min ago` : `${Math.floor(ms / 3_600_000)}h ago`);
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
const STATUS: Record<string, string> = { active: '● working', blocked: '✋ blocked', needs_review: '👀 needs review', done: '🌸 certified' };
const MARK = { completed: '✓', in_progress: '▸', pending: '○' } as const;
const MAX_ITEMS = 8;

/** `now` is unused for now; it stays in the signature so callers don't change when relative times are added. */
export function taskCardHtml(m: TaskModel, now: number, o: { compact?: boolean } = {}): string {
  void now;
  const items = m.items.slice(0, MAX_ITEMS).map((i) => `<li class="it ${i.state}"><span class="mk">${MARK[i.state]}</span>${esc(i.text)}</li>`).join('');
  const more = m.items.length > MAX_ITEMS ? `<li class="more">+${m.items.length - MAX_ITEMS} more</li>` : '';
  const pct = m.total ? Math.round((m.done / m.total) * 100) : m.status === 'done' ? 100 : 0;
  const live = m.agents.map((a) =>
    `<li class="live ${a.kind}"><span>${a.kind === 'main' ? '🤖 main' : '✨ spirit'}</span> ${esc(a.action)}${a.path ? ` ${esc(base(a.path))}` : ''} · ${ago(a.agoMs)}</li>`).join('');
  const meta = [esc(m.handle), m.fence ? `fenced ${esc(m.fence.path)} until ${clock(m.fence.expiresAt)}` : '', m.paths.length ? `${m.paths.length} path${m.paths.length === 1 ? '' : 's'}` : '']
    .filter(Boolean).join(' · ');
  return `<article class="task-card st-${m.status}${o.compact ? ' compact' : ''}" style="--owner:${esc(m.color)}" data-task="${m.id}" data-focus="${esc(m.paths[0] ?? '')}" tabindex="0">
  <header><h4>${esc(m.title)}</h4><span class="st">${STATUS[m.status] ?? esc(m.status)}</span></header>
  <p class="meta">${meta}</p>
  ${m.total ? `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><p class="prog">${m.done} / ${m.total}</p>` : ''}
  ${items || more ? `<ul class="items">${items}${more}</ul>` : ''}
  ${m.roadblocks.length ? `<ul class="blocks">${m.roadblocks.map((r) => `<li>✋ ${esc(r)}</li>`).join('')}</ul>` : ''}
  ${live ? `<ul class="lives">${live}</ul>` : ''}
</article>`;
}
