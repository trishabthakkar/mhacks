import type { GardenSnapshot } from '../../../shared/types.ts';
import { sentence } from './sentences.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ago = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m <= 0 ? 'now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

/** Garden shed noticeboard: who's online, fences, open requests, certifications, live feed. */
export function renderShed(el: HTMLElement, s: GardenSnapshot, opts: { onFollow: (h: string) => void; source: string }) {
  const dot = (c: string, on: boolean) => `<span class="dot" style="background:${on ? c : 'transparent'};border-color:${c}"></span>`;
  const online = s.members.map((m) => {
    const bot = s.agents.find((a) => a.handle === m.handle && a.kind === 'claude');
    const unread = s.messages.filter((x) => x.toHandle === m.handle && x.status !== 'acked').length;
    const what = bot ? `${bot.status}${bot.currentPath ? ` · ${esc(bot.currentPath.split('/').pop()!)}` : ''}` : 'no agent';
    return `<li><button class="who" data-h="${esc(m.handle)}">${dot(m.color, m.online)}<b>${esc(m.handle)}</b></button>
      <span class="sub">${m.online ? what : 'offline'}${unread ? ` · ✉ ${unread}` : ''}</span></li>`;
  }).join('');
  const fences = s.claims.map((c) => `<li><b style="color:${s.members.find((m) => m.handle === c.handle)?.color}">${esc(c.handle)}</b> fenced <code>${esc(c.path)}</code> <span class="sub">${ago(c.expiresAt - s.at)} left</span></li>`).join('') || '<li class="sub">no fences up</li>';
  const open = s.messages.filter((m) => m.status !== 'acked').map((m) =>
    `<li>${esc(m.fromHandle)} → ${esc(m.toHandle)} <span class="sub">${m.kind} · ${m.status === 'sent' ? 'waiting for delivery' : 'delivered'}</span><div class="sub">${esc(m.body)}</div></li>`).join('') || '<li class="sub">no open requests</li>';
  const certs = s.certifications.slice(-3).reverse().map((c) =>
    `<li>${c.result === 'bloom' ? '🌸' : '✋'} <code>${esc(c.path.split('/').pop()!)}</code> <span class="sub">${esc(c.reason)}</span></li>`).join('') || '<li class="sub">botanist has not been asked yet</li>';
  const feed = s.activity.slice(-12).reverse().map((a) => `<li>${esc(sentence(a))}</li>`).join('') || '<li class="sub">quiet garden</li>';
  el.innerHTML = `
    <h2>Garden shed</h2>${opts.source === 'fake' ? '<div class="badge">demo data</div>' : ''}
    <h3>Gardeners</h3><ul>${online}</ul>
    <h3>Fences</h3><ul>${fences}</ul>
    <h3>Open requests</h3><ul>${open}</ul>
    <h3>Botanist</h3><ul>${certs}</ul>
    <h3>Happening now</h3><ul class="feed">${feed}</ul>`;
  el.querySelectorAll<HTMLButtonElement>('button.who').forEach((b) => b.addEventListener('click', () => opts.onFollow(b.dataset.h!)));
}
