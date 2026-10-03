// `sprout daemon`: one SpacetimeDB connection per laptop, a local HTTP API for hooks
// (127.0.0.1 only), an offline queue, heartbeat, and the git poller.
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, truncateSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ACTIVITY_KINDS, DEFAULT_CLAIM_MODE } from '../../shared/constants.ts';
import { daemonPort, files, loadConfig, repoFor, sproutHome, type JoinedRepo, type SproutConfig } from './config.ts';
import { FakeDb, openDb, type ActivityArgs, type ClaimRowLite, type SproutDb } from './db.ts';
import type { CheckResult, DaemonEvent, DaemonStatus, InboxMessage } from './events.ts';
import { GitPoller } from './gitFeed.ts';
import { formatUntil } from './hookMap.ts';
import { detail as cleanDetail, isTestCommand, redactCommand } from './redact.ts';

const HEARTBEAT_MS = 30_000;
const MAX_QUEUE = 5000;
const KINDS = new Set<string>(ACTIVITY_KINDS);

export type Op =
  | { op: 'ingestActivity'; args: ActivityArgs }
  | { op: 'recordTestRun'; args: { handle: string; repo: string; command: string; exitCode: number } }
  | { op: 'recordDiff'; args: { handle: string; paths: string[]; commit?: string } }
  | { op: 'markDelivered'; args: { handle: string; id: string } }
  | { op: 'setPaused'; args: { handle: string; paused: boolean } };

/** A claim matches a file if equal, or if the claim ends with '/' and the file starts with it. */
export function claimMatches(claimPath: string, path: string): boolean {
  return claimPath === path || (claimPath.endsWith('/') && path.startsWith(claimPath));
}

export function checkClaim(claims: ClaimRowLite[], me: string, path: string, mode: string | undefined, now = Date.now()): CheckResult {
  const m = mode === 'block' ? 'block' : mode === 'warn' ? 'warn' : DEFAULT_CLAIM_MODE;
  const hit = claims
    .filter((c) => c.handle !== me && c.expiresAt > now && claimMatches(c.path, path))
    .sort((a, b) => b.expiresAt - a.expiresAt)[0];
  return hit ? { fenced: true, mode: m, holder: hit.handle, claimPath: hit.path, expiresAt: hit.expiresAt } : { fenced: false, mode: m };
}

/** Only well-formed repo-relative paths leave the laptop. */
function safePath(p: unknown): string | undefined {
  if (typeof p !== 'string' || !p || p.length > 512) return undefined;
  if (p.startsWith('/') || p.split('/').includes('..') || /^[A-Za-z]:/.test(p)) return undefined;
  return p;
}

export class Daemon {
  cfg: SproutConfig;
  db!: SproutDb;
  queue: Op[] = [];
  recent: { at: number; text: string }[] = [];
  delivered = new Set<string>();
  server: Server | null = null;
  poller: GitPoller;
  private timers: NodeJS.Timeout[] = [];
  private flushing = false;
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(cfg: SproutConfig, private log: (s: string) => void = (s) => console.log(`${new Date().toISOString()} ${s}`)) {
    this.cfg = cfg;
    this.poller = new GitPoller(
      () => this.cfg.repos,
      (repo, paths) => this.enqueueOrSend({ op: 'recordDiff', args: { handle: this.cfg.handle, paths: paths.slice(0, 200) } }, `diff ${repo.name}: ${paths.length} path(s)`),
      (repo, path) => this.activity({ kind: 'file_change', path }, repo),
    );
  }

