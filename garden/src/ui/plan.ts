import type { GardenSnapshot } from '../../../shared/types.ts';
import type { GardenLayout } from '../layout.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const GLYPH: Record<string, string> = { seed: 'seed', sprout: 'sprout', growing: 'growing', bud: 'bud', bloom: 'BLOOM', dormant: 'dormant' };

/** Flat top-down garden plan with text labels for every bed, plant, fence, bug count and agent. */
export function renderPlan(el: HTMLElement, s: GardenSnapshot, l: GardenLayout) {
  const pad = 3, w = l.width + pad * 2, d = l.depth + pad * 2;
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
  for (const p of l.plants) {
    const v = byPath.get(p.path); if (!v) continue;
    const bloom = v.stage === 'bloom';
    parts.push(`<circle cx="${p.x}" cy="${p.z}" r="${0.3 + p.size * 0.25}" class="plant ${v.stage}"/>`);
    parts.push(`<text x="${p.x}" y="${p.z + 0.95}" text-anchor="middle" class="small">${esc(p.path.split('/').pop()!)}</text>`);
    parts.push(`<text x="${p.x}" y="${p.z + 0.1}" text-anchor="middle" class="stage${bloom ? ' b' : ''}">${GLYPH[v.stage]}${v.bugs ? ` 🐛${v.bugs}` : ''}</text>`);
  }
  s.agents.filter((a) => a.status !== 'dormant').forEach((a) => {
    const p = a.currentPath ? pos.get(a.currentPath) : undefined; if (!p) return;
    const off = a.kind === 'subagent' ? 1.1 : 0.8;
    parts.push(`<rect x="${p.x + off - 0.18}" y="${p.z - 0.9}" width="0.36" height="0.36" fill="${color(a.handle)}"/>`);
    parts.push(`<text x="${p.x + off + 0.3}" y="${p.z - 0.6}" class="small">${esc(a.handle)}${a.kind === 'subagent' ? ' bee' : ' bot'}: ${a.status}</text>`);
  });
  el.innerHTML = `<svg viewBox="${-w / 2} ${-d / 2} ${w} ${d}" role="img" aria-label="Garden plan: top-down map of beds, plants, fences and agents">${parts.join('')}</svg>
    <div class="legend"><b>Garden plan</b> · text labels for every plant stage, fence and agent · press P to return to 3D</div>`;
}
