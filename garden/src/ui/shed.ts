import type { GardenSnapshot } from '../../../shared/types.ts';
import { sentence } from './sentences.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mins = (ms: number) => Math.round(ms / 60000);
const fmtMin = (m: number) => (m <= 0 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export type Filter = 'all' | 'claims' | 'messages' | 'tests' | 'botanist';
const FILTERS: Array<[Filter, string, ReadonlySet<string> | null]> = [
  ['all', 'All', null],
  ['claims', 'Fences', new Set(['claim', 'release', 'blocked_edit'])],
  ['messages', 'Messages', new Set(['message_sent', 'message_delivered', 'message_acked', 'handoff_offered', 'handoff_accepted'])],
  ['tests', 'Tests', new Set(['test_pass', 'test_fail', 'commit'])],
  ['botanist', 'Botanist', new Set(['certify_bloom', 'certify_refused'])],
];

export interface ShedOptions {
  source: string;
  /** Human text for the connection state, e.g. "live", "reconnecting (2)", "demo data". */
  connection: string;
  collapsed: boolean;
}
export type FocusKind = 'member' | 'plant' | 'fence';
export interface ShedHandlers { onFocus(kind: FocusKind, key: string): void; onToggle(): void }

let filter: Filter = 'all';
let lastSig = '';
let lastMaxId = -1; // -1 until the first render, so existing history isn't flagged as new
let hovering = false;
let pending: (() => void) | undefined;
let updatedAt = Date.now();

/** Wire clicks once on the container; rendering never recreates the listeners. */
export function initShed(el: HTMLElement, h: ShedHandlers) {
  el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-focus],[data-filter],[data-toggle]');
    if (!t) return;
    if (t.dataset.toggle !== undefined) { h.onToggle(); return; }
    if (t.dataset.filter) { filter = t.dataset.filter as Filter; lastSig = ''; el.dispatchEvent(new CustomEvent('shed-rerender')); return; }
    const [kind, ...rest] = (t.dataset.focus ?? '').split(':');
    if (kind) h.onFocus(kind as FocusKind, rest.join(':'));
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') h.onToggle();
  });
  el.addEventListener('mouseenter', () => { hovering = true; });
  el.addEventListener('mouseleave', () => { hovering = false; pending?.(); pending = undefined; });
}

