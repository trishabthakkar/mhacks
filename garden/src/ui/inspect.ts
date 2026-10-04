// Pure: the shed inspector's content for whatever was clicked in the 3D garden, and the one-line hover tooltip.
// Returns null when the subject no longer exists (the caller then clears the selection). Every string is escaped.
import type { ActivityView, GardenSnapshot } from '../../../shared/types.ts';
import type { Pick } from '../pick.ts';
import { normalizeBed } from '../layout.ts';
import { currentTaskOf, taskModels } from '../tasks.ts';
import { taskCardHtml } from './taskCard.ts';
import { sentence } from './sentences.ts';
import { ago, base, clip, esc, ICON, rel } from './fmt.ts';

export interface Inspect { title: string; body: string }

const TRACK = ['seed', 'sprout', 'growing', 'bud', 'bloom'] as const;
const DAY = 86_400_000;
const covers = (claim: string, file: string) => claim === file || (claim.endsWith('/') && file.startsWith(claim));
const sec = (h: string, body: string) => `<section class="insp-sec"><h4>${h}</h4>${body}</section>`;
const kv = (rows: Array<[string, string]>) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const plantBtn = (path: string, label = base(path)) => `<button class="link" data-select="plant:${esc(path)}">${esc(clip(label, 34))}</button>`;

function eventList(s: GardenSnapshot, f: (a: ActivityView) => boolean, n = 5, hit?: number): string {
  const rows = s.activity.filter(f).slice(-n).reverse();
  if (!rows.length) return '<p class="sub">nothing yet</p>';
  return `<ul class="ev">${rows.map((a) => `<li${a.id === hit ? ' class="hit"' : ''}><span class="i" aria-hidden="true">${ICON[a.kind] ?? '•'}</span><span class="s">${esc(sentence(a))}${a.kind === 'commit' && a.detail ? ` <span class="sub">“${esc(clip(a.detail, 60))}”</span>` : ''}</span><span class="t">${rel(s.at - a.at)}</span></li>`).join('')}</ul>`;
}

function stageTrack(stage: string): string {
  if (stage === 'dormant') return '<span class="pill idle">💤 dormant</span>';
  const at = TRACK.indexOf(stage as (typeof TRACK)[number]);
  return `<ol class="track" aria-label="stage ${esc(stage)}">${TRACK.map((t, i) => `<li class="${i < at ? 'past' : i === at ? 'now' : ''}">${t}</li>`).join('')}</ol>`;
}

function breakdown(stages: string[]): string {
  const order = [...TRACK, 'dormant'], n = stages.length || 1;
  const parts = order.map((st) => [st, stages.filter((x) => x === st).length] as const).filter(([, c]) => c > 0);
  return `<div class="stagebar" role="img" aria-label="${parts.map(([st, c]) => `${c} ${st}`).join(', ')}">${parts.map(([st, c]) => `<span class="st-${st}" style="flex:${c / n}" title="${c} ${st}"></span>`).join('')}</div>
    <p class="sub">${parts.map(([st, c]) => `${c} ${st}`).join(' · ')}</p>`;
}

/** A gardener's state for pills and tooltips. A member who left counts as offline. */
export function memberStatus(s: GardenSnapshot, handle: string): 'working' | 'idle' | 'blocked' | 'offline' | 'paused' {
  const m = s.members.find((x) => x.handle === handle);
  if (!m || !m.online) return 'offline';
  if (m.paused) return 'paused';
  const bot = s.agents.find((a) => a.handle === handle && a.kind === 'claude' && a.status !== 'dormant');
  if (bot?.status === 'blocked' || s.activity.some((a) => a.kind === 'blocked_edit' && a.handle === handle && s.at - a.at < 10 * 60_000)) return 'blocked';
  return bot?.status === 'working' ? 'working' : 'idle';
}