  // ---------- lifecycle ----------
  async start(opts: { db?: SproutDb; listen?: boolean; poll?: boolean } = {}): Promise<void> {
    mkdirSync(sproutHome(), { recursive: true, mode: 0o700 });
    this.loadQueue();
    this.ingestSpool();
    if (opts.listen !== false) await this.listen();
    this.db = opts.db ?? (await openDb(this.cfg, this.log));
    this.db.onState((c) => {
      this.log(`[daemon] db ${c ? 'connected' : 'disconnected'}`);
      if (c) void this.onConnected();
    });
    this.db.connect(this.cfg.handle).catch((e) => this.log(`[daemon] initial connect failed (will retry): ${String(e?.message ?? e)}`));
    const hb = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    const spool = setInterval(() => this.ingestSpool(), 2000);
    const cfgWatch = setInterval(() => this.reloadConfig(), 5000);
    this.timers.push(hb, spool, cfgWatch);
    for (const t of this.timers) t.unref?.();
    if (opts.poll !== false) this.poller.start();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.poller.stop();
    this.persistQueue();
    this.server?.close();
    this.db?.close();
  }

  private async onConnected(): Promise<void> {
    try {
      await this.db.joinMember(this.cfg.handle, this.cfg.color ?? '');
      if (this.cfg.paused) await this.db.setPaused(this.cfg.handle, true);
    } catch (e) { this.log(`[daemon] joinMember failed: ${String(e)}`); }
    await this.flush();
    void this.heartbeat();
  }

  private async heartbeat(): Promise<void> {
    if (this.cfg.paused || !this.db?.isConnected()) return;
    try { await this.db.heartbeat(this.cfg.handle); } catch (e) { this.log(`[daemon] heartbeat failed: ${String(e)}`); }
  }

  reloadConfig(): void {
    const c = loadConfig();
    if (!c) return;
    const wasPaused = this.cfg.paused;
    this.cfg = c;
    if (wasPaused !== c.paused) {
      this.log(`[daemon] ${c.paused ? 'paused' : 'resumed'}`);
      this.enqueueOrSend({ op: 'setPaused', args: { handle: c.handle, paused: c.paused } }, c.paused ? 'paused' : 'resumed');
    }
  }

