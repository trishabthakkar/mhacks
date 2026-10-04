import type { GardenSnapshot } from '../../../shared/types.ts';
import { sentence } from './sentences.ts';
import { base, clip, esc, ICON, rel, safeColor } from './fmt.ts';
import { groupFeed, shedAttention } from './attention.ts';
import { inspect } from './inspect.ts';
import { parsePick, pickKey, type Pick } from '../pick.ts';

const mins = (ms: number) => Math.round(ms / 60000);
const fmtMin = (m: number) => (m <= 0 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);

export type Filter = 'all' | 'claims' | 'messages' | 'tests' | 'botanist';
export type Tab = 'team' | 'activity';
const FILTERS: Array<[Filter, string, ReadonlySet<string> | null]> = [
  ['all', 'All', null],
  ['claims', 'Fences', new Set(['claim', 'release', 'blocked_edit'])],
  ['messages', 'Messages', new Set(['message_sent', 'message_delivered', 'message_acked', 'handoff_offered', 'handoff_accepted'])],
  ['tests', 'Tests', new Set(['test_pass', 'test_fail', 'commit'])],
  ['botanist', 'Botanist', new Set(['certify_bloom', 'certify_refused'])],
];
const ATTN_MAX = 3, MAX_PEOPLE = 10, MAX_GROUPS = 4;

export interface ShedOptions {
  source: string;
  /** Human text for the connection state, e.g. "live", "reconnecting (2)", "demo data". */
  connection: string;
  collapsed: boolean;
  /** What the camera follows: a handle, or "agent:<sessionId>". */
  following?: string | null;
  /** What is open in the inspector (null: the tabs). */
  selected: Pick | null;
  repo: string;
}

/** A gardener's live bot and subagents, each a button that flies the camera to it. `following` marks the followed one. */
export function agentRows(s: GardenSnapshot, handle: string, following?: string | null): string {
  const live = s.agents.filter((a) => a.handle === handle && a.status !== 'dormant')
    .sort((a, b) => Number(a.kind === 'subagent') - Number(b.kind === 'subagent'));
  if (!live.length) return '';
  return `<ul class="agents">${live.map((a) => {
    const key = `agent:${a.sessionId}`, sub = a.kind === 'subagent';
    const what = `${esc(clip(a.currentAction || a.status, 24))}${a.currentPath ? ` <code>${esc(base(a.currentPath))}</code>` : ''}`;
    return `<li><button class="link agent${following === key ? ' following' : ''}" data-focus="${esc(key)}" aria-label="Fly the camera to ${esc(handle)}'s ${sub ? 'helper agent' : 'bot'}">${sub ? '✨ helper' : '🤖 bot'} · ${what}</button></li>`;
  }).join('')}</ul>`;
}

export { memberStatus } from './inspect.ts';
import { memberStatus } from './inspect.ts';

export type FocusKind = 'member' | 'agent' | 'plant' | 'fence';
export interface ShedHandlers { onFocus(kind: FocusKind, key: string): void; onSelect(p: Pick | null): void; onToggle(): void }