export function inspect(p: Pick, s: GardenSnapshot, ctx: { repo: string }): Inspect | null {
  switch (p.kind) {
    case 'plant': {
      if (p.key.endsWith('/')) { // a folded module_bindings hedge
        const kids = s.plants.filter((x) => x.path.startsWith(p.key));
        if (!kids.length) return null;
        return { title: base(p.key), body: kv([['folder', `<code>${esc(p.key)}</code>`], ['files', `${kids.length} generated files`], ['lines', String(kids.reduce((a, k) => a + k.lines, 0))]]) +
          '<p class="sub">Generated code is folded into one hedge. Regenerate it, don\'t hand-edit it.</p>' };
      }
      const pv = s.plants.find((x) => x.path === p.key);
      if (!pv) return null;
      const fence = s.claims.find((c) => covers(c.path, pv.path));
      const cert = s.certifications.filter((c) => c.path === pv.path).at(-1);
      const rows: Array<[string, string]> = [
        ['path', `<code>${esc(pv.path)}</code>`],
        ['size', `${pv.lines} lines`],
        ['last touched', pv.lastTouchedBy ? `<b>${esc(pv.lastTouchedBy)}</b> · ${ago(s.at - pv.lastActivity)}` : ago(s.at - pv.lastActivity)],
      ];
      if (pv.bugs) rows.push(['bugs', `<span class="bad">🐛 ${pv.bugs} bug${pv.bugs === 1 ? '' : 's'}</span>`]);
      if (fence) rows.push(['fence', `🔒 fenced by <b>${esc(fence.handle)}</b> · ${Math.max(0, Math.round((fence.expiresAt - s.at) / 60_000))} min left`]);
      if (cert) rows.push(['botanist', `${cert.result === 'bloom' ? '🌸 Bloom' : '✋ Refused'} · ${ago(s.at - cert.at)}${cert.result === 'refused' && cert.reason ? `<div class="sub">${esc(clip(cert.reason, 140))}</div>` : ''}`]);
      return { title: base(pv.path), body: stageTrack(pv.stage) + kv(rows) + sec('Recent', eventList(s, (a) => a.path === pv.path)) };
    }
    case 'bed': {
      const files = s.plants.filter((x) => normalizeBed(x.bed) === p.key);
      if (!files.length) return null;
      const fences = s.claims.filter((c) => files.some((f) => covers(c.path, f.path)));
      const active = [...new Set(s.activity.filter((a) => a.path && files.some((f) => f.path === a.path) && s.at - a.at < 30 * 60_000).map((a) => a.handle))];
      const recent = [...files].sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 5);
      return {
        title: p.key,
        body: kv([['files', `${files.length} files`], ['lines', String(files.reduce((a, f) => a + f.lines, 0))]]) + breakdown(files.map((f) => f.stage)) +
          (fences.length ? sec('Fences', `<ul class="plain">${fences.map((c) => `<li>🔒 <b>${esc(c.handle)}</b> <code>${esc(c.path)}</code></li>`).join('')}</ul>`) : '') +
          (active.length ? sec('Working here', `<p>${active.map((h) => `<button class="link" data-select="member:${esc(h)}">${esc(h)}</button>`).join(', ')}</p>`) : '') +
          sec('Recently active', `<ul class="plain">${recent.map((f) => `<li>${plantBtn(f.path)} <span class="sub">${f.stage} · ${rel(s.at - f.lastActivity)}</span></li>`).join('')}</ul>`),
      };
    }
    case 'member': {
      const m = s.members.find((x) => x.handle === p.key);
      if (!m) return null;
      const task = currentTaskOf(s, m.handle);
      const model = task ? taskModels(s).find((t) => t.id === task.id) : undefined;
      const run = s.testRuns.filter((t) => t.handle === m.handle).at(-1);
      const unread = s.messages.filter((x) => x.toHandle === m.handle && x.status !== 'acked').length;
      const agents = s.agents.filter((a) => a.handle === m.handle && a.status !== 'dormant');
      const rows: Array<[string, string]> = [['status', `<span class="pill ${memberStatus(s, m.handle)}">${memberStatus(s, m.handle)}</span>`]];
      if (agents.length) rows.push(['agents', agents.map((a) => `${a.kind === 'subagent' ? '✨ helper' : '🤖 bot'} · ${esc(clip(a.currentAction || a.status, 24))}${a.currentPath ? ` ${plantBtn(a.currentPath)}` : ''}`).join('<br>')]);
      if (run) rows.push(['tests', run.exitCode === 0 ? '<span class="good">✓ passing</span>' : '<span class="bad">✗ tests failing</span>']);
      if (unread) rows.push(['inbox', `✉ ${unread} unread`]);
      return { title: m.handle, body: kv(rows) + (model ? sec('Current task', taskCardHtml(model, s.at, { compact: true })) : '') + sec('Recent', eventList(s, (a) => a.handle === m.handle)) };
    }
    case 'task': {
      const model = taskModels(s).find((t) => t.id === p.key);
      return model ? { title: model.title, body: taskCardHtml(model, s.at) } : null;
    }
    case 'botanist': {
      const certs = s.certifications.slice(-5).reverse();
      return { title: 'The botanist', body: '<p class="sub">Certifies a file only after its tests ran and passed.</p>' + (certs.length
        ? `<ul class="plain">${certs.map((c) => `<li>${c.result === 'bloom' ? '🌸 Bloom' : '✋ Refused'} ${plantBtn(c.path)} <span class="sub">${esc(c.handle)} · ${rel(s.at - c.at)}</span>${c.result === 'refused' && c.reason ? `<div class="sub">${esc(clip(c.reason, 140))}</div>` : ''}</li>`).join('')}</ul>`
        : '<p class="sub">Not asked yet.</p>') };
    }
    case 'pond':
    case 'commit': {
      if (p.kind === 'commit' && !s.activity.some((a) => a.id === p.key && a.kind === 'commit')) return null;
      return { title: 'The pond', body: '<p class="sub">Each lily pad is a commit from the last day, in the committer\'s colour.</p>' +
        eventList(s, (a) => a.kind === 'commit' && s.at - a.at <= DAY, 14, p.kind === 'commit' ? p.key : undefined) };
    }
    case 'garden': {
      const online = s.members.filter((m) => m.online).length, blooms = s.plants.filter((x) => x.stage === 'bloom').length;
      return { title: clip(ctx.repo, 40), body: kv([['gardeners', `${online} online · ${s.members.length} total`], ['plants', `${s.plants.length} plants`], ['blooming', String(blooms)], ['fences', String(s.claims.length)]]) + breakdown(s.plants.map((x) => x.stage)) };
    }
    case 'shed': return null;
  }
}

