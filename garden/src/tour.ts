// Pure: the judge tour (key R). A short, scripted walk through what the garden shows right now, each stop a thing
// to select (the camera flies there and the shed explains it) and one caption line. Stops with nothing to show are skipped.
import type { GardenSnapshot } from '../../shared/types.ts';
import type { Pick } from './pick.ts';
import { normalizeBed } from './layout.ts';
import { botFor, botLine } from './bots.ts';
import { overlaps } from './overlap.ts';
import { base } from './ui/fmt.ts';

export interface TourStop { pick: Pick; caption: string }
const HOUR = 3_600_000, DAY = 24 * HOUR;

export function tourStops(s: GardenSnapshot, repo: string): TourStop[] {
  const out: TourStop[] = [{ pick: { kind: 'garden' }, caption: `${repo}: our team's garden. Each bed is a folder, each plant a file` }];

  // the busiest bed in the last hour (else the biggest)
  const bedOf = new Map(s.plants.map((p) => [p.path, normalizeBed(p.bed)]));
  const score = new Map<string, number>();
  for (const p of s.plants) score.set(normalizeBed(p.bed), (score.get(normalizeBed(p.bed)) ?? 0) + 0.01);
  for (const a of s.activity) { const b = a.path && s.at - a.at <= HOUR ? bedOf.get(a.path) : undefined; if (b) score.set(b, (score.get(b) ?? 0) + 1); }
  const bed = [...score].sort((x, y) => y[1] - x[1])[0]?.[0];
  if (bed) {
    const n = s.plants.filter((p) => normalizeBed(p.bed) === bed).length;
    out.push({ pick: { kind: 'bed', key: bed }, caption: `${bed}: the busiest folder right now (${n} file${n === 1 ? '' : 's'})` });
  }

  const here = s.members.filter((m) => m.online);
  const busy = (h: string) => botFor(s, h).agent?.status === 'working';
  const awake = here.find((m) => busy(m.handle) && !botFor(s, m.handle).asleep) ?? here.find((m) => !botFor(s, m.handle).asleep);
  if (awake) out.push({ pick: { kind: 'member', key: awake.handle },
    caption: `${awake.handle}'s ${botLine(s, awake.handle)}${busy(awake.handle) ? ': their gardener works on the same file' : ''}` });

  const o = overlaps(s)[0];
  if (o) out.push({ pick: o.path.endsWith('/') ? { kind: 'member', key: o.b } : { kind: 'plant', key: o.path },
    caption: `⚠️ ${o.a} and ${o.b} are both on ${base(o.path)}: Sprout warns before a merge conflict` });

  const asleep = s.members.find((m) => m.handle !== awake?.handle && botFor(s, m.handle).asleep);
  if (asleep) out.push({ pick: { kind: 'member', key: asleep.handle }, caption: `${asleep.handle}'s ${botLine(s, asleep.handle)}` });

  if (s.activity.some((a) => a.kind === 'commit' && s.at - a.at <= DAY)) out.push({ pick: { kind: 'pond' }, caption: 'The pond: every lily pad is a commit from today' });

  const cert = s.certifications.at(-1);
  out.push({ pick: { kind: 'botanist' }, caption: cert
    ? `The botanist ${cert.result === 'bloom' ? 'certified' : 'refused'} ${base(cert.path)}: "done" means its tests ran and passed`
    : 'The botanist certifies a file only after its tests ran and passed' });
  return out;
}
