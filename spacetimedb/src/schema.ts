import { schema, table, t } from 'spacetimedb/server';

// Every table in CONTRACT.md. All public: browsers subscribe directly.
// Times are SpacetimeDB timestamps; ids are u64 (bigint in TS).

export const member = table(
  { public: true },
  {
    handle: t.string().primaryKey(),
    color: t.string(),
    online: t.bool(),
    paused: t.bool(),
    lastSeen: t.timestamp(),
  }
);

export const agent = table(
  { public: true },
  {
    sessionId: t.string().primaryKey(),
    handle: t.string(),
    kind: t.string(), // 'claude' | 'subagent'
    parentSessionId: t.option(t.string()),
    status: t.string(), // AGENT_STATUSES
    currentPath: t.option(t.string()),
    currentAction: t.string(),
    lastSeen: t.timestamp(),
  }
);

export const plant = table(
  { public: true },
  {
    path: t.string().primaryKey(),
    bed: t.string(),
    lines: t.u32(),
    stage: t.string(), // PLANT_STAGES
    bugs: t.u32(),
    lastActivity: t.timestamp(),
    lastTouchedBy: t.option(t.string()),
    lastDiffAt: t.option(t.timestamp()),
    lastBloomAt: t.option(t.timestamp()),
  }
);

export const claim = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    path: t.string(), // file, or dir prefix ending in '/'
    handle: t.string(),
    createdAt: t.timestamp(),
    expiresAt: t.timestamp(),
  }
);

export const message = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    fromHandle: t.string(),
    fromSession: t.option(t.string()),
    toHandle: t.string(),
    kind: t.string(), // MESSAGE_KINDS
    body: t.string(),
    status: t.string(), // MESSAGE_STATUSES
    sentAt: t.timestamp(),
    deliveredAt: t.option(t.timestamp()),
    ackedAt: t.option(t.timestamp()),
  }
);

export const handoff = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    fromHandle: t.string(),
    toHandle: t.string(),
    task: t.string(),
    notes: t.string(),
    status: t.string(), // HANDOFF_STATUSES
    createdAt: t.timestamp(),
  }
);

export const testRun = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    handle: t.string(),
    repo: t.string(),
    command: t.string(),
    exitCode: t.i32(),
    at: t.timestamp(),
  }
);

export const diff = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    handle: t.string(),
    path: t.string(),
    at: t.timestamp(),
    commit: t.option(t.string()),
  }
);

export const review = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    path: t.string(),
    handle: t.string(),
    ok: t.bool(),
    at: t.timestamp(),
  }
);

export const certification = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    path: t.string(),
    handle: t.string(),
    task: t.string(),
    result: t.string(), // 'bloom' | 'refused'
    reason: t.string(),
    at: t.timestamp(),
  }
);

export const activity = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    at: t.timestamp(),
    handle: t.string(),
    sessionId: t.option(t.string()),
    kind: t.string(), // ACTIVITY_KINDS
    path: t.option(t.string()),
    detail: t.string(),
  }
);

export const config = table(
  { public: true },
  {
    key: t.string().primaryKey(),
    value: t.string(),
  }
);

// Private schedule tables (not in client bindings).
export const sweepTimer = table(
  { name: 'sweep_timer' },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() }
);
export const expireClaimsTimer = table(
  { name: 'expire_claims_timer' },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() }
);

export const SeedFile = t.object('SeedFile', { path: t.string(), lines: t.u32() });

const spacetimedb = schema({
  member, agent, plant, claim, message, handoff, testRun, diff, review, certification, activity, config,
  sweepTimer, expireClaimsTimer,
});
export default spacetimedb;
