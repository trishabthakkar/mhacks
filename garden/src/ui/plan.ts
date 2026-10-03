import type { GardenSnapshot, PlantView } from '../../../shared/types.ts';
import type { GardenLayout } from '../layout.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
const GLYPH: Record<string, string> = { seed: 'seed', sprout: 'sprout', growing: 'growing', bud: 'bud', bloom: 'BLOOM', dormant: 'dormant' };
const ago = (ms: number) => { const m = Math.round(ms / 60000); return m <= 0 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };

interface View { x: number; y: number; w: number; h: number }
let view: View | null = null; // null = fit to the garden
let search = '';
let selected: string | undefined;
let last: { s: GardenSnapshot; l: GardenLayout } | undefined;
let handlers: PlanHandlers | undefined;
let host: HTMLElement | undefined;

export interface PlanHandlers { onShowIn3D(path: string): void; onClose(): void }

const fitView = (l: GardenLayout): View => {
  const pad = 3, w = Math.max(10, l.width) + pad * 2, h = Math.max(8, l.depth) + pad * 2;
  return { x: -w / 2, y: -h / 2, w, h };
};

/** Build the toolbar/stage once and wire pan, zoom, search, selection. */
export function initPlan(el: HTMLElement, h: PlanHandlers) {
  host = el; handlers = h;
  el.innerHTML = `
    <div class="plan-bar">
      <b>Garden plan</b>
      <input type="search" id="plan-search" placeholder="Find a file…" aria-label="Find a file in the garden plan" />
      <button data-plan="zoom-in" aria-label="Zoom in">+</button><button data-plan="zoom-out" aria-label="Zoom out">−</button>
      <button data-plan="fit">Fit</button>
      <button data-plan="close">Back to 3D (P)</button>
    </div>
    <div class="plan-stage"><svg role="img" aria-label="Garden plan: top-down map of beds, plants, fences and agents"></svg><div class="plan-card" hidden></div></div>
    <div class="legend"><span class="k seed">seed</span><span class="k sprout">sprout</span><span class="k growing">growing</span><span class="k bud">bud</span><span class="k bloom">bloom</span><span class="k dormant">dormant</span> · 🐛 bugs · dashed box = fence · ✕ blocked edit · square = agent · press P to return to 3D</div>`;
  const svg = el.querySelector('svg')!;
  const input = el.querySelector<HTMLInputElement>('#plan-search')!;
  const zoom = (f: number, cx?: number, cy?: number) => {
    const v = view ?? fitView(last!.l);
    const px = cx ?? v.x + v.w / 2, py = cy ?? v.y + v.h / 2;
    view = { x: px - (px - v.x) * f, y: py - (py - v.y) * f, w: v.w * f, h: v.h * f };
    applyView();
  };
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const r = svg.getBoundingClientRect(), v = view ?? fitView(last!.l);
    const k = Math.max(v.w / r.width, v.h / r.height); // preserveAspectRatio meet
    return { x: v.x + v.w / 2 + (e.clientX - r.left - r.width / 2) * k, y: v.y + v.h / 2 + (e.clientY - r.top - r.height / 2) * k };
  };
  svg.addEventListener('wheel', (e) => { if (!last) return; e.preventDefault(); const p = toSvg(e); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y); }, { passive: false });
  let drag: { sx: number; sy: number; v: View } | undefined;
  svg.addEventListener('pointerdown', (e) => { if (!last) return; drag = { sx: e.clientX, sy: e.clientY, v: { ...(view ?? fitView(last.l)) } }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = svg.getBoundingClientRect(), k = Math.max(drag.v.w / r.width, drag.v.h / r.height);
    view = { ...drag.v, x: drag.v.x - (e.clientX - drag.sx) * k, y: drag.v.y - (e.clientY - drag.sy) * k };
    applyView();
  });
  svg.addEventListener('pointerup', () => { drag = undefined; });
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-plan]');
    if (b) {
      const a = b.dataset.plan;
      if (a === 'zoom-in') zoom(1 / 1.3); else if (a === 'zoom-out') zoom(1.3); else if (a === 'fit') { view = null; applyView(); } else if (a === 'close') handlers?.onClose();
      return;
    }
    const sh = t.closest<HTMLElement>('[data-show3d]');
    if (sh) { handlers?.onShowIn3D(sh.dataset.show3d!); return; }
    const pl = (t as unknown as SVGElement).closest?.('[data-path]') as SVGElement | null;
    if (pl) { selected = pl.getAttribute('data-path') ?? undefined; if (last) renderPlan(last.s, last.l); }
  });
  el.addEventListener('keydown', (e) => {
    if (e.target === input && e.key === 'Enter' && last) {
      const hit = last.l.plants.find((p) => search && p.path.toLowerCase().includes(search));
      if (hit) { selected = hit.path; view = { x: hit.x - 4, y: hit.z - 3, w: 8, h: 6 }; applyView(); renderPlan(last.s, last.l); }
    }
    if (e.key === 'Escape') { if (selected) { selected = undefined; if (last) renderPlan(last.s, last.l); } else handlers?.onClose(); }
  });
  input.addEventListener('input', () => { search = input.value.trim().toLowerCase(); if (last) renderPlan(last.s, last.l); });
}