/** Re-render only when something visible changed; keeps scroll and avoids churn while the pointer is over the panel. */
export function renderShed(el: HTMLElement, s: GardenSnapshot, o: ShedOptions) {
  const lastRun = new Map<string, number>();
  for (const t of s.testRuns) lastRun.set(t.handle, t.exitCode); // later runs overwrite earlier ones
  const sig = JSON.stringify([
    o.source, o.connection, o.collapsed, filter,
    s.members.map((m) => [m.handle, m.online]),
    s.agents.filter((a) => a.kind === 'claude' && a.status !== 'dormant').map((a) => [a.handle, a.status, a.currentPath]),
    s.claims.map((c) => [c.id, c.path, mins(c.expiresAt - s.at)]),
    s.messages.filter((m) => m.status !== 'acked').map((m) => [m.id, m.status, mins(s.at - m.sentAt)]),
    (s.handoffs ?? []).slice(-5).map((h) => [h.id, h.status]),
    s.certifications.slice(-3).map((c) => c.id),
    [...lastRun],
    s.activity.slice(-40).map((a) => a.id),
  ]);
  if (sig === lastSig) return;
  if (hovering && !o.collapsed) { pending = () => renderShed(el, s, o); return; }
  lastSig = sig; updatedAt = Date.now();

  const scroller = el.querySelector<HTMLElement>('.shed-scroll');
  const scroll = scroller?.scrollTop ?? 0;
  el.classList.toggle('collapsed', o.collapsed);

  const dot = (c: string, on: boolean) => `<span class="dot" style="background:${on ? c : 'transparent'};border-color:${c}" aria-hidden="true"></span>`;
  const MAX_PEOPLE = 10;
  const ordered = [...s.members].sort((a, b) => Number(b.online) - Number(a.online));
  const gardeners = ordered.slice(0, MAX_PEOPLE).map((m) => {
    const bot = s.agents.find((a) => a.handle === m.handle && a.kind === 'claude' && a.status !== 'dormant');
    const unread = s.messages.filter((x) => x.toHandle === m.handle && x.status !== 'acked').length;
    const t = lastRun.get(m.handle);
    const what = !m.online ? 'offline' : bot ? `${bot.status}${bot.currentPath ? ` · ${esc(base(bot.currentPath))}` : ''}` : 'no agent';
    return `<li><button class="who" data-focus="member:${esc(m.handle)}" aria-label="Focus the camera on ${esc(m.handle)}">${dot(m.color, m.online)}<b>${esc(m.handle)}</b></button>
      <span class="sub">${what}${unread ? ` · ✉ ${unread} unread` : ''}${t === undefined ? '' : ` · tests ${t === 0 ? '✓ pass' : '✗ fail'}`}</span></li>`;
  }).join('') + (ordered.length > MAX_PEOPLE ? `<li class="sub">+${ordered.length - MAX_PEOPLE} more (offline)</li>` : '') || '<li class="sub">nobody has joined yet</li>';

  const color = (h: string) => s.members.find((m) => m.handle === h)?.color ?? '#888';
  const fences = s.claims.map((c) => {
    const left = mins(c.expiresAt - s.at);
    return `<li><button class="link" data-focus="fence:${esc(c.path)}"><b style="color:${color(c.handle)}">${esc(c.handle)}</b> fenced <code>${esc(c.path)}</code></button>
      <span class="sub">${left <= 5 ? '⚠ ' : ''}expires in ${fmtMin(left)}</span></li>`;
  }).join('') || '<li class="sub">no fences up</li>';

  // Many near-identical messages (a busy team, or a stuck inbox) collapse into one line per sender -> recipient.
  const groups = new Map<string, { from: string; to: string; kind: string; count: number; oldest: number; waiting: number; body: string; sent: number }>();
  for (const m of s.messages) {
    if (m.status === 'acked') continue;
    const k = `${m.fromHandle}\0${m.toHandle}`, g = groups.get(k);
    if (g) { g.count++; g.oldest = Math.min(g.oldest, m.sentAt); if (m.status === 'sent') g.waiting++; if (m.sentAt >= g.sent) { g.sent = m.sentAt; g.body = m.body; } }
    else groups.set(k, { from: m.fromHandle, to: m.toHandle, kind: m.kind, count: 1, oldest: m.sentAt, waiting: m.status === 'sent' ? 1 : 0, body: m.body, sent: m.sentAt });
  }
  const sortedGroups = [...groups.values()].sort((a, b) => b.sent - a.sent);
  const MAX_GROUPS = 4;
  const open = sortedGroups.slice(0, MAX_GROUPS).map((g) => {
    const age = fmtMin(mins(s.at - g.oldest));
    const state = g.waiting === g.count ? 'waiting for delivery' : g.waiting ? `${g.waiting} undelivered` : 'delivered, not acknowledged';
    return `<li><b>${esc(g.from)}</b> → <b>${esc(g.to)}</b>${g.count > 1 ? ` <b>×${g.count}</b>` : ''} <span class="sub">${esc(g.kind)} · ${state} · oldest ${age}</span><div class="sub">${esc(clip(g.body, 110))}</div></li>`;
  }).join('') + (sortedGroups.length > MAX_GROUPS ? `<li class="sub">+${sortedGroups.length - MAX_GROUPS} more conversations</li>` : '') || '<li class="sub">no open requests</li>';

  const hand = (s.handoffs ?? []).filter((h) => h.status === 'offered').map((h) =>
    `<li>🌱 <b>${esc(h.fromHandle)}</b> → <b>${esc(h.toHandle)}</b> <span class="sub">${esc(clip(h.task, 80))} · waiting to accept</span></li>`).join('');

  const certs = s.certifications.slice(-3).reverse().map((c) => {
    const items = c.result === 'refused' ? c.reason.split(/;\s*/).filter(Boolean) : [];
    return `<li><button class="link" data-focus="plant:${esc(c.path)}">${c.result === 'bloom' ? '🌸 Bloom' : '✋ Refused'} <code>${esc(base(c.path))}</code></button>
      <span class="sub">${esc(c.handle)} · ${fmtMin(mins(s.at - c.at))} ago</span>
      ${items.length ? `<ul class="why">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : c.task ? `<div class="sub">${esc(c.task)}</div>` : ''}</li>`;
  }).join('') || '<li class="sub">the botanist has not been asked yet</li>';

  const allowed = FILTERS.find((f) => f[0] === filter)![2];
  const feedRows = s.activity.slice(-40).filter((a) => !allowed || allowed.has(a.kind)).slice(-14).reverse();
  const feed = feedRows.map((a) => `<li${lastMaxId >= 0 && a.id > lastMaxId ? ' class="new"' : ''}>${esc(sentence(a))}</li>`).join('') || '<li class="sub">nothing yet</li>';
  lastMaxId = Math.max(lastMaxId, 0, ...s.activity.map((a) => a.id));
  const chips = FILTERS.map(([k, label]) => `<button class="chip${k === filter ? ' on' : ''}" data-filter="${k}" aria-pressed="${k === filter}">${label}</button>`).join('');

  el.innerHTML = `
    <div class="shed-head">
      <h2>Garden shed</h2>
      <span class="conn ${o.source === 'fake' ? 'demo' : 'live'}" role="status">${esc(o.connection)}</span>
      <button class="icon" data-toggle aria-label="${o.collapsed ? 'Open' : 'Collapse'} the garden shed (S)" aria-expanded="${!o.collapsed}">${o.collapsed ? '▤' : '✕'}</button>
    </div>
    <div class="shed-scroll" tabindex="-1">
      <h3>Gardeners</h3><ul>${gardeners}</ul>
      <h3>Fences</h3><ul>${fences}</ul>
      <h3>Open requests</h3><ul>${open}</ul>
      ${hand ? `<h3>Handoffs</h3><ul>${hand}</ul>` : ''}
      <h3>Botanist</h3><ul>${certs}</ul>
      <h3 id="feed-h">Happening now</h3>
      <div class="chips" role="group" aria-label="Filter the live feed">${chips}</div>
      <ul class="feed" aria-labelledby="feed-h">${feed}</ul>
      <div class="fresh sub" data-fresh>updated just now</div>
    </div>`;
  const sc = el.querySelector<HTMLElement>('.shed-scroll');
  if (sc) sc.scrollTop = scroll;
}

/** Cheap once-a-second tick for the "updated Ns ago" line; no re-render. */
export function tickFreshness(el: HTMLElement) {
  const f = el.querySelector<HTMLElement>('[data-fresh]');
  if (!f) return;
  const sec = Math.round((Date.now() - updatedAt) / 1000);
  f.textContent = sec < 3 ? 'updated just now' : `updated ${sec}s ago`;
}
