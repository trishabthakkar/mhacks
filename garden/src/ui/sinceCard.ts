// The "since you were last here" card: top-left, a few clickable lines (each selects what it is about), dismissible.
import { pickKey, parsePick, type Pick } from '../pick.ts';
import type { SinceCard } from '../since.ts';
import { esc } from './fmt.ts';

export function sinceCardHtml(c: SinceCard): string {
  return `<div class="hd"><strong>${esc(c.title)}</strong><button class="x" data-close aria-label="Close">×</button></div>` +
    c.lines.map((l) => `<button class="ln"${l.pick ? ` data-pick="${esc(pickKey(l.pick))}"` : ''}>${esc(l.text)}</button>`).join('');
}

/** Show the card (replacing any previous one). Lines select their subject; × or Esc-free dismissal via the button. */
export function showSince(c: SinceCard, onPick: (p: Pick) => void) {
  document.getElementById('since')?.remove();
  const el = document.createElement('aside');
  el.id = 'since'; el.setAttribute('aria-label', 'What changed since your last visit');
  el.innerHTML = sinceCardHtml(c);
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.hasAttribute('data-close')) { el.remove(); return; }
    const p = b.dataset.pick ? parsePick(b.dataset.pick) : null;
    if (p) onPick(p);
  });
  document.body.append(el);
}