/** One plain-text line for the hover tooltip (set with textContent, so no escaping needed). */
export function hoverText(p: Pick, s: GardenSnapshot): string | null {
  switch (p.kind) {
    case 'plant': {
      if (p.key.endsWith('/')) return `${base(p.key)} · generated code`;
      const pv = s.plants.find((x) => x.path === p.key);
      if (!pv) return null;
      return `${clip(base(pv.path), 30)} · ${pv.stage}${pv.bugs ? ` · ${pv.bugs} 🐛` : ''}${pv.lastTouchedBy ? ` · ${pv.lastTouchedBy} ${ago(s.at - pv.lastActivity)}` : ''}`;
    }
    case 'bed': { const n = s.plants.filter((x) => normalizeBed(x.bed) === p.key).length; return n ? `${clip(p.key, 30)} · ${n} files` : null; }
    case 'member': return s.members.some((m) => m.handle === p.key) ? `${p.key} · ${memberStatus(s, p.key)}` : null;
    case 'task': {
      const t = (s.tasks ?? []).find((x) => x.id === p.key); if (!t) return null;
      const items = (s.taskItems ?? []).filter((i) => i.taskId === t.id);
      const tail = items.length ? `${items.filter((i) => i.state === 'completed').length}/${items.length} done` : t.status.replace(/_/g, ' ');
      return `${clip(t.title, 40)} · ${t.handle} · ${tail}`;
    }
    case 'commit': { const a = s.activity.find((x) => x.id === p.key); return a ? `${a.handle} committed${a.detail ? `: ${clip(a.detail, 40)}` : ''}` : null; }
    case 'botanist': return 'The botanist · click for verdicts';
    case 'pond': return 'The pond · today\'s commits';
    case 'garden': return 'Click for the whole garden';
    case 'shed': return 'Garden shed · click to open the panel';
  }
}
