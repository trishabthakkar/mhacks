// Pure helpers for the module: validation, caps, claim matching. No spacetimedb tables here.
import { SenderError } from 'spacetimedb/server';
import type { Timestamp } from 'spacetimedb';

export const LIM = {
  handle: 32, session: 128, path: 300, repo: 120, commit: 64, task: 200, notes: 400, reason: 300, action: 40,
  taskTitle: 80, blocked: 120,
} as const;

export const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

export function reqText(raw: string, what: string, max: number): string {
  const s = raw.trim();
  if (!s) throw new SenderError(`${what} is required`);
  if (s.length > max) throw new SenderError(`${what} is longer than ${max} characters`);
  return s;
}

export function reqHandle(raw: string): string {
  const h = reqText(raw, 'handle', LIM.handle);
  if (!/^[A-Za-z0-9_.-]+$/.test(h)) throw new SenderError(`handle "${h}" may only use letters, digits, _ . -`);
  return h;
}

/** Repo-relative path. Directory claims end with '/'. */
export function reqPath(raw: string): string {
  const p = reqText(raw, 'path', LIM.path);
  if (p.startsWith('/')) throw new SenderError(`path "${p}" must be relative to the repo root`);
  if (p.split('/').includes('..')) throw new SenderError(`path "${p}" must not contain a ".." segment`);
  return p;
}

/** Bed = first path segment, or '(root)' for top-level files. */
export const bedOf = (path: string) => (path.includes('/') ? path.split('/')[0]! : '(root)');

/** A claim matches a file if equal, or the claim ends with '/' and the file starts with it. */
export const claimMatches = (claimPath: string, file: string) =>
  claimPath === file || (claimPath.endsWith('/') && file.startsWith(claimPath));

/** Two claims collide if either covers the other (so 'src/' clashes with 'src/a.ts'). */
export const claimsOverlap = (a: string, b: string) => claimMatches(a, b) || claimMatches(b, a);

export const toMs = (ts: Timestamp) => Number(ts.microsSinceUnixEpoch / 1000n);

// The module has no local timezone. MHacks is in Ann Arbor (EDT, UTC-4, until Nov 1), so times are shown in EDT,
// matching the companion's local 12h format ("2:40am").
const EDT_OFFSET_MS = -4 * 60 * 60_000;

/** "4:40pm (in 23 min)" */
export function fmtUntil(until: Timestamp, now: Timestamp): string {
  const d = new Date(toMs(until) + EDT_OFFSET_MS);
  const h24 = d.getUTCHours();
  const hhmm = `${h24 % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')}${h24 >= 12 ? 'pm' : 'am'}`;
  const mins = Math.max(0, Math.ceil((toMs(until) - toMs(now)) / 60_000));
  return `${hhmm} (in ${mins} min)`;
}