function teamHtml(s: GardenSnapshot, o: ShedOptions, expanded: ReadonlySet<string>): string {
  const lastRun = new Map<string, number>();
  for (const t of s.testRuns) lastRun.set(t.handle, t.exitCode);
  const online = s.members.filter((m) => m.online), offline = s.members.length - online.length;
  if (!s.members.length) return '<p class="sub">Nobody has joined yet. Run <code>sprout join</code>.</p>';
  const cards = online.slice(0, MAX_PEOPLE).map((m) => {
    const st = memberStatus(s, m.handle);
    const bot = s.agents.find((a) => a.handle === m.handle && a.kind === 'claude' && a.status !== 'dormant');
    const helpers = s.agents.filter((a) => a.handle === m.handle && a.kind === 'subagent' && a.status !== 'dormant').length;
    const unread = s.messages.filter((x) => x.toHandle === m.handle && x.status !== 'acked').length;
    const fences = s.claims.filter((c) => c.handle === m.handle).length;
    const t = lastRun.get(m.handle);
    const action = (bot?.currentAction || bot?.status || '').replace(/_/g, ' ');
    const what = !bot ? 'no agent running' : !bot.currentPath && (st === 'idle' || action === st) ? 'between tasks'
      : `${esc(clip(action, 22))}${bot.currentPath ? ` · <code>${esc(clip(base(bot.currentPath), 26))}</code>` : ''}`;
    const badges = [
      unread ? `<span class="badge">✉ ${unread}</span>` : '',
      t === undefined ? '' : t === 0 ? '<span class="badge good">✓ tests</span>' : '<span class="badge bad">✗ tests</span>',
      fences ? `<span class="badge">🔒 ${fences}</span>` : '',
      helpers ? `<button class="badge" data-expand="${esc(m.handle)}" aria-expanded="${expanded.has(m.handle)}">+${helpers} helper${helpers === 1 ? '' : 's'}</button>` : '',
    ].join('');
    const following = o.following === m.handle || (o.following?.startsWith('agent:') && s.agents.some((a) => `agent:${a.sessionId}` === o.following && a.handle === m.handle));
    return `<li class="person${following ? ' following' : ''}" style="--c:${safeColor(m.color)}">
      <div class="top"><span class="tag" aria-hidden="true">${esc((m.handle[0] ?? '?').toUpperCase())}</span><button class="name" data-select="member:${esc(m.handle)}" aria-label="Inspect ${esc(m.handle)}">${esc(m.handle)}</button>
        <span class="pill ${st}">${st}</span>
        <button class="icon sm" data-focus="member:${esc(m.handle)}" aria-label="Follow ${esc(m.handle)} with the camera" title="Follow with the camera">🎥</button></div>
      <div class="what">${what}</div>${badges ? `<div class="badges">${badges}</div>` : ''}
      ${expanded.has(m.handle) ? agentRows(s, m.handle, o.following) : ''}</li>`;
  }).join('');
  const more = online.length > MAX_PEOPLE ? online.length - MAX_PEOPLE : 0;
  return `<ul class="people">${cards}</ul>${offline || more ? `<p class="sub fold">${[more ? `+${more} more online` : '', offline ? `+${offline} offline` : ''].filter(Boolean).join(' · ')}</p>` : ''}`;
}

function openNowHtml(s: GardenSnapshot): string {
  const color = (h: string) => s.members.find((m) => m.handle === h)?.color ?? '#888';
  const rows: string[] = [];
  for (const c of s.claims) {
    const left = mins(c.expiresAt - s.at);
    rows.push(`<li><span class="i">🔒</span><button class="link" data-focus="fence:${esc(c.path)}"><b style="color:${safeColor(color(c.handle))}">${esc(c.handle)}</b> fenced <code>${esc(clip(c.path, 28))}</code></button><span class="t">${left <= 5 ? '⚠ ' : ''}${fmtMin(left)}</span></li>`);
  }
  const groups = new Map<string, { from: string; to: string; count: number; waiting: number; body: string; sent: number; oldest: number }>();
  for (const m of s.messages) {
    if (m.status === 'acked') continue;
    const k = `${m.fromHandle}\0${m.toHandle}`, g = groups.get(k);
    if (g) { g.count++; g.oldest = Math.min(g.oldest, m.sentAt); if (m.status === 'sent') g.waiting++; if (m.sentAt >= g.sent) { g.sent = m.sentAt; g.body = m.body; } }
    else groups.set(k, { from: m.fromHandle, to: m.toHandle, count: 1, waiting: m.status === 'sent' ? 1 : 0, body: m.body, sent: m.sentAt, oldest: m.sentAt });
  }
  const sorted = [...groups.values()].sort((a, b) => b.sent - a.sent);
  for (const g of sorted.slice(0, MAX_GROUPS)) {
    const state = g.waiting === g.count ? 'not delivered yet' : g.waiting ? `${g.waiting} undelivered` : 'delivered, not acked';
    rows.push(`<li><span class="i">🦋</span><span class="s"><b>${esc(g.from)}</b> → <b>${esc(g.to)}</b>${g.count > 1 ? ` ×${g.count}` : ''} <span class="sub">${state}</span><span class="sub quote">${esc(clip(g.body, 90))}</span></span><span class="t">${rel(s.at - g.oldest)}</span></li>`);
  }
  if (sorted.length > MAX_GROUPS) rows.push(`<li class="sub">+${sorted.length - MAX_GROUPS} more conversations</li>`);
  for (const h of (s.handoffs ?? []).filter((x) => x.status === 'offered')) rows.push(`<li><span class="i">🤝</span><span class="s"><b>${esc(h.fromHandle)}</b> → <b>${esc(h.toHandle)}</b> <span class="sub">${esc(clip(h.task, 60))}</span></span></li>`);
  for (const c of s.certifications.slice(-3).reverse()) rows.push(`<li><span class="i">${c.result === 'bloom' ? '🌸' : '✋'}</span><span class="s"><button class="link" data-select="plant:${esc(c.path)}">${c.result === 'bloom' ? 'Bloom' : 'Refused'} <code>${esc(clip(base(c.path), 26))}</code></button> <span class="sub">${esc(c.handle)}</span></span><span class="t">${rel(s.at - c.at)}</span></li>`);
  return rows.length ? `<section class="open-now"><h3>Open now</h3><ul class="rows">${rows.join('')}</ul></section>` : '';
}