  // ---------- queue ----------
  private loadQueue(): void {
    try {
      if (!existsSync(files.queue())) return;
      for (const line of readFileSync(files.queue(), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { this.queue.push(JSON.parse(line) as Op); } catch { /* skip torn line */ }
      }
      if (this.queue.length) this.log(`[daemon] loaded ${this.queue.length} queued op(s)`);
    } catch { /* fresh */ }
  }

  persistQueue(): void {
    try {
      const tmp = files.queue() + '.tmp';
      writeFileSync(tmp, this.queue.map((o) => JSON.stringify(o)).join('\n') + (this.queue.length ? '\n' : ''), { mode: 0o600 });
      renameSync(tmp, files.queue());
    } catch (e) { this.log(`[daemon] persist queue failed: ${String(e)}`); }
  }
  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = null; this.persistQueue(); }, 200);
  }

  /** Events hooks wrote while the daemon was down. */
  ingestSpool(): void {
    const f = files.spool();
    if (!existsSync(f)) return;
    const taken = `${f}.${process.pid}`;
    try { renameSync(f, taken); } catch { return; }
    try {
      for (const line of readFileSync(taken, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { this.handleEvent(JSON.parse(line) as DaemonEvent); } catch { /* skip */ }
      }
    } finally {
      try { unlinkSync(taken); } catch { /* ignore */ }
    }
  }

  enqueueOrSend(op: Op, label: string): void {
    this.note(label);
    if (this.db?.isConnected() && !this.queue.length) {
      void this.send(op).then((ok) => { if (!ok) this.enqueue(op); });
    } else {
      this.enqueue(op);
      if (this.db?.isConnected()) void this.flush();
    }
  }

  private enqueue(op: Op): void {
    this.queue.push(op);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    this.schedulePersist();
  }

  /** true = done (sent, or rejected by a module rule and dropped); false = retry later. */
  private async send(op: Op): Promise<boolean> {
    try {
      const a = op.args as never;
      switch (op.op) {
        case 'ingestActivity': await this.db.ingestActivity(op.args); break;
        case 'recordTestRun': await this.db.recordTestRun(op.args.handle, op.args.repo, op.args.command, op.args.exitCode); break;
        case 'recordDiff': await this.db.recordDiff(op.args.handle, op.args.paths, op.args.commit); break;
        case 'markDelivered': await this.db.markDelivered(op.args.handle, op.args.id); break;
        case 'setPaused': await this.db.setPaused(op.args.handle, op.args.paused); break;
        default: void a;
      }
      return true;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (!this.db.isConnected() || /not connected|timed out|disconnect|closed/i.test(msg)) return false;
      this.log(`[daemon] ${op.op} rejected: ${msg}`); // SenderError: module rule; don't retry
      return true;
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      let sent = 0;
      while (this.queue.length && this.db.isConnected()) {
        const ok = await this.send(this.queue[0]!);
        if (!ok) break;
        this.queue.shift();
        sent++;
      }
      if (sent) this.log(`[daemon] flushed ${sent} queued op(s)`);
      this.schedulePersist();
    } finally {
      this.flushing = false;
    }
  }

  private note(text: string): void {
    this.recent.push({ at: Date.now(), text });
    if (this.recent.length > 50) this.recent.shift();
    this.log(`[event] ${text}`);
  }

  // ---------- events ----------
  activity(e: { kind: string; path?: string; sessionId?: string; parentSessionId?: string; lines?: number; detail?: string }, repo?: JoinedRepo): void {
    if (this.cfg.paused) return;
    if (!KINDS.has(e.kind)) return;
    const args: ActivityArgs = {
      handle: this.cfg.handle,
      kind: e.kind,
      sessionId: typeof e.sessionId === 'string' ? e.sessionId.slice(0, 128) : undefined,
      parentSessionId: e.kind === 'subagent_start' && typeof e.parentSessionId === 'string' ? e.parentSessionId.slice(0, 128) : undefined,
      path: safePath(e.path),
      lines: typeof e.lines === 'number' && e.lines >= 0 && e.lines < 4_294_967_295 ? Math.floor(e.lines) : undefined,
      detail: cleanDetail(e.detail),
    };
    if ((args.kind === 'edit' || args.kind === 'create') && args.path && repo) this.poller.noteHookEdit(repo.name, args.path);
    this.enqueueOrSend({ op: 'ingestActivity', args }, `${args.kind}${args.path ? ` ${args.path}` : ''}${args.detail ? ` (${args.detail})` : ''}`);
  }

  handleEvent(ev: DaemonEvent): void {
    if (!ev || typeof ev !== 'object') return;
    if (this.cfg.paused) return; // pause: nothing is reported
    const byName = (n?: string) => this.cfg.repos.find((r) => r.name === n);
    switch (ev.type) {
      case 'activity':
        this.activity(ev, byName(ev.repo));
        return;
      case 'test_run': {
        const repo = byName(ev.repo);
        if (!repo) return;
        const command = redactCommand(String(ev.command ?? ''));
        if (!command) return;
        const exitCode = Number.isInteger(ev.exitCode) ? ev.exitCode : 1;
        this.enqueueOrSend({ op: 'recordTestRun', args: { handle: this.cfg.handle, repo: repo.name, command, exitCode } },
          `test ${exitCode === 0 ? 'pass' : 'fail'}: ${command}`);
        return;
      }
      case 'diff': {
        const repo = byName(ev.repo);
        if (!repo) return;
        const paths = (Array.isArray(ev.paths) ? ev.paths : []).map(safePath).filter((p): p is string => !!p).slice(0, 200);
        const commit = typeof ev.commit === 'string' && /^[0-9a-f]{7,64}$/.test(ev.commit) ? ev.commit : undefined;
        if (!paths.length && !commit) return;
        this.enqueueOrSend({ op: 'recordDiff', args: { handle: this.cfg.handle, paths, commit } }, `diff${commit ? ` ${commit.slice(0, 7)}` : ''}: ${paths.length} path(s)`);
        if (commit) this.activity({ kind: 'commit', detail: `${commit.slice(0, 7)} · ${paths.length} file(s)` }, repo);
        return;
      }
      case 'shell': {
        const cwd = String(ev.cwd ?? '');
        const repo = cwd ? repoFor(this.cfg, cwd) : undefined;
        if (!repo) return; // outside joined repos: nothing leaves
        const raw = String(ev.cmd ?? '').trim();
        if (!raw || /^\s*sprout(\s|$)/.test(raw)) return;
        const exitCode = Number.isFinite(Number(ev.exitCode)) ? Number(ev.exitCode) : 0;
        const command = redactCommand(raw);
        if (!command) return;
        if (isTestCommand(raw)) {
          this.enqueueOrSend({ op: 'recordTestRun', args: { handle: this.cfg.handle, repo: repo.name, command, exitCode } },
            `shell test ${exitCode === 0 ? 'pass' : 'fail'}: ${command}`);
        } else {
          this.activity({ kind: 'shell_cmd', detail: exitCode === 0 ? command : `${command} (exit ${exitCode})` }, repo);
        }
        return;
      }
    }
  }

  // ---------- queries ----------
  claimMode(): 'warn' | 'block' {
    const m = this.db?.config('claimMode');
    return m === 'block' ? 'block' : m === 'warn' ? 'warn' : DEFAULT_CLAIM_MODE;
  }

  check(path: string, session?: string): CheckResult {
    const res = checkClaim(this.db?.claims() ?? [], this.cfg.handle, path, this.claimMode());
    if (res.fenced && session !== undefined) {
      this.activity({
        kind: 'blocked_edit', path, sessionId: session || undefined,
        detail: res.mode === 'block' ? `fenced by ${res.holder} until ${formatUntil(res.expiresAt)}` : 'warned',
      });
    }
    return res;
  }

  inbox(): InboxMessage[] {
    return (this.db?.undelivered(this.cfg.handle) ?? []).filter((m) => !this.delivered.has(m.id));
  }

  markDelivered(ids: string[]): void {
    for (const id of ids) {
      if (typeof id !== 'string' || !/^\d+$/.test(id) || this.delivered.has(id)) continue;
      this.delivered.add(id);
      this.enqueueOrSend({ op: 'markDelivered', args: { handle: this.cfg.handle, id } }, `delivered message ${id}`);
    }
  }

  status(): DaemonStatus {
    const now = Date.now();
    return {
      handle: this.cfg.handle,
      connected: !!this.db?.isConnected(),
      impl: this.db?.impl ?? 'fake',
      paused: this.cfg.paused,
      claimMode: this.claimMode(),
      inbox: this.inbox().length,
      myClaims: (this.db?.claims() ?? []).filter((c) => c.handle === this.cfg.handle && c.expiresAt > now)
        .map((c) => ({ path: c.path, expiresAt: c.expiresAt })),
      recent: this.recent.slice(-5),
      queued: this.queue.length,
      repos: this.cfg.repos.map((r) => `${r.name} (${r.root})`),
    };
  }

  // ---------- http ----------
  listen(port = daemonPort(this.cfg)): Promise<void> {
    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => void this.route(req, res).catch((e) => {
        this.log(`[http] ${String(e)}`);
        if (!res.headersSent) { res.writeHead(500); res.end(); }
      }));
      srv.once('error', reject);
      srv.listen(port, '127.0.0.1', () => {
        srv.off('error', reject);
        this.server = srv;
        this.log(`[daemon] listening on 127.0.0.1:${port} as ${this.cfg.handle}`);
        resolve();
      });
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const json = (code: number, body: unknown) => {
      const buf = Buffer.from(JSON.stringify(body));
      res.writeHead(code, { 'content-type': 'application/json', 'content-length': buf.length });
      res.end(buf);
    };
    // Browsers can reach 127.0.0.1: refuse anything a web page could send cross-origin with credentials-free CORS.
    if (req.headers.origin) return json(403, { error: 'no browsers' });
    const key = `${req.method} ${url.pathname}`;
    switch (key) {
      case 'GET /health': return json(200, { ok: true, handle: this.cfg.handle });
      case 'GET /check': {
        const path = safePath(url.searchParams.get('path') ?? '');
        if (!path) return json(200, { fenced: false, mode: this.claimMode() });
        const session = url.searchParams.has('session') ? url.searchParams.get('session') ?? '' : undefined;
        return json(200, this.check(path, session));
      }
      case 'GET /inbox': return json(200, { messages: this.inbox() });
      case 'GET /status': return json(200, this.status());
      case 'POST /delivered': {
        const body = await readBody(req);
        const ids = (JSON.parse(body || '{}') as { ids?: unknown[] }).ids ?? [];
        this.markDelivered(ids.map(String));
        return json(200, { ok: true });
      }
      case 'POST /event': {
        const body = await readBody(req);
        json(202, { ok: true });
        const ctype = String(req.headers['content-type'] ?? '');
        if (ctype.includes('application/x-www-form-urlencoded')) {
          const f = new URLSearchParams(body);
          this.handleEvent({ type: 'shell', cmd: f.get('cmd') ?? '', exitCode: Number(f.get('ec') ?? 0), cwd: f.get('cwd') ?? '' });
        } else {
          const parsed = JSON.parse(body || 'null') as DaemonEvent | DaemonEvent[];
          for (const ev of Array.isArray(parsed) ? parsed : [parsed]) this.handleEvent(ev);
        }
        return;
      }
      case 'POST /fake/seed': {
        // Rehearsal/tests only: seed claims, messages and config into the fake db.
        if (!(this.db instanceof FakeDb)) return json(404, { error: 'not found' });
        const b = JSON.parse((await readBody(req)) || '{}') as {
          claims?: ClaimRowLite[]; messages?: FakeDb['messages']; config?: Record<string, string>;
        };
        if (b.claims) this.db.claimRows = b.claims;
        if (b.messages) this.db.messages.push(...b.messages);
        for (const [k, v] of Object.entries(b.config ?? {})) this.db.configRows.set(k, v);
        return json(200, { ok: true });
      }
      case 'GET /fake/calls':
        if (!(this.db instanceof FakeDb)) return json(404, { error: 'not found' });
        return json(200, { calls: this.db.calls });
      case 'POST /reload': this.reloadConfig(); return json(200, { ok: true, paused: this.cfg.paused });
      case 'POST /shutdown': json(200, { ok: true }); setTimeout(() => process.exit(0), 50); return;
      default: return json(404, { error: 'not found' });
    }
  }
}

