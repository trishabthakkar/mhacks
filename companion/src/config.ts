// ~/.sprout: config.json, daemon.pid, daemon.log, queue.jsonl, spool.jsonl, token.
// SPROUT_HOME overrides the location (tests, running two members on one machine).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DAEMON_PORT } from '../../shared/constants.ts';

export interface JoinedRepo {
  /** Absolute git toplevel on this laptop. */
  root: string;
  /** Same on every laptop (origin's owner/name, else the folder name). Used as testRun.repo. */
  name: string;
}

export interface SproutConfig {
  handle: string;
  color: string;
  stdbUri: string;
  db: string;
  mcpUrl: string;
  repos: JoinedRepo[];
  paused: boolean;
  port?: number;
}

export function sproutHome(): string {
  return process.env.SPROUT_HOME || join(homedir(), '.sprout');
}

export const files = {
  config: () => join(sproutHome(), 'config.json'),
  pid: () => join(sproutHome(), 'daemon.pid'),
  starting: () => join(sproutHome(), 'daemon.starting'),
  log: () => join(sproutHome(), 'daemon.log'),
  queue: () => join(sproutHome(), 'queue.jsonl'),
  spool: () => join(sproutHome(), 'spool.jsonl'),
  token: () => join(sproutHome(), 'token'),
};

export function daemonPort(cfg?: Pick<SproutConfig, 'port'> | null): number {
  const env = Number(process.env.SPROUT_PORT);
  return env > 0 ? env : cfg?.port ?? DAEMON_PORT;
}

export function loadConfig(): SproutConfig | null {
  try {
    const c = JSON.parse(readFileSync(files.config(), 'utf8')) as SproutConfig;
    if (!c.handle) return null;
    c.repos ??= [];
    c.paused ??= false;
    return c;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: SproutConfig): void {
  mkdirSync(sproutHome(), { recursive: true, mode: 0o700 });
  const tmp = files.config() + '.tmp';
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, files.config());
}

/** The joined repo containing `absPath`, deepest root first. */
export function repoFor(cfg: Pick<SproutConfig, 'repos'>, absPath: string): JoinedRepo | undefined {
  let best: JoinedRepo | undefined;
  for (const r of cfg.repos) {
    if (absPath === r.root || absPath.startsWith(r.root.endsWith('/') ? r.root : r.root + '/')) {
      if (!best || r.root.length > best.root.length) best = r;
    }
  }
  return best;
}
