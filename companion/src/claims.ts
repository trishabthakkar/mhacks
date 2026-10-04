// `sprout claim / release / claims`: fence files from the terminal, no agent needed.
// Paths are resolved from the current directory to repo-relative form; a directory
// (or anything ending in '/') becomes a `dir/` prefix claim. The module owns the rules.
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { call } from './client.ts';
import { daemonPort, loadConfig, repoFor, type SproutConfig } from './config.ts';
import type { ClaimRowLite } from './db.ts';
import { formatUntil } from './hookMap.ts';
import { relPath } from './redact.ts';

type Print = (s: string) => void;
const TIMEOUT_MS = 12_000;

/** Repo-relative claim path for a CLI argument, or an error string. */
export function toClaimPath(cfg: Pick<SproutConfig, 'repos'>, arg: string, cwd = process.cwd()): { path: string } | { error: string } {
  const abs = resolve(cwd, arg);
  const repo = repoFor(cfg, abs) ?? repoFor(cfg, cwd);
  if (!repo) return { error: `${arg}: not inside a joined repo (sprout join there first)` };
  const rel = relPath(repo.root, abs, cwd);
  if (!rel) return { error: `${arg}: that's the repo root or outside it; claim a file or folder inside` };
  let isDir = /[\\/]$/.test(arg);
  try { isDir ||= statSync(abs).isDirectory(); } catch { /* not on disk yet: claim as a file */ }
  return { path: isDir ? `${rel.replace(/\/+$/, '')}/` : rel };
}

async function daemon<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T | undefined> {
  const cfg = loadConfig();
  if (!cfg) { console.error('not joined yet: sprout join <team-code> --handle <name>'); return undefined; }
  try {
    return await call<T>(daemonPort(cfg), method, path, body, TIMEOUT_MS);
  } catch {
    console.error('the sprout daemon is not running. Start it with `sprout daemon` (or any Claude Code prompt), then try again.');
    return undefined;
  }
}

function resolveArgs(args: string[]): string[] | undefined {
  const cfg = loadConfig();
  if (!cfg) { console.error('not joined yet: sprout join <team-code> --handle <name>'); return undefined; }
  const out: string[] = [];
  for (const a of args) {
    const r = toClaimPath(cfg, a);
    if ('error' in r) { console.error(r.error); return undefined; }
    out.push(r.path);
  }
  return out;
}

export async function claim(args: string[], ttl: number | undefined, print: Print = console.log): Promise<number> {
  const paths = resolveArgs(args);
  if (!paths) return 2;
  const r = await daemon<{ ok: true; paths: string[]; until: number } | { ok: false; error: string }>('POST', '/claim', { paths, ttl });
  if (!r) return 1;
  if (!r.ok) { console.error(`not claimed: ${r.error}`); return 1; }
  print(`🪵 fenced ${r.paths.join(', ')} until ${formatUntil(r.until)}`);
  print('Teammates\' agents are warned (or blocked, in block mode) before editing these. `sprout release` when you\'re done; a commit releases them too.');
  return 0;
}

export async function release(args: string[], print: Print = console.log): Promise<number> {
  const paths = args.length ? resolveArgs(args) : [];
  if (!paths) return 2;
  const r = await daemon<{ ok: true; released: string[] } | { ok: false; error: string }>('POST', '/release', { paths });
  if (!r) return 1;
  if (!r.ok) { console.error(`not released: ${r.error}`); return 1; }
  print(r.released.length ? `released ${r.released.join(', ')}` : 'you had no fences');
  return 0;
}

export async function claims(print: Print = console.log): Promise<number> {
  const v = await daemon<{ me: string; claims: ClaimRowLite[] }>('GET', '/claims');
  if (!v) return 1;
  if (!v.claims.length) { print('No fences right now.'); return 0; }
  for (const c of v.claims) print(`  ${c.handle === v.me ? '★' : ' '} ${c.path.padEnd(40)} ${c.handle.padEnd(12)} until ${formatUntil(c.expiresAt)}`);
  return 0;
}
