import { DbConnection } from '../module_bindings/index.ts';
import type {
  ActivityKind, AgentView, GardenSnapshot, HandoffStatus, MessageView, PlantStage,
} from '../../../shared/types.ts';
import { AGENT_STATUSES, MESSAGE_KINDS, MESSAGE_STATUSES, PLANT_STAGES } from '../../../shared/constants.ts';
import type { Store } from './store.ts';

export const DEFAULT_HOST = 'wss://maincloud.spacetimedb.com';
export const DEFAULT_DB = 'sprout-mhacks';

const TABLES = ['member', 'agent', 'plant', 'claim', 'message', 'test_run', 'certification', 'activity', 'handoff'];
const ACTIVITY_WINDOW = 200;

export type LiveState = { state: 'live' } | { state: 'reconnecting'; attempt: number };

/** Unknown values from the database degrade to a safe default instead of crashing the scene. */
const oneOf = <T extends string>(v: string, list: readonly T[], dflt: T): T => ((list as readonly string[]).includes(v) ? (v as T) : dflt);
const num = (n: number, dflt = 0) => (Number.isFinite(n) ? n : dflt);

type Ts = { toDate(): Date };
const ms = (t: Ts) => t.toDate().getTime();
const optMs = (t: Ts | undefined) => (t ? ms(t) : undefined);
// Optional fields stay absent (not undefined) so the Store's JSON diff stays stable.
const opt = <T extends object>(o: T): T => {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
};

type Tbl<T> = { iter(): Iterable<T> };
type Db = DbConnection['db'];
type Row<K extends keyof Db> = Db[K] extends Tbl<infer R> ? R : never;
/** The tables buildSnapshot reads; a real `conn.db` satisfies this, and tests can pass plain arrays. */
export interface LiveTables {
  member: Tbl<Row<'member'>>; agent: Tbl<Row<'agent'>>; plant: Tbl<Row<'plant'>>; claim: Tbl<Row<'claim'>>;
  message: Tbl<Row<'message'>>; testRun: Tbl<Row<'testRun'>>; certification: Tbl<Row<'certification'>>; activity: Tbl<Row<'activity'>>;
  handoff?: Tbl<Row<'handoff'>>;
}

/** Pure mapping from subscribed rows to the GardenSnapshot the scene renders. Optional fields stay absent. */
export function buildSnapshot(db: LiveTables, now: number): GardenSnapshot {
  const activity = [...db.activity.iter()].sort((a, b) => Number(a.id - b.id)).slice(-ACTIVITY_WINDOW)
    .map((a) => opt({ id: Number(a.id), at: ms(a.at), handle: a.handle, sessionId: a.sessionId, kind: a.kind as ActivityKind, path: a.path, detail: a.detail }));
  return {
    at: now,
    members: [...db.member.iter()].map((m) => ({ handle: m.handle, color: m.color, online: m.online, paused: m.paused, lastSeen: ms(m.lastSeen) })),
    agents: [...db.agent.iter()].map((a) => opt({
      sessionId: a.sessionId, handle: a.handle, kind: a.kind === 'subagent' ? 'subagent' : 'claude', parentSessionId: a.parentSessionId,
      status: oneOf(a.status, AGENT_STATUSES, 'idle'), currentPath: a.currentPath, currentAction: a.currentAction, lastSeen: ms(a.lastSeen),
    })),
    plants: [...db.plant.iter()].map((p) => opt({
      path: p.path, bed: p.bed, lines: num(p.lines), stage: oneOf(p.stage, PLANT_STAGES, 'growing') as PlantStage, bugs: Math.min(5, Math.max(0, num(p.bugs))), lastActivity: ms(p.lastActivity),
      lastTouchedBy: p.lastTouchedBy, lastDiffAt: optMs(p.lastDiffAt), lastBloomAt: optMs(p.lastBloomAt),
    })),
    claims: [...db.claim.iter()].map((x) => ({ id: Number(x.id), path: x.path, handle: x.handle, createdAt: ms(x.createdAt), expiresAt: ms(x.expiresAt) })),
    messages: [...db.message.iter()].map((m) => opt({
      id: Number(m.id), fromHandle: m.fromHandle, fromSession: m.fromSession, toHandle: m.toHandle, kind: oneOf(m.kind, MESSAGE_KINDS, 'finding'),
      body: m.body, status: oneOf(m.status, MESSAGE_STATUSES, 'sent'), sentAt: ms(m.sentAt), deliveredAt: optMs(m.deliveredAt), ackedAt: optMs(m.ackedAt),
    })),
    testRuns: [...db.testRun.iter()].map((t) => ({ id: Number(t.id), handle: t.handle, repo: t.repo, command: t.command, exitCode: t.exitCode, at: ms(t.at) })),
    certifications: [...db.certification.iter()].map((x) => ({
      id: Number(x.id), path: x.path, handle: x.handle, task: x.task, result: x.result as 'bloom' | 'refused', reason: x.reason, at: ms(x.at),
    })),
    activity,
    ...(db.handoff ? { handoffs: [...db.handoff.iter()].map((h) => ({
      id: Number(h.id), fromHandle: h.fromHandle, toHandle: h.toHandle, task: h.task, notes: h.notes,
      status: h.status as HandoffStatus, createdAt: ms(h.createdAt),
    })) } : {}),
  };
}