function activityHtml(s: GardenSnapshot, filter: Filter, lastMaxId: number): string {
  const allowed = FILTERS.find((f) => f[0] === filter)![2];
  const rows = groupFeed(s.activity.slice(-60).filter((a) => !allowed || allowed.has(a.kind))).slice(-14).reverse();
  const feed = rows.map(({ a, count }) => {
    const sel = a.path ? ` data-select="plant:${esc(a.path)}"` : '';
    return `<li class="${lastMaxId >= 0 && a.id > lastMaxId ? 'new' : ''}"><span class="i" aria-hidden="true">${ICON[a.kind] ?? '•'}</span>${a.path ? `<button class="link s"${sel}>` : '<span class="s">'}${esc(sentence(a))}${count > 1 ? ` <b>×${count}</b>` : ''}${a.path ? '</button>' : '</span>'}<span class="t">${rel(s.at - a.at)}</span></li>`;
  }).join('') || '<li class="sub">nothing yet</li>';
  const chips = FILTERS.map(([k, label]) => `<button class="chip${k === filter ? ' on' : ''}" data-filter="${k}" aria-pressed="${k === filter}">${label}</button>`).join('');
  return `${openNowHtml(s)}<div class="chips" role="group" aria-label="Filter the feed">${chips}</div><ul class="rows feed" aria-label="Live feed">${feed}</ul>`;
}

/** The whole panel as HTML. Pure (the DOM wrapper below only diffs and wires events). */
export function shedHtml(s: GardenSnapshot, o: ShedOptions, view: { tab: Tab; filter: Filter; expanded: ReadonlySet<string>; lastMaxId: number }): string {
  const live = o.source !== 'fake' && o.connection === 'live';
  const items = shedAttention(s);
  const attn = items.length
    ? `<section class="attn" aria-label="Needs attention"><h3>Needs attention</h3>${items.slice(0, ATTN_MAX).map((i) =>
        `<button class="row"${i.pick ? ` data-select="${esc(pickKey(i.pick))}"` : ''}><span class="i" aria-hidden="true">${i.icon}</span><span>${i.text}</span></button>`).join('')}${items.length > ATTN_MAX ? `<p class="sub">+${items.length - ATTN_MAX} more</p>` : ''}</section>`
    : '<section class="attn quiet" aria-label="Needs attention">All quiet 🌿</section>';
  const insp = o.selected ? inspect(o.selected, s, { repo: o.repo }) : null;
  const main = insp
    ? `<section class="insp" aria-label="Inspector"><div class="insp-head"><button class="icon" data-back aria-label="Back to the shed (Esc)">←</button><h3>${esc(insp.title)}</h3></div>${insp.body}</section>`
    : `<div class="tabs" role="tablist">${(['team', 'activity'] as const).map((t) => `<button role="tab" data-tab="${t}" aria-selected="${view.tab === t}" class="${view.tab === t ? 'on' : ''}">${t === 'team' ? 'Team' : 'Activity'}</button>`).join('')}</div>
       <div role="tabpanel">${view.tab === 'team' ? teamHtml(s, o, view.expanded) : activityHtml(s, view.filter, view.lastMaxId)}</div>`;
  return `<div class="shed-head">
      <div class="shed-title"><h2 title="Garden shed">${esc(o.repo || 'Garden')}</h2>
        <p class="conn"><span class="conn-dot${live ? ' live' : ''}" aria-hidden="true"></span><span class="conn-text" role="status">${esc(o.connection)}</span><span class="fresh" data-fresh>updated just now</span></p></div>
      <button class="icon" data-toggle aria-label="${o.collapsed ? 'Open' : 'Collapse'} the garden shed (S)" aria-expanded="${!o.collapsed}">${o.collapsed ? '▤' : '✕'}</button>
    </div>
    <div class="shed-scroll" tabindex="-1">${attn}${main}</div>`;
}

