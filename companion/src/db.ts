// All SpacetimeDB access for the companion goes through this interface.
// Implementations: FakeDb (below, logs calls, in-memory cache) and StdbDb (stdbDb.ts, real
// SpacetimeDB via the generated bindings). Argument shapes follow CONTRACT.md "Generated casing".
import type { InboxMessage, MessageRow } from './events.ts';

export interface ClaimRowLite { id: string; path: string; handle: string; expiresAt: number }

export interface ActivityArgs {
  handle: string; sessionId?: string; kind: string; path?: string; lines?: number; detail?: string; parentSessionId?: string;
}

export interface SproutDb {
  readonly impl: 'fake' | 'spacetimedb';
  /** Connect and subscribe to claims, config and messages to `handle`. Resolves once the cache is live (or rejects). */
  connect(handle: string): Promise<void>;
  isConnected(): boolean;
  /** Called on every (re)connect / disconnect. */
  onState(cb: (connected: boolean) => void): void;
  close(): void;

  // ---- cache reads ----
  claims(): ClaimRowLite[];
  config(key: string): string | undefined;
  /** Messages to `handle` still in status 'sent'. */
  undelivered(handle: string): InboxMessage[];
  /** Every message to or from `handle`, oldest first. */
  messagesOf(handle: string): MessageRow[];

  // ---- reducers ----
  joinMember(handle: string, color: string): Promise<void>;
  setPaused(handle: string, paused: boolean): Promise<void>;
  heartbeat(handle: string): Promise<void>;
  seedRepo(files: { path: string; lines: number }[]): Promise<void>;
  ingestActivity(a: ActivityArgs): Promise<void>;
  recordTestRun(handle: string, repo: string, command: string, exitCode: number): Promise<void>;
  recordDiff(handle: string, paths: string[], commit?: string): Promise<void>;
  markDelivered(handle: string, id: string): Promise<void>;
  postMessage(fromHandle: string, toHandle: string, kind: string, body: string): Promise<void>;
  ackMessage(handle: string, id: string): Promise<void>;
  /** Fence files or `dir/` prefixes. Rejects (module SenderError) if someone else holds a match. */
  claimFiles(handle: string, paths: string[], ttlMinutes?: number): Promise<void>;
  /** Empty `paths`: release all of mine. */
  releaseFiles(handle: string, paths: string[]): Promise<void>;
}

type Log = (line: string) => void;

/** In-memory fake: logs every reducer call. Tests seed claims/messages/config directly. */
export class FakeDb implements SproutDb {
  readonly impl = 'fake' as const;
  calls: { name: string; args: unknown }[] = [];
  claimRows: ClaimRowLite[] = [];
  configRows = new Map<string, string>([['claimMode', 'warn'], ['claimTtlMinutes', '30'], ['requireReview', 'false']]);
  messages: MessageRow[] = [];
  /** Handles postMessage accepts (the module rejects unknown members). Empty: anyone. */
  members: string[] = [];
  connected = false;
  private listeners: ((c: boolean) => void)[] = [];

  constructor(private log: Log = () => {}) {}

  async connect(): Promise<void> { this.setConnected(true); }
  isConnected(): boolean { return this.connected; }
  onState(cb: (c: boolean) => void): void { this.listeners.push(cb); }
  setConnected(c: boolean): void { this.connected = c; for (const l of this.listeners) l(c); }
  close(): void { this.setConnected(false); }

  claims(): ClaimRowLite[] { return this.claimRows; }
  config(key: string): string | undefined { return this.configRows.get(key); }
  undelivered(handle: string): InboxMessage[] {
    return this.messages.filter((m) => m.toHandle === handle && m.status === 'sent')
      .map(({ id, fromHandle, kind, body, sentAt }) => ({ id, fromHandle, kind, body, sentAt }));
  }

  messagesOf(handle: string): MessageRow[] {
    return this.messages.filter((m) => m.toHandle === handle || m.fromHandle === handle);
  }

  private async call(name: string, args: unknown): Promise<void> {
    if (!this.connected) throw new Error('not connected');
    this.calls.push({ name, args });
    this.log(`[fakedb] ${name} ${JSON.stringify(args)}`);
  }
  joinMember(handle: string, color: string) { return this.call('joinMember', { handle, color }); }
  setPaused(handle: string, paused: boolean) { return this.call('setPaused', { handle, paused }); }
  heartbeat(handle: string) { return this.call('heartbeat', { handle }); }
  seedRepo(files: { path: string; lines: number }[]) { return this.call('seedRepo', { files: files.length }); }
  ingestActivity(a: ActivityArgs) { return this.call('ingestActivity', a); }
  recordTestRun(handle: string, repo: string, command: string, exitCode: number) {
    return this.call('recordTestRun', { handle, repo, command, exitCode });
  }
  recordDiff(handle: string, paths: string[], commit?: string) { return this.call('recordDiff', { handle, paths, commit }); }
  async markDelivered(handle: string, id: string) {
    await this.call('markDelivered', { handle, id });
    const m = this.messages.find((x) => x.id === id);
    if (m && m.status === 'sent') { m.status = 'delivered'; m.deliveredAt = Date.now(); }
  }
  async postMessage(fromHandle: string, toHandle: string, kind: string, body: string) {
    if (this.members.length && !this.members.includes(toHandle)) throw new Error(`unknown member ${toHandle}`);
    await this.call('postMessage', { fromHandle, toHandle, kind, body });
    const id = String(this.messages.reduce((n, m) => Math.max(n, Number(m.id)), 0) + 1);
    this.messages.push({ id, fromHandle, toHandle, kind, body, status: 'sent', sentAt: Date.now() });
  }
  async ackMessage(handle: string, id: string) {
    const m = this.messages.find((x) => x.id === id);
    if (!m) throw new Error(`no message #${id}`);
    if (m.toHandle !== handle) throw new Error(`only ${m.toHandle} can ack message #${id}`);
    await this.call('ackMessage', { handle, id });
    m.status = 'acked';
    m.ackedAt = Date.now();
  }

  async claimFiles(handle: string, paths: string[], ttlMinutes = 30) {
    const now = Date.now();
    for (const p of paths) {
      const clash = this.claimRows.find((c) => c.handle !== handle && c.expiresAt > now
        && (c.path === p || (c.path.endsWith('/') && p.startsWith(c.path)) || (p.endsWith('/') && c.path.startsWith(p))));
      if (clash) throw new Error(`${p} is fenced by ${clash.handle}`);
    }
    await this.call('claimFiles', { handle, paths, ttlMinutes });
    for (const p of paths) {
      this.claimRows = this.claimRows.filter((c) => !(c.handle === handle && c.path === p));
      this.claimRows.push({ id: String(this.claimRows.length + 1), path: p, handle, expiresAt: now + ttlMinutes * 60_000 });
    }
  }
  async releaseFiles(handle: string, paths: string[]) {
    await this.call('releaseFiles', { handle, paths });
    this.claimRows = this.claimRows.filter((c) => c.handle !== handle || (paths.length > 0 && !paths.includes(c.path)));
  }
}

/** Real db when the config names one (and SPROUT_FAKE_DB isn't set); otherwise the fake. */
export async function openDb(cfg: { stdbUri?: string; db?: string }, log: Log): Promise<SproutDb> {
  if (cfg.stdbUri && cfg.db && process.env.SPROUT_FAKE_DB !== '1') {
    const { StdbDb } = await import('./stdbDb.ts');
    return new StdbDb(cfg.stdbUri, cfg.db, log);
  }
  log('[db] using the fake db (no stdbUri/db in config, or SPROUT_FAKE_DB=1)');
  return new FakeDb(log);
}
