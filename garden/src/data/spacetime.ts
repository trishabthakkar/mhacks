import { DbConnection } from '../module_bindings/index.ts';
import type {
  ActivityKind, AgentView, GardenSnapshot, MessageView, PlantStage,
} from '../../../shared/types.ts';
import type { Store } from './store.ts';

export const DEFAULT_HOST = 'wss://maincloud.spacetimedb.com';
export const DEFAULT_DB = 'sprout-mhacks';

const TABLES = ['member', 'agent', 'plant', 'claim', 'message', 'test_run', 'certification', 'activity'];
const ACTIVITY_WINDOW = 200;

type Ts = { toDate(): Date };
const ms = (t: Ts) => t.toDate().getTime();
const optMs = (t: Ts | undefined) => (t ? ms(t) : undefined);
// Optional fields stay absent (not undefined) so the Store's JSON diff stays stable.
const opt = <T extends object>(o: T): T => {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
};

/**
 * Live source: subscribes to every public table via the generated bindings and pushes
 * GardenSnapshots into the Store. Resolves once the first snapshot is in; rejects on
 * connect error/timeout so the caller can fall back to demo data. Reconnects with backoff after that.
 */
export function connectLive(store: Store, host: string, db: string, timeoutMs = 10_000): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let stopped = false, settled = false, backoff = 1000, conn: DbConnection | undefined, pending = 0, first = true;

    const snapshot = (c: DbConnection): GardenSnapshot => {
      const activity = [...c.db.activity.iter()].sort((a, b) => Number(a.id - b.id)).slice(-ACTIVITY_WINDOW)
        .map((a) => opt({ id: Number(a.id), at: ms(a.at), handle: a.handle, sessionId: a.sessionId, kind: a.kind as ActivityKind, path: a.path, detail: a.detail }));
      return {
        at: Date.now(),
        members: [...c.db.member.iter()].map((m) => ({ handle: m.handle, color: m.color, online: m.online, paused: m.paused, lastSeen: ms(m.lastSeen) })),
        agents: [...c.db.agent.iter()].map((a) => opt({
          sessionId: a.sessionId, handle: a.handle, kind: a.kind as AgentView['kind'], parentSessionId: a.parentSessionId,
          status: a.status as AgentView['status'], currentPath: a.currentPath, currentAction: a.currentAction, lastSeen: ms(a.lastSeen),
        })),
        plants: [...c.db.plant.iter()].map((p) => opt({
          path: p.path, bed: p.bed, lines: p.lines, stage: p.stage as PlantStage, bugs: p.bugs, lastActivity: ms(p.lastActivity),
          lastTouchedBy: p.lastTouchedBy, lastDiffAt: optMs(p.lastDiffAt), lastBloomAt: optMs(p.lastBloomAt),
        })),
        claims: [...c.db.claim.iter()].map((x) => ({ id: Number(x.id), path: x.path, handle: x.handle, createdAt: ms(x.createdAt), expiresAt: ms(x.expiresAt) })),
        messages: [...c.db.message.iter()].map((m) => opt({
          id: Number(m.id), fromHandle: m.fromHandle, fromSession: m.fromSession, toHandle: m.toHandle, kind: m.kind as MessageView['kind'],
          body: m.body, status: m.status as MessageView['status'], sentAt: ms(m.sentAt), deliveredAt: optMs(m.deliveredAt), ackedAt: optMs(m.ackedAt),
        })),
        testRuns: [...c.db.testRun.iter()].map((t) => ({ id: Number(t.id), handle: t.handle, repo: t.repo, command: t.command, exitCode: t.exitCode, at: ms(t.at) })),
        certifications: [...c.db.certification.iter()].map((x) => ({
          id: Number(x.id), path: x.path, handle: x.handle, task: x.task, result: x.result as 'bloom' | 'refused', reason: x.reason, at: ms(x.at),
        })),
        activity,
      };
    };

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
          backoff = 1000;
          for (const t of ['member', 'agent', 'plant', 'claim', 'message', 'testRun', 'certification', 'activity'] as const) {
            const tbl = cc.db[t];
            tbl.onInsert(() => push(cc)); tbl.onUpdate(() => push(cc)); tbl.onDelete(() => push(cc));
          }
          cc.subscriptionBuilder()
            .onApplied(() => {
              store.set(snapshot(cc), true); first = false;
              if (!settled) { settled = true; resolve(() => { stopped = true; cc.disconnect(); }); }
            })
            .onError(() => { if (!settled) { settled = true; reject(new Error('subscription error')); } })
            .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`));
        })
        .onConnectError((_ctx, e) => { if (!settled) { settled = true; reject(e); } else retry(); })
        .onDisconnect(() => { if (settled) retry(); })
        .build();
      conn = c;
    };
    const retry = () => {
      if (stopped) return;
      const wait = backoff; backoff = Math.min(backoff * 2, 15_000);
      setTimeout(connect, wait);
    };
    setTimeout(() => { if (!settled) { settled = true; stopped = true; conn?.disconnect(); reject(new Error(`timed out connecting to ${host}/${db}`)); } }, timeoutMs);
    connect();
  });
}
