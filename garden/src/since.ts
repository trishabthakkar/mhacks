// Pure: "since you were last here" — what changed in the garden while you were away, as a few short lines.
// Team-wide by default; with ?me=<handle> the things that are yours (messages, refusals on your files) come first.
import type { GardenSnapshot } from '../../shared/types.ts';
import type { Pick } from './pick.ts';
import { base, tidy } from './ui/fmt.ts';

export interface SinceLine { text: string; pick: Pick | null }
export interface SinceCard { title: string; lines: SinceLine[] }

const MIN = 60_000, MIN_GAP = 10 * MIN, MAX_LINES = 6;
const away = (ms: number) => {
  const m = Math.round(ms / MIN), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d >= 1 ? `${d}d` : h >= 1 ? `${h}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
};
const list = (xs: string[], n = 3) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` +${xs.length - n}` : ''}`;

export function sinceSummary(s: GardenSnapshot, since: number, me?: string): SinceCard | null {
  if (s.at - since < MIN_GAP) return null;
  const lines: SinceLine[] = [];
  const recent = <T extends { at: number }>(xs: T[]) => xs.filter((x) => x.at > since);
  const mine = new Set(me ? s.plants.filter((p) => p.lastTouchedBy === me).map((p) => p.path) : []);

  if (me) {
    const msgs = s.messages.filter((m) => m.toHandle === me && m.sentAt > since);
    if (msgs.length) lines.push({ text: `🦋 ${msgs.length} message${msgs.length === 1 ? '' : 's'} for you (from ${list([...new Set(msgs.map((m) => m.fromHandle))])})`, pick: { kind: 'member', key: me } });
  }
  const certs = recent(s.certifications);
  const refused = certs.filter((c) => c.result === 'refused');
  for (const c of refused.filter((c) => mine.has(c.path))) lines.push({ text: `✋ The botanist refused your ${base(c.path)}`, pick: { kind: 'plant', key: c.path } });

  const blooms = [...new Set(certs.filter((c) => c.result === 'bloom').map((c) => c.path))];
  if (blooms.length) lines.push({ text: `🌸 ${blooms.length} file${blooms.length === 1 ? '' : 's'} bloomed: ${list(blooms.map(base))}`, pick: blooms.length === 1 ? { kind: 'plant', key: blooms[0]! } : { kind: 'botanist' } });
  for (const c of refused.filter((c) => !mine.has(c.path)).slice(-2)) lines.push({ text: `✋ The botanist refused ${base(c.path)} (${c.handle})`, pick: { kind: 'plant', key: c.path } });
  for (const t of (s.tasks ?? []).filter((t) => t.status === 'done' && (t.doneAt ?? 0) > since).slice(-2)) {
    lines.push({ text: `✅ ${t.handle} finished "${tidy(t.title)}"`, pick: { kind: 'member', key: t.handle } });
  }
  for (const c of s.claims.filter((c) => c.createdAt > since && c.expiresAt > s.at).slice(-2)) {
    lines.push({ text: `🔒 ${c.handle} fenced ${c.path}`, pick: c.path.endsWith('/') ? { kind: 'member', key: c.handle } : { kind: 'plant', key: c.path } });
  }
  const commits = recent(s.activity).filter((a) => a.kind === 'commit').length;
  if (commits) lines.push({ text: `🌧️ ${commits} commit${commits === 1 ? '' : 's'}`, pick: { kind: 'pond' } });

  return lines.length ? { title: `Since you were last here (${away(s.at - since)} ago)`, lines: lines.slice(0, MAX_LINES) } : null;
}

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
/** The previous visit to this garden (per db), recording `now` as the new one. Storage that throws counts as no history. */
export function lastVisit(store: Store, garden: string, now: number): number | undefined {
  const key = `sprout.lastVisit.${garden}`;
  try {
    const prev = Number(store.getItem(key));
    store.setItem(key, String(now));
    return Number.isFinite(prev) && prev > 0 ? prev : undefined;
  } catch { return undefined; }
}