/** Esc inside the shed: leave the inspector first; only then collapse the panel. */
export const shedEscape = (inspectorOpen: boolean): 'back' | 'collapse' => (inspectorOpen ? 'back' : 'collapse');

/** Background updates wait while the pointer is over the panel (nothing jumps under the cursor); a new selection never waits. */
export function shouldDefer(o: { hovering: boolean; collapsed: boolean; first: boolean; lastSel: string; sel: string }): boolean {
  return o.hovering && !o.collapsed && !o.first && o.sel === o.lastSel;
}

// ---- DOM wrapper ----
const TAB_KEY = 'sprout.shed.tab';
let tab: Tab = 'team';
try { if (localStorage.getItem(TAB_KEY) === 'activity') tab = 'activity'; } catch { /* storage blocked */ }
let filter: Filter = 'all';
const expanded = new Set<string>();
let lastHtml = '';
let lastSel = '';
let lastMaxId = -1; // -1 until the first render, so existing history isn't flagged as new
let hovering = false;
let pending: (() => void) | undefined;
let updatedAt = Date.now();

/** Wire clicks once on the container; rendering never recreates the listeners. */
export function initShed(el: HTMLElement, h: ShedHandlers) {
  const rerender = () => { lastHtml = ''; el.dispatchEvent(new CustomEvent('shed-rerender')); };
  el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-toggle],[data-back],[data-tab],[data-filter],[data-expand],[data-select],[data-focus]');
    if (!t) return;
    if (t.dataset.toggle !== undefined) { h.onToggle(); return; }
    if (t.dataset.back !== undefined) { h.onSelect(null); return; }
    if (t.dataset.tab) { tab = t.dataset.tab as Tab; try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ } rerender(); return; }
    if (t.dataset.filter) { filter = t.dataset.filter as Filter; rerender(); return; }
    if (t.dataset.expand) { const k = t.dataset.expand; if (expanded.has(k)) expanded.delete(k); else expanded.add(k); rerender(); return; }
    if (t.dataset.select) { const p = parsePick(t.dataset.select); if (p) h.onSelect(p); return; }
    const [kind, ...rest] = (t.dataset.focus ?? '').split(':');
    if (kind) h.onFocus(kind as FocusKind, rest.join(':'));
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (shedEscape(!!el.querySelector('[data-back]')) === 'back') h.onSelect(null); else h.onToggle();
  });
  el.addEventListener('mouseenter', () => { hovering = true; });
  el.addEventListener('mouseleave', () => { hovering = false; pending?.(); pending = undefined; });
}

/** Re-render only when the HTML changed; defer while the pointer is over the panel (keeps what's under the cursor still). */
export function renderShed(el: HTMLElement, s: GardenSnapshot, o: ShedOptions) {
  const html = shedHtml(s, o, { tab, filter, expanded, lastMaxId });
  el.classList.toggle('collapsed', o.collapsed);
  if (html === lastHtml) return;
  const sel = o.selected ? pickKey(o.selected) : '';
  if (shouldDefer({ hovering, collapsed: o.collapsed, first: !lastHtml, lastSel, sel })) { pending = () => renderShed(el, s, o); return; }
  lastHtml = html; lastSel = sel; updatedAt = Date.now();
  lastMaxId = Math.max(lastMaxId, 0, ...s.activity.map((a) => a.id));
  const sc = el.querySelector<HTMLElement>('.shed-scroll'), scroll = sc?.scrollTop ?? 0;
  el.innerHTML = html;
  const sc2 = el.querySelector<HTMLElement>('.shed-scroll'); if (sc2) sc2.scrollTop = o.selected ? 0 : scroll;
}

/** Cheap once-a-second tick for the "updated Ns ago" line; no re-render. */
export function tickFreshness(el: HTMLElement) {
  const f = el.querySelector<HTMLElement>('[data-fresh]');
  if (!f) return;
  const sec = Math.round((Date.now() - updatedAt) / 1000);
  f.textContent = sec < 3 ? 'updated just now' : `updated ${sec}s ago`;
}
