// Wall-clock times shown to agents. Demo is in Ann Arbor; override with SPROUT_TZ.
const TZ = process.env.SPROUT_TZ ?? 'America/Detroit';

/** 1:05pm style. */
export function clock(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
    .replace(/\s/g, '')
    .toLowerCase();
}

export function minutesLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 60_000));
}