/**
 * Live source: subscribes to every public table via the generated bindings and pushes
 * GardenSnapshots into the Store. Resolves once the first snapshot is in; rejects on
 * connect error/timeout so the caller can fall back to demo data. Reconnects with backoff after that.
 */
export function connectLive(store: Store, host: string, db: string, timeoutMs = 10_000, onState?: (s: LiveState) => void): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let stopped = false, settled = false, backoff = 1000, conn: DbConnection | undefined, pending = 0, first = true, attempt = 0;

    const snapshot = (c: DbConnection): GardenSnapshot => buildSnapshot(c.db, Date.now());

    const push = (c: DbConnection) => {
      if (pending) return;
      pending = window.setTimeout(() => {
        pending = 0;
        store.set(snapshot(c), first); first = false; // first snapshot is a reset: don't replay history
      }, 60);
    };

    const connect = () => {
      if (stopped) return;
      const c = DbConnection.builder()
        .withUri(host)
        .withDatabaseName(db)
        .onConnect((cc) => {
          backoff = 1000; first = true; // a (re)connect starts from a clean snapshot: no history replayed as new events
          for (const t of ['member', 'agent', 'plant', 'claim', 'message', 'testRun', 'certification', 'activity', 'handoff'] as const) {
            const tbl = cc.db[t];
            tbl.onInsert(() => push(cc)); tbl.onUpdate(() => push(cc)); tbl.onDelete(() => push(cc));
          }
          cc.subscriptionBuilder()
            .onApplied(() => {
              store.set(snapshot(cc), true); first = false; attempt = 0; onState?.({ state: 'live' });
              if (!settled) { settled = true; resolve(() => { stopped = true; cc.disconnect(); }); }
            })
            .onError(() => { if (!settled) { settled = true; stopped = true; reject(new Error('subscription error')); } })
            .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`));
        })
        .onConnectError((_ctx, e) => { if (!settled) { settled = true; stopped = true; reject(e); } else retry(); })
        .onDisconnect(() => { if (!settled) { settled = true; stopped = true; reject(new Error('disconnected before the first snapshot')); } else retry(); })
        .build();
      conn = c;
    };
    const retry = () => {
      if (stopped) return;
      const wait = backoff; backoff = Math.min(backoff * 2, 15_000);
      onState?.({ state: 'reconnecting', attempt: ++attempt });
      setTimeout(connect, wait);
    };
    setTimeout(() => { if (!settled) { settled = true; stopped = true; conn?.disconnect(); reject(new Error(`timed out connecting to ${host}/${db}`)); } }, timeoutMs);
    connect();
  });
}
