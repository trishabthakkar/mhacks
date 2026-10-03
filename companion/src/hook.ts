// `sprout hook <Event>`: reads the Claude Code payload on stdin, talks to the daemon with a
// 0.5s timeout, prints a decision when there is one, and ALWAYS exits 0 quickly (fail open).
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { daemonPort, files, loadConfig, sproutHome } from './config.ts';
import { call, isDown } from './client.ts';
import type { CheckResult, DaemonEvent, InboxMessage } from './events.ts';
import { inboxOutput, mapHook, preToolUseOutput, type HookPayload } from './hookMap.ts';

const MAX_COUNT_BYTES = 8 * 1024 * 1024;

/** Lines in a local file (only the number leaves the laptop). */
export function countLines(abs: string): number | undefined {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > MAX_COUNT_BYTES) return undefined;
    const buf = readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return undefined; // binary
    let n = 0;
    for (const b of buf) if (b === 10) n++;
    if (buf.length && buf[buf.length - 1] !== 10) n++;
    return n;
  } catch {
    return undefined;
  }
}

export function binPath(): string {
  return fileURLToPath(new URL('../bin/sprout.js', import.meta.url));
}

/** Start the daemon detached unless it's already starting (debounced via a stamp file). */
export async function ensureDaemon(): Promise<void> {
  try {
    mkdirSync(sproutHome(), { recursive: true, mode: 0o700 });
    try {
      if (Date.now() - statSync(files.starting()).mtimeMs < 10_000) return;
    } catch { /* no stamp */ }
    writeFileSync(files.starting(), String(Date.now()));
    const { spawn } = await import('node:child_process');
    const out = openSync(files.log(), 'a');
    const child = spawn(process.execPath, [binPath(), 'daemon'], { detached: true, stdio: ['ignore', out, out], env: process.env });
    child.unref();
    closeSync(out);
  } catch { /* fail open */ }
}

function spool(events: DaemonEvent[]): void {
  if (!events.length) return;
  try {
    mkdirSync(sproutHome(), { recursive: true, mode: 0o700 });
    appendFileSync(files.spool(), events.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
  } catch { /* fail open */ }
}

export async function readStdin(timeoutMs = 300): Promise<string> {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const done = () => resolve(Buffer.concat(chunks).toString('utf8'));
    const t = setTimeout(done, timeoutMs);
    process.stdin.on('data', (c: Buffer) => chunks.push(c));
    process.stdin.on('end', () => { clearTimeout(t); done(); });
    process.stdin.on('error', () => { clearTimeout(t); done(); });
  });
}

/** Returns what to print on stdout (or undefined). Never throws. */
export async function runHook(eventName: string, stdin: string): Promise<string | undefined> {
  try {
    const cfg = loadConfig();
    if (!cfg) return undefined;
    let payload: HookPayload = {};
    try { payload = JSON.parse(stdin || '{}') as HookPayload; } catch { return undefined; }
    const plan = mapHook(eventName, payload, { repos: cfg.repos, countLines });
    const port = daemonPort(cfg);
    let output: string | undefined;
    let down = false;

    const post = plan.events.length && !cfg.paused
      ? call(port, 'POST', '/event', plan.events).catch((e) => { if (isDown(e)) { down = true; spool(plan.events); } })
      : Promise.resolve();

    if (plan.check) {
      const q = `/check?path=${encodeURIComponent(plan.check.path)}&session=${encodeURIComponent(plan.check.sessionId ?? '')}`;
      const res = await call<CheckResult>(port, 'GET', q).catch((e) => { if (isDown(e)) down = true; return undefined; });
      if (res) output = preToolUseOutput(plan.check.path, res);
    }
    if (plan.inbox) {
      const res = await call<{ messages: InboxMessage[] }>(port, 'GET', '/inbox').catch((e) => { if (isDown(e)) down = true; return undefined; });
      const msgs = res?.messages ?? [];
      output = inboxOutput(msgs);
      if (msgs.length) await call(port, 'POST', '/delivered', { ids: msgs.map((m) => m.id) }).catch(() => {});
    }
    await post;
    if (down) await ensureDaemon();
    return output;
  } catch {
    return undefined;
  }
}

/** `sprout git-post-commit` (called from .git/hooks/post-commit, backgrounded). */
export async function runPostCommit(cwd = process.cwd()): Promise<void> {
  try {
    const cfg = loadConfig();
    if (!cfg || cfg.paused) return;
    const { commitInfo, git } = await import('./gitFeed.ts');
    const { repoFor } = await import('./config.ts');
    const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
    const repo = repoFor(cfg, root);
    if (!repo) return;
    const { sha, paths } = await commitInfo(root);
    const ev: DaemonEvent = { type: 'diff', repo: repo.name, paths: paths.slice(0, 200), commit: sha };
    await call(daemonPort(cfg), 'POST', '/event', [ev], 1000).catch(async (e) => {
      if (isDown(e)) { spool([ev]); await ensureDaemon(); }
    });
  } catch { /* fail open */ }
}
