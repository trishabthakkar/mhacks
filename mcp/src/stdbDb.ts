// Real SproutDb: one long-lived SpacetimeDB connection via P1's generated bindings.
// Reads answer from the client cache (subscribed tables); writes call reducers.
// Reconnects with backoff; while reconnecting connection() is 'disconnected' and the
// tools tell the agent to retry.
import { DbConnection } from './module_bindings/index.ts';
import type {
  AgentView, CertificationView, ClaimView, HandoffView, MemberView, MessageView, ReportableStatus, SproutDb,
} from './db.ts';

const TABLES = ['member', 'agent', 'claim', 'message', 'handoff', 'certification', 'config'];
const REDUCER_TIMEOUT_MS = 10_000;

type Ts = { toDate(): Date };
const ms = (t: Ts) => t.toDate().getTime();
const optMs = (t: Ts | undefined) => (t ? ms(t) : undefined);

export class StdbDb implements SproutDb {
  private conn: DbConnection | undefined;
  private live = false;
  private closed = false;
  private backoff = 1000;
  private readyWaiters: Array<() => void> = [];
  private certWaiters = new Set<(c: CertificationView) => void>();

  constructor(private uri: string, private dbName: string, private log: (m: string) => void = console.log) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const conn = DbConnection.builder()
      .withUri(this.uri)
      .withDatabaseName(this.dbName)
      .onConnect((c) => {
        this.log(`[stdb] connected to ${this.uri}/${this.dbName}`);
        c.subscriptionBuilder()
          .onApplied(() => {
            if (this.conn !== c) return;
            this.live = true;
            this.backoff = 1000;
            for (const w of this.readyWaiters.splice(0)) w();
          })
          .onError((ctx) => this.log(`[stdb] subscription error: ${String((ctx as { event?: unknown }).event ?? 'unknown')}`))
          .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`));
        c.db.certification.onInsert((_ctx, row) => {
          const v = cert(row);
          for (const w of [...this.certWaiters]) w(v);
        });
      })
      .onConnectError((_ctx, e) => this.lost(conn, `connect error: ${e.message}`))
      .onDisconnect((_ctx, e) => this.lost(conn, `disconnected${e ? `: ${e.message}` : ''}`))
      .build();
    this.conn = conn;
  }

  private lost(conn: DbConnection, why: string): void {
    if (this.conn !== conn) return;
    this.live = false;
    if (this.closed) return;
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 15_000);
    this.log(`[stdb] ${why}; reconnecting in ${wait}ms`);
    setTimeout(() => this.connect(), wait).unref();
  }

  /** Resolves once the subscription cache is live. */
  ready(timeoutMs: number): Promise<void> {
    if (this.live) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`SpacetimeDB not ready after ${timeoutMs}ms (${this.uri}/${this.dbName})`)), timeoutMs);
      this.readyWaiters.push(() => { clearTimeout(t); resolve(); });
    });
  }

  close(): void {
    this.closed = true;
    this.live = false;
    this.conn?.disconnect();
  }

  private get c(): DbConnection {
    if (!this.conn || !this.live) throw new Error("Sprout's database is reconnecting. Try again in a few seconds.");
    return this.conn;
  }

  private async call<T>(p: Promise<T>): Promise<T> {
    let t: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error("Sprout's database didn't answer in time. Try again.")), REDUCER_TIMEOUT_MS);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(t);
    }
  }

  // ---- reads ----
  connection() { return this.live ? ('connected' as const) : ('disconnected' as const); }

  member(handle: string): MemberView | undefined {
    for (const m of this.c.db.member.iter()) if (m.handle === handle) return member(m);
    return undefined;
  }
  members(): MemberView[] { return [...this.c.db.member.iter()].map(member); }

  agents(): AgentView[] {
    return [...this.c.db.agent.iter()].map((a) => ({
      sessionId: a.sessionId, handle: a.handle, kind: a.kind as AgentView['kind'],
      parentSessionId: a.parentSessionId, status: a.status as AgentView['status'],
      currentPath: a.currentPath, currentAction: a.currentAction, lastSeen: ms(a.lastSeen),
    }));
  }

  claims(): ClaimView[] {
    const now = Date.now();
    return [...this.c.db.claim.iter()]
      .map((c) => ({ id: Number(c.id), path: c.path, handle: c.handle, createdAt: ms(c.createdAt), expiresAt: ms(c.expiresAt) }))
      .filter((c) => c.expiresAt > now);
  }

  handoffs(): HandoffView[] {
    return [...this.c.db.handoff.iter()].map((h) => ({
      id: Number(h.id), fromHandle: h.fromHandle, toHandle: h.toHandle, task: h.task, notes: h.notes,
      status: h.status as HandoffView['status'], createdAt: ms(h.createdAt),
    }));
  }

  messagesTo(handle: string): MessageView[] {
    return [...this.c.db.message.iter()].filter((m) => m.toHandle === handle).map(message);
  }
  message(id: number): MessageView | undefined {
    for (const m of this.c.db.message.iter()) if (Number(m.id) === id) return message(m);
    return undefined;
  }
  certifications(): CertificationView[] { return [...this.c.db.certification.iter()].map(cert); }

  config(key: string): string | undefined {
    for (const r of this.c.db.config.iter()) if (r.key === key) return r.value;
    return undefined;
  }

  // ---- writes (reducer argument shapes: CONTRACT.md "Generated casing") ----
  // Not part of SproutDb: used by integration tests and demo seeding.
  async joinMember(handle: string, color = '') { await this.call(this.c.reducers.joinMember({ handle, color })); }
  async seedRepo(files: Array<{ path: string; lines: number }>) { await this.call(this.c.reducers.seedRepo({ files })); }
  async claimFiles(handle: string, paths: string[], ttlMinutes: number) {
    await this.call(this.c.reducers.claimFiles({ handle, paths, ttlMinutes }));
  }
  async releaseFiles(handle: string, paths: string[]) {
    await this.call(this.c.reducers.releaseFiles({ handle, paths }));
  }
  async postMessage(fromHandle: string, toHandle: string, kind: MessageView['kind'], body: string) {
    await this.call(this.c.reducers.postMessage({ fromHandle, fromSession: undefined, toHandle, kind, body }));
  }
  async markDelivered(handle: string, ids: number[]) {
    for (const id of ids) await this.call(this.c.reducers.markDelivered({ handle, id: BigInt(id) }));
  }
  async ackMessage(handle: string, id: number) {
    await this.call(this.c.reducers.ackMessage({ handle, id: BigInt(id) }));
  }
  async offerHandoff(fromHandle: string, toHandle: string, task: string, notes: string) {
    await this.call(this.c.reducers.offerHandoff({ fromHandle, toHandle, task, notes }));
  }
  async respondHandoff(handle: string, id: number, accept: boolean) {
    await this.call(this.c.reducers.respondHandoff({ handle, id: BigInt(id), accept }));
  }
  async reportStatus(handle: string, sessionId: string | undefined, status: ReportableStatus) {
    await this.call(this.c.reducers.reportStatus({ handle, sessionId, status }));
  }
  async submitEvidence(handle: string, path: string, task: string) {
    await this.call(this.c.reducers.submitEvidence({ handle, path, task }));
  }
  async review(handle: string, path: string, ok: boolean) {
    await this.call(this.c.reducers.submitReview({ handle, path, ok }));
  }

  waitForCertification(pred: (c: CertificationView) => boolean, timeoutMs: number) {
    const existing = this.live ? this.certifications().find(pred) : undefined;
    if (existing) return Promise.resolve(existing);
    return new Promise<CertificationView | undefined>((resolve) => {
      const done = (c: CertificationView | undefined) => {
        clearTimeout(timer);
        this.certWaiters.delete(onCert);
        resolve(c);
      };
      const onCert = (c: CertificationView) => { if (pred(c)) done(c); };
      const timer = setTimeout(() => done(undefined), timeoutMs);
      this.certWaiters.add(onCert);
    });
  }
}

function member(m: { handle: string; color: string; online: boolean; paused: boolean; lastSeen: Ts }): MemberView {
  return { handle: m.handle, color: m.color, online: m.online, paused: m.paused, lastSeen: ms(m.lastSeen) };
}

function message(m: {
  id: bigint; fromHandle: string; fromSession: string | undefined; toHandle: string; kind: string; body: string;
  status: string; sentAt: Ts; deliveredAt: Ts | undefined; ackedAt: Ts | undefined;
}): MessageView {
  return {
    id: Number(m.id), fromHandle: m.fromHandle, fromSession: m.fromSession, toHandle: m.toHandle,
    kind: m.kind as MessageView['kind'], body: m.body, status: m.status as MessageView['status'],
    sentAt: ms(m.sentAt), deliveredAt: optMs(m.deliveredAt), ackedAt: optMs(m.ackedAt),
  };
}

function cert(c: { id: bigint; path: string; handle: string; task: string; result: string; reason: string; at: Ts }): CertificationView {
  return {
    id: Number(c.id), path: c.path, handle: c.handle, task: c.task,
    result: c.result as CertificationView['result'], reason: c.reason, at: ms(c.at),
  };
}