function readBody(req: IncomingMessage, max = 256 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Entry point for `sprout daemon`. */
export async function runDaemon(): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) { console.error('sprout daemon: not joined yet (run `sprout join <team-code> --handle <name>`)'); return 1; }
  mkdirSync(sproutHome(), { recursive: true, mode: 0o700 });
  try { if (statSync(files.log()).size > 5 * 1024 * 1024) truncateSync(files.log(), 0); } catch { /* none */ }
  const d = new Daemon(cfg);
  try {
    await d.start();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') { console.error(`sprout daemon: port ${daemonPort(cfg)} in use (already running?)`); return 0; }
    throw e;
  }
  writeFileSync(files.pid(), String(process.pid));
  try { unlinkSync(files.starting()); } catch { /* ignore */ }
  const bye = () => {
    d.stop();
    try { if (readFileSync(files.pid(), 'utf8').trim() === String(process.pid)) unlinkSync(files.pid()); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  process.on('uncaughtException', (e) => { try { appendFileSync(files.log(), `${new Date().toISOString()} [daemon] uncaught: ${e?.stack ?? e}\n`); } catch { /* */ } });
  process.on('unhandledRejection', (e) => { try { appendFileSync(files.log(), `${new Date().toISOString()} [daemon] unhandled: ${String(e)}\n`); } catch { /* */ } });
  return await new Promise<number>(() => {}); // run forever
}
