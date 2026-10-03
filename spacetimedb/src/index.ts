import { ScheduleAt } from 'spacetimedb';
import { t } from 'spacetimedb/server';
import spacetimedb, { sweepTimer, expireClaimsTimer, SeedFile } from './schema.ts';

export default spacetimedb;

const opt = t.option;

export const init = spacetimedb.init((ctx) => {
  for (const [key, value] of [['claimMode', 'warn'], ['claimTtlMinutes', '30'], ['requireReview', 'false']] as const) {
    if (!ctx.db.config.key.find(key)) ctx.db.config.insert({ key, value });
  }
  ctx.db.sweepTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(60_000_000n) });
  ctx.db.expireClaimsTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(60_000_000n) });
});

// ---- members ----
export const joinMember = spacetimedb.reducer({ handle: t.string(), color: t.string() }, (ctx, { handle, color }) => {
  const row = { handle, color, online: true, paused: false, lastSeen: ctx.timestamp };
  if (ctx.db.member.handle.find(handle)) ctx.db.member.handle.update(row);
  else ctx.db.member.insert(row);
});
export const setPaused = spacetimedb.reducer({ handle: t.string(), paused: t.bool() }, () => {});
export const heartbeat = spacetimedb.reducer({ handle: t.string() }, () => {});

// ---- repo + activity ----
export const seedRepo = spacetimedb.reducer({ files: t.array(SeedFile) }, () => {});
export const ingestActivity = spacetimedb.reducer(
  {
    handle: t.string(), sessionId: opt(t.string()), kind: t.string(), path: opt(t.string()),
    lines: opt(t.u32()), detail: opt(t.string()), parentSessionId: opt(t.string()),
  },
  (ctx, a) => {
    ctx.db.activity.insert({
      id: 0n, at: ctx.timestamp, handle: a.handle, sessionId: a.sessionId, kind: a.kind, path: a.path, detail: a.detail ?? '',
    });
  }
);
export const reportStatus = spacetimedb.reducer(
  { handle: t.string(), sessionId: opt(t.string()), status: t.string() }, () => {}
);
export const recordTestRun = spacetimedb.reducer(
  { handle: t.string(), repo: t.string(), command: t.string(), exitCode: t.i32() }, () => {}
);
export const recordDiff = spacetimedb.reducer(
  { handle: t.string(), paths: t.array(t.string()), commit: opt(t.string()) }, () => {}
);

// ---- claims ----
export const claimFiles = spacetimedb.reducer(
  { handle: t.string(), paths: t.array(t.string()), ttlMinutes: opt(t.u32()) }, () => {}
);
export const releaseFiles = spacetimedb.reducer({ handle: t.string(), paths: t.array(t.string()) }, () => {});

// ---- messages + handoffs ----
export const postMessage = spacetimedb.reducer(
  { fromHandle: t.string(), fromSession: opt(t.string()), toHandle: t.string(), kind: t.string(), body: t.string() },
  () => {}
);
export const markDelivered = spacetimedb.reducer({ handle: t.string(), id: t.u64() }, () => {});
export const ackMessage = spacetimedb.reducer({ handle: t.string(), id: t.u64() }, () => {});
export const offerHandoff = spacetimedb.reducer(
  { fromHandle: t.string(), toHandle: t.string(), task: t.string(), notes: t.string() }, () => {}
);
export const respondHandoff = spacetimedb.reducer({ handle: t.string(), id: t.u64(), accept: t.bool() }, () => {});

// ---- botanist ----
export const submitEvidence = spacetimedb.reducer({ handle: t.string(), path: t.string(), task: t.string() }, () => {});
export const submitReview = spacetimedb.reducer({ handle: t.string(), path: t.string(), ok: t.bool() }, () => {});

// ---- config ----
export const setConfig = spacetimedb.reducer({ key: t.string(), value: t.string() }, () => {});

// ---- scheduled ----
export const sweep = spacetimedb.reducer({ onSchedule: sweepTimer }, { arg: sweepTimer.rowType }, () => {});
export const expireClaims = spacetimedb.reducer(
  { onSchedule: expireClaimsTimer }, { arg: expireClaimsTimer.rowType }, () => {}
);
