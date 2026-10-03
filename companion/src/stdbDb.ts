// Real SpacetimeDB implementation of SproutDb, over P1's generated bindings.
// One connection; subscribes to claim, config and messages addressed to this member.
// Reconnects with backoff; the daemon queues writes while disconnected.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DbConnection } from './module_bindings/index.ts';
import { files } from './config.ts';
import type { ActivityArgs, ClaimRowLite, SproutDb } from './db.ts';
import type { InboxMessage } from './events.ts';

type Log = (line: string) => void;
const CALL_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

export class StdbDb implements SproutDb {
  readonly impl = 'spacetimedb' as const;
  private conn: DbConnection | null = null;
  private connected = false;
  private closed = false;
  private handle = '';
  private listeners: ((c: boolean) => void)[] = [];
  private backoffMs = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private uri: string, private dbName: string, private log: Log) {}

  onState(cb: (c: boolean) => void): void { this.listeners.push(cb); }
  isConnected(): boolean { return this.connected && !!this.conn; }

  private setConnected(c: boolean): void {
    if (this.connected === c) return;
    this.connected = c;
    for (const l of this.listeners) l(c);
  }

  connect(handle: string): Promise<void> {
    this.handle = handle;
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        err ? reject(err) : resolve();
      };
      this.open(done);
    });
  }

  private open(done?: (err?: Error) => void): void {
    if (this.closed) return;
    let token: string | undefined;
    try { if (existsSync(files.token())) token = readFileSync(files.token(), 'utf8').trim() || undefined; } catch { /* fresh identity */ }
    const conn = DbConnection.builder()
      .withUri(this.uri)
      .withDatabaseName(this.dbName)
      .withToken(token)
      .onConnect((c, _identity, tok) => {
        try { writeFileSync(files.token(), tok, { mode: 0o600 }); } catch { /* ignore */ }
        this.log(`[stdb] connected to ${this.uri} db=${this.dbName}`);
        c.subscriptionBuilder()
          .onApplied(() => {
            this.backoffMs = 1000;
            this.setConnected(true);
            done?.();
          })
          .onError((ctx) => {
            const err = (ctx as { event?: unknown }).event;
            this.log(`[stdb] subscription error: ${String(err)}`);
            done?.(err instanceof Error ? err : new Error(`subscription error: ${String(err)}`));
          })
          .subscribe([
            'SELECT * FROM claim',
            'SELECT * FROM config',
            `SELECT * FROM message WHERE to_handle = ${sqlStr(this.handle)}`,
          ]);
      })
      .onConnectError((_ctx, err) => {
        this.log(`[stdb] connect error: ${String(err)}`);
        done?.(err);
        this.scheduleReconnect();
      })
      .onDisconnect((_ctx, err) => {
        this.log(`[stdb] disconnected${err ? `: ${String(err)}` : ''}`);
        this.setConnected(false);
        this.scheduleReconnect();
      })
      .build();
    this.conn = conn;
  }

  private scheduleReconnect(): void {
    this.setConnected(false);
    if (this.closed || this.reconnectTimer) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      try { this.conn?.disconnect(); } catch { /* already gone */ }
      this.conn = null;
      this.open();
    }, wait);
    this.reconnectTimer.unref?.();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try { this.conn?.disconnect(); } catch { /* ignore */ }
    this.setConnected(false);
  }

  // ---- cache ----
  claims(): ClaimRowLite[] {
    if (!this.conn) return [];
    return [...this.conn.db.claim.iter()].map((r) => ({
      id: String(r.id), path: r.path, handle: r.handle, expiresAt: r.expiresAt.toDate().getTime(),
    }));
  }
  config(key: string): string | undefined {
    if (!this.conn) return undefined;
    for (const r of this.conn.db.config.iter()) if (r.key === key) return r.value;
    return undefined;
  }
  undelivered(handle: string): InboxMessage[] {
    if (!this.conn) return [];
    return [...this.conn.db.message.iter()]
      .filter((m) => m.toHandle === handle && m.status === 'sent')
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((m) => ({ id: String(m.id), fromHandle: m.fromHandle, kind: m.kind, body: m.body, sentAt: m.sentAt.toDate().getTime() }));
  }

  // ---- reducers ----
  private r() {
    if (!this.conn || !this.connected) throw new Error('not connected');
    return this.conn.reducers;
  }
  joinMember(handle: string, color: string) { return withTimeout(this.r().joinMember({ handle, color }), CALL_TIMEOUT_MS, 'joinMember'); }
  setPaused(handle: string, paused: boolean) { return withTimeout(this.r().setPaused({ handle, paused }), CALL_TIMEOUT_MS, 'setPaused'); }
  heartbeat(handle: string) { return withTimeout(this.r().heartbeat({ handle }), CALL_TIMEOUT_MS, 'heartbeat'); }
  seedRepo(files: { path: string; lines: number }[]) { return withTimeout(this.r().seedRepo({ files }), 30_000, 'seedRepo'); }
  ingestActivity(a: ActivityArgs) {
    return withTimeout(this.r().ingestActivity({
      handle: a.handle, sessionId: a.sessionId, kind: a.kind, path: a.path,
      lines: a.lines, detail: a.detail, parentSessionId: a.parentSessionId,
    }), CALL_TIMEOUT_MS, 'ingestActivity');
  }
  recordTestRun(handle: string, repo: string, command: string, exitCode: number) {
    return withTimeout(this.r().recordTestRun({ handle, repo, command, exitCode }), CALL_TIMEOUT_MS, 'recordTestRun');
  }
  recordDiff(handle: string, paths: string[], commit?: string) {
    return withTimeout(this.r().recordDiff({ handle, paths, commit }), CALL_TIMEOUT_MS, 'recordDiff');
  }
  markDelivered(handle: string, id: string) {
    return withTimeout(this.r().markDelivered({ handle, id: BigInt(id) }), CALL_TIMEOUT_MS, 'markDelivered');
  }
}
