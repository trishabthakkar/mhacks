// The P view: a readable team board (one column per member, task cards, a "needs attention" strip).
// Replaces the old top-down file map. Exports keep the names main.ts uses.
import type { GardenSnapshot } from '../../../shared/types.ts';
import type { GardenLayout } from '../layout.ts';
import { attention, taskModels } from '../tasks.ts';
import { esc, taskCardHtml } from './taskCard.ts';

export interface PlanHandlers { onShowIn3D(path: string): void; onClose(): void }
let host: HTMLElement | undefined;
let handlers: PlanHandlers | undefined;
let lastHtml = '';

const ICON: Record<string, string> = { blocked: '✋', refused: '🧑‍🌾', bugs: '🐛', message: '✉️', handoff: '🌱' };

/** Pure: the whole board as HTML (tested). */
export function boardHtml(s: GardenSnapshot): string {
  const models = taskModels(s);
  const handles = s.members.map((m) => m.handle);
  const col = (h: string, title: string, color: string, online: boolean | undefined) => {
    const mine = models.filter((m) => (h === '__other' ? !handles.includes(m.handle) : m.handle === h));
    const open = mine.filter((m) => m.status !== 'done'), done = mine.filter((m) => m.status === 'done');
    const main = s.agents.find((a) => a.handle === h && a.kind === 'claude' && a.status !== 'dormant');
    const doing = main ? `${esc(main.currentAction)}${main.currentPath ? ` ${esc(main.currentPath.split('/').pop()!)}` : ''}` : online ? 'online' : 'offline';
    return `<section class="col" data-col="${esc(h)}" style="--owner:${esc(color)}">
  <h3><span class="dot${online ? ' on' : ''}"></span>${esc(title)}<small>${h === '__other' ? '' : doing}</small></h3>
  ${open.length ? open.map((m) => taskCardHtml(m, s.at, { compact: true })).join('') : h === '__other' ? '' : '<p class="none">No task yet</p>'}
  ${done.length ? `<details class="done"><summary>${done.length} certified</summary>${done.map((m) => taskCardHtml(m, s.at, { compact: true })).join('')}</details>` : ''}
</section>`;
  };
  const cols = s.members.map((m) => col(m.handle, m.handle, m.color, m.online));
  if (models.some((m) => !handles.includes(m.handle))) cols.push(col('__other', 'Other', '#888888', undefined));
  const att = attention(s);
  const strip = att.length
    ? `<div class="attn" role="list" aria-label="Needs attention">${att.slice(0, 12).map((a) => `<button role="listitem" class="attn-chip ${a.kind}" data-focus="${esc(a.focus)}">${ICON[a.kind]} ${esc(a.text)}</button>`).join('')}</div>`
    : '<div class="attn ok">Nothing needs attention 🌿</div>';
  return `${strip}<div class="cols">${cols.join('')}</div>`;
}

export function initPlan(el: HTMLElement, h: PlanHandlers) {
  host = el; handlers = h;
  el.innerHTML = `<div class="plan-bar"><b>Team board</b><span class="hint">Click a card or chip to see it in 3D · P or Esc to close</span><button data-close>Back to 3D (P)</button></div><div class="board" tabindex="-1"></div>`;
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) { handlers?.onClose(); return; }
    if (t.closest('summary')) return;
    const f = t.closest<HTMLElement>('[data-focus]');
    if (f?.dataset.focus) handlers?.onShowIn3D(f.dataset.focus);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { handlers?.onClose(); return; }
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.task-card'));
    const i = cards.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Enter' && i >= 0 && cards[i]!.dataset.focus) handlers?.onShowIn3D(cards[i]!.dataset.focus!);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && cards.length) { e.preventDefault(); cards[(i + 1) % cards.length]!.focus(); }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && cards.length) { e.preventDefault(); cards[(i - 1 + cards.length) % cards.length]!.focus(); }
  });
}

/** Signature kept for main.ts; the layout is no longer needed. Re-renders only when the HTML changes (keeps focus). */
export function renderPlan(s: GardenSnapshot, _l?: GardenLayout) {
  if (!host) return;
  const html = boardHtml(s);
  if (html === lastHtml) return;
  lastHtml = html;
  const board = host.querySelector<HTMLElement>('.board')!;
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.task;
  board.innerHTML = html;
  if (focused) board.querySelector<HTMLElement>(`[data-task="${focused}"]`)?.focus();
}