function applyView() {
  const svg = host?.querySelector('svg'); if (!svg || !last) return;
  const v = view ?? fitView(last.l);
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
}

function detailCard(p: PlantView, s: GardenSnapshot) {
  const rel = (t?: number) => (t === undefined ? '—' : ago(s.at - t));
  return `<button class="icon" data-plan="close-card" aria-label="Close details" onclick="this.parentElement.hidden=true">✕</button>
    <h4>${esc(p.path)}</h4>
    <dl><dt>Stage</dt><dd>${esc(p.stage)}</dd><dt>Bugs</dt><dd>${p.bugs}</dd><dt>Lines</dt><dd>${p.lines}</dd>
    <dt>Last touched by</dt><dd>${esc(p.lastTouchedBy ?? '—')}</dd><dt>Last activity</dt><dd>${rel(p.lastActivity)}</dd>
    <dt>Last diff</dt><dd>${rel(p.lastDiffAt)}</dd><dt>Last bloom</dt><dd>${rel(p.lastBloomAt)}</dd></dl>
    <button class="chip on" data-show3d="${esc(p.path)}">Show in 3D</button>`;
}

/** Flat top-down garden plan; text for everything, so it works for scanning and screen readers. */
export function renderPlan(s: GardenSnapshot, l: GardenLayout) {
  last = { s, l };
  if (!host) return;
  const svg = host.querySelector('svg')!;
  const color = (h: string) => s.members.find((m) => m.handle === h)?.color ?? '#888';
  const byPath = new Map(s.plants.map((p) => [p.path, p]));
  const pos = new Map(l.plants.map((p) => [p.path, p]));
  const parts: string[] = [];
  for (const b of l.beds) {
    parts.push(`<rect x="${b.x - b.w / 2}" y="${b.z - b.d / 2}" width="${b.w}" height="${b.d}" rx="0.4" class="bed${b.greenhouse ? ' gh' : ''}"/>`);
    parts.push(`<text x="${b.x - b.w / 2 + 0.3}" y="${b.z - b.d / 2 + 0.7}" class="bedname">${esc(b.name)}${b.greenhouse ? ' (greenhouse)' : ''}</text>`);
  }
  for (const c of s.claims) {
    const hit = l.plants.filter((p) => p.path === c.path || (c.path.endsWith('/') && p.path.startsWith(c.path)));
    if (!hit.length) continue;
    const x0 = Math.min(...hit.map((p) => p.x)) - 0.9, x1 = Math.max(...hit.map((p) => p.x)) + 0.9;
    const z0 = Math.min(...hit.map((p) => p.z)) - 0.9, z1 = Math.max(...hit.map((p) => p.z)) + 0.9;
    parts.push(`<rect x="${x0}" y="${z0}" width="${x1 - x0}" height="${z1 - z0}" fill="none" stroke="${color(c.handle)}" stroke-width="0.14" stroke-dasharray="0.4 0.25"/>`);
    parts.push(`<text x="${x0 + 0.1}" y="${z1 + 0.55}" class="small" fill="${color(c.handle)}">fence: ${esc(c.handle)}</text>`);
  }
  const blocked = new Set(s.activity.slice(-30).filter((a) => a.kind === 'blocked_edit' && a.path).map((a) => a.path!));
  const bedIdx = new Map<string, number>();
  for (const p of l.plants) {
    const v = byPath.get(p.path); if (!v) continue;
    const idx = bedIdx.get(p.bed) ?? 0; bedIdx.set(p.bed, idx + 1);
    const name = base(p.path), shown = name.length > 11 ? `${name.slice(0, 10)}…` : name;
    const hit = search && p.path.toLowerCase().includes(search);
    parts.push(`<g data-path="${esc(p.path)}" tabindex="0" role="button" aria-label="${esc(p.path)}: ${v.stage}${v.bugs ? `, ${v.bugs} bugs` : ''}">`);
    parts.push(`<circle cx="${p.x}" cy="${p.z}" r="${0.3 + p.size * 0.25}" class="plant ${v.stage}${p.path === selected ? ' sel' : ''}${hit ? ' hit' : ''}"/>`);
    parts.push(`<text x="${p.x}" y="${p.z + 0.95 + (idx % 2) * 0.42}" text-anchor="middle" class="small"><title>${esc(p.path)}</title>${esc(shown)}</text>`);
    parts.push(`<text x="${p.x}" y="${p.z + 0.1}" text-anchor="middle" class="stage${v.stage === 'bloom' ? ' b' : ''}">${GLYPH[v.stage] ?? esc(v.stage)}${v.bugs ? ` 🐛${v.bugs}` : ''}</text>`);
    if (blocked.has(p.path)) parts.push(`<text x="${p.x + 0.6}" y="${p.z - 0.5}" class="blocked">✕</text>`);
    parts.push('</g>');
  }
  const at = new Map<string, { x: number; y: number }>();
  const stack = new Map<string, number>(); // several agents on one file: stack their labels upward
  s.agents.filter((a) => a.status !== 'dormant').forEach((a) => {
    const p = a.currentPath ? pos.get(a.currentPath) : undefined; if (!p) return;
    const n = stack.get(p.path) ?? 0; stack.set(p.path, n + 1);
    const off = a.kind === 'subagent' ? 1.1 : 0.8, dy = -0.9 - n * 0.5;
    if (a.kind === 'claude' && !at.has(a.handle)) at.set(a.handle, { x: p.x + off, y: p.z + dy + 0.18 });
    parts.push(`<rect x="${p.x + off - 0.18}" y="${p.z + dy}" width="0.36" height="0.36" fill="${color(a.handle)}"/>`);
    parts.push(`<text x="${p.x + off + 0.3}" y="${p.z + dy + 0.3}" class="small">${esc(a.handle)}${a.kind === 'subagent' ? ' bee' : ' bot'}: ${a.status}</text>`);
  });
  for (const m of s.messages.filter((x) => x.status !== 'acked')) { // messages in flight: arrow sender -> recipient
    const a = at.get(m.fromHandle), b = at.get(m.toHandle);
    if (a && b) parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color(m.fromHandle)}" stroke-width="0.1" stroke-dasharray="0.15 0.15"/><text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 0.2}" class="small">✉ ${m.status}</text>`);
  }
  if (!l.plants.length) parts.push(`<text x="0" y="0" text-anchor="middle" class="bedname">No files planted yet</text>`);
  svg.innerHTML = parts.join('');
  applyView();
  const card = host.querySelector<HTMLElement>('.plan-card')!;
  const sel = selected ? byPath.get(selected) : undefined;
  card.hidden = !sel;
  if (sel) card.innerHTML = detailCard(sel, s);
}
