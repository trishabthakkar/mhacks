import { ScheduleAt, Timestamp } from 'spacetimedb';
import { t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import spacetimedb, { sweepTimer, expireClaimsTimer, SeedFile } from './schema.ts';
import {
  AGENT_STATUSES, DEFAULT_CLAIM_MODE, DEFAULT_CLAIM_TTL_MIN, MAX_BUGS, MAX_COMMAND, MAX_DETAIL,
  MAX_MESSAGE_BODY, MEMBER_COLORS, MESSAGE_KINDS,
} from '../../shared/constants.ts';
import { checkEvidence } from '../../shared/botanist.ts';
import {
  LIM, bedOf, cap, claimMatches, claimsOverlap, fmtUntil, reqHandle, reqPath, reqText, toMs,
} from './rules.ts';
import { shouldGoDormant, wakeStage } from './stages.ts';

export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
const opt = t.option;
const MIN_US = 60_000_000n;

// Activity kinds a client may send through ingestActivity. The rest are written only by the module.
const CLIENT_KINDS = new Set([
  'session_start', 'session_end', 'prompt', 'read', 'search', 'edit', 'create', 'delete', 'bash',
  'tool_error', 'subagent_start', 'subagent_stop', 'waiting', 'idle', 'blocked_edit', 'shell_cmd', 'file_change',
]);
const TOOL_KINDS = new Set(['read', 'search', 'edit', 'create', 'delete', 'bash']);

// ---------------- helpers ----------------

function later(ctx: Ctx, minutes: number): Timestamp {
  return new Timestamp(ctx.timestamp.microsSinceUnixEpoch + BigInt(minutes) * MIN_US);
}

function cfg(ctx: Ctx, key: string): string | undefined {
  return ctx.db.config.key.find(key)?.value;
}

function log(
  ctx: Ctx, handle: string, kind: string, opts: { path?: string; detail?: string; sessionId?: string } = {}
) {
  ctx.db.activity.insert({
    id: 0n, at: ctx.timestamp, handle, kind, sessionId: opts.sessionId, path: opts.path,
    detail: cap(opts.detail ?? '', MAX_DETAIL),
  });
}

function pickColor(ctx: Ctx): string {
  const used = new Set([...ctx.db.member.iter()].map((m) => m.color));
  return MEMBER_COLORS.find((c) => !used.has(c)) ?? MEMBER_COLORS[Number(ctx.db.member.count()) % MEMBER_COLORS.length]!;
}

/** Find the member, creating them on first sight so hook ordering never loses events. */
function ensureMember(ctx: Ctx, handle: string) {
  const m = ctx.db.member.handle.find(handle);
  if (m) return m;
  return ctx.db.member.insert({ handle, color: pickColor(ctx), online: true, paused: false, lastSeen: ctx.timestamp });
}

/** Marks the member alive. Returns false if they're paused (caller drops the event). */
function touchMember(ctx: Ctx, handle: string): boolean {
  const m = ensureMember(ctx, handle);
  if (m.paused) return false;
  ctx.db.member.handle.update({ ...m, online: true, lastSeen: ctx.timestamp });
  return true;
}

type AgentRow = NonNullable<ReturnType<typeof ctxAgentFind>>;
function ctxAgentFind(ctx: Ctx, id: string) {
  return ctx.db.agent.sessionId.find(id);
}

function upsertAgent(ctx: Ctx, sessionId: string, handle: string, patch: Partial<AgentRow>) {
  const a = ctxAgentFind(ctx, sessionId);
  if (a) {
    ctx.db.agent.sessionId.update({ ...a, ...patch, lastSeen: ctx.timestamp });
  } else {
    ctx.db.agent.insert({
      sessionId, handle, kind: 'claude', parentSessionId: undefined, status: 'idle', currentPath: undefined,
      currentAction: 'idle', ...patch, lastSeen: ctx.timestamp,
    });
  }
}

function sendMessage(ctx: Ctx, fromHandle: string, fromSession: string | undefined, toHandle: string, kind: string, body: string) {
  const m = ctx.db.message.insert({
    id: 0n, fromHandle, fromSession, toHandle, kind, body: cap(body, MAX_MESSAGE_BODY), status: 'sent',
    sentAt: ctx.timestamp, deliveredAt: undefined, ackedAt: undefined,
  });
  log(ctx, fromHandle, 'message_sent', { sessionId: fromSession, detail: `→ ${toHandle} (${kind}) #${m.id}` });
  return m;
}

function reqMember(ctx: Ctx, handle: string) {
  const m = ctx.db.member.handle.find(handle);
  if (!m) throw new SenderError(`no teammate named "${handle}"`);
  return m;
}

/** Plants this member changed since that plant's last bloom. */
function touchedSinceBloom(ctx: Ctx, handle: string) {
  return [...ctx.db.plant.iter()].filter(
    (p) => p.lastTouchedBy === handle &&
      (!p.lastBloomAt || p.lastActivity.microsSinceUnixEpoch > p.lastBloomAt.microsSinceUnixEpoch)
  );
}

function removeClaims(ctx: Ctx, claims: { id: bigint; path: string; handle: string }[], why: string) {
  for (const c of claims) {
    ctx.db.claim.id.delete(c.id);
    log(ctx, c.handle, 'release', { path: c.path, detail: `released ${c.path} (${why})` });
  }
}

// ---------------- lifecycle ----------------

export const init = spacetimedb.init((ctx) => {
  const defaults: Array<[string, string]> = [
    ['claimMode', DEFAULT_CLAIM_MODE], ['claimTtlMinutes', String(DEFAULT_CLAIM_TTL_MIN)], ['requireReview', 'false'],
  ];
  for (const [key, value] of defaults) if (!ctx.db.config.key.find(key)) ctx.db.config.insert({ key, value });
  ctx.db.sweepTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(MIN_US) });
  ctx.db.expireClaimsTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(MIN_US) });
});

// ---------------- members ----------------

export const joinMember = spacetimedb.reducer({ handle: t.string(), color: t.string() }, (ctx, args) => {
  const handle = reqHandle(args.handle);
  let color = args.color.trim();
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new SenderError('color must look like #a1b2c3');
  const m = ctx.db.member.handle.find(handle);
  if (m) {
    ctx.db.member.handle.update({ ...m, color: color || m.color, online: true, lastSeen: ctx.timestamp });
  } else {
    color ||= pickColor(ctx);
    ctx.db.member.insert({ handle, color, online: true, paused: false, lastSeen: ctx.timestamp });
  }
});

export const setPaused = spacetimedb.reducer({ handle: t.string(), paused: t.bool() }, (ctx, args) => {
  const m = ensureMember(ctx, reqHandle(args.handle));
  ctx.db.member.handle.update({ ...m, paused: args.paused, lastSeen: ctx.timestamp });
});

export const heartbeat = spacetimedb.reducer({ handle: t.string() }, (ctx, args) => {
  const m = ensureMember(ctx, reqHandle(args.handle));
  ctx.db.member.handle.update({ ...m, online: true, lastSeen: ctx.timestamp });
});

/**
 * Removes a member and everything live they own: agents, fences, messages to/from them, open handoffs.
 * History (activity, diffs, test runs, reviews, certifications) stays for the timelapse; plants stay but forget them.
 * Idempotent. Any later event from that handle auto-joins them again, so stop their companion/sim first.
 */
export const removeMember = spacetimedb.reducer({ handle: t.string() }, (ctx, args) => {
  const handle = reqHandle(args.handle);
  ctx.db.member.handle.delete(handle);
  for (const a of [...ctx.db.agent.iter()]) if (a.handle === handle) ctx.db.agent.sessionId.delete(a.sessionId);
  for (const c of [...ctx.db.claim.iter()]) if (c.handle === handle) ctx.db.claim.id.delete(c.id);
  for (const m of [...ctx.db.message.iter()]) {
    if (m.fromHandle === handle || m.toHandle === handle) ctx.db.message.id.delete(m.id);
  }
  for (const h of [...ctx.db.handoff.iter()]) {
    if ((h.fromHandle === handle || h.toHandle === handle) && h.status === 'offered') ctx.db.handoff.id.delete(h.id);
  }
  for (const p of [...ctx.db.plant.iter()]) {
    if (p.lastTouchedBy === handle) ctx.db.plant.path.update({ ...p, lastTouchedBy: undefined });
  }
});

// ---------------- repo + activity ----------------

export const seedRepo = spacetimedb.reducer({ files: t.array(SeedFile) }, (ctx, { files }) => {
  if (files.length > 5000) throw new SenderError('seedRepo takes at most 5000 files per call');
  for (const f of files) {
    let path: string;
    try { path = reqPath(f.path); } catch { continue; } // skip bad entries, keep the rest
    const p = ctx.db.plant.path.find(path);
    if (p) {
      // Seeding (every `sprout join`) counts as activity: it wakes dormant plants.
      const stage = wakeStage(p);
      ctx.db.plant.path.update({ ...p, lines: f.lines, stage: stage === 'seed' && f.lines > 0 ? 'growing' : stage, lastActivity: ctx.timestamp });
    } else {
      ctx.db.plant.insert({
        path, bed: bedOf(path), lines: f.lines, stage: f.lines > 0 ? 'growing' : 'seed', bugs: 0,
        lastActivity: ctx.timestamp, lastTouchedBy: undefined, lastDiffAt: undefined, lastBloomAt: undefined,
      });
    }
  }
});

export const ingestActivity = spacetimedb.reducer(
  {
    handle: t.string(), sessionId: opt(t.string()), kind: t.string(), path: opt(t.string()),
    lines: opt(t.u32()), detail: opt(t.string()), parentSessionId: opt(t.string()),
  },
  (ctx, a) => {
    const handle = reqHandle(a.handle);
    const kind = a.kind.trim();
    if (!CLIENT_KINDS.has(kind)) throw new SenderError(`unknown or server-only activity kind "${kind}"`);
    const sessionId = a.sessionId ? reqText(a.sessionId, 'sessionId', LIM.session) : undefined;
    const path = a.path ? reqPath(a.path) : undefined;
    if (!touchMember(ctx, handle)) return; // paused: drop silently

    log(ctx, handle, kind, { path, sessionId, detail: a.detail });

    // Agent state.
    if (sessionId) {
      switch (kind) {
        case 'session_start':
          upsertAgent(ctx, sessionId, handle, { kind: 'claude', status: 'idle', currentAction: 'idle', currentPath: undefined });
          break;
        case 'session_end':
          upsertAgent(ctx, sessionId, handle, { status: 'dormant', currentAction: 'ended', currentPath: undefined });
          break;
        case 'prompt':
          upsertAgent(ctx, sessionId, handle, { status: 'working', currentAction: 'thinking' });
          break;
        case 'subagent_start': {
          const parent = a.parentSessionId ? reqText(a.parentSessionId, 'parentSessionId', LIM.session) : undefined;
          upsertAgent(ctx, sessionId, handle, {
            kind: 'subagent', parentSessionId: parent, status: 'working', currentAction: cap(a.detail ?? 'subagent', LIM.action),
          });
          break;
        }
        case 'subagent_stop':
          upsertAgent(ctx, sessionId, handle, { status: 'dormant', currentAction: 'done' });
          break;
        case 'waiting':
          upsertAgent(ctx, sessionId, handle, { status: 'waiting', currentAction: 'waiting' });
          break;
        case 'idle':
          upsertAgent(ctx, sessionId, handle, { status: 'idle', currentAction: 'idle' });
          break;
        case 'blocked_edit':
          upsertAgent(ctx, sessionId, handle, { status: 'blocked', currentAction: 'blocked', currentPath: path });
          break;
        default:
          if (TOOL_KINDS.has(kind)) upsertAgent(ctx, sessionId, handle, { status: 'working', currentAction: kind, currentPath: path });
          else upsertAgent(ctx, sessionId, handle, {});
      }
    }

    // Plant state.
    if (!path) return;
    const p = ctx.db.plant.path.find(path);
    if (kind === 'delete') {
      if (p) ctx.db.plant.path.delete(path);
      return;
    }
    if (kind === 'create' && !p) {
      ctx.db.plant.insert({
        path, bed: bedOf(path), lines: a.lines ?? 0, stage: 'seed', bugs: 0, lastActivity: ctx.timestamp,
        lastTouchedBy: handle, lastDiffAt: undefined, lastBloomAt: undefined,
      });
      return;
    }
    if (kind === 'edit' || kind === 'create' || kind === 'file_change') {
      if (!p) {
        ctx.db.plant.insert({
          path, bed: bedOf(path), lines: a.lines ?? 0, stage: 'growing', bugs: 0, lastActivity: ctx.timestamp,
          lastTouchedBy: handle, lastDiffAt: undefined, lastBloomAt: undefined,
        });
        return;
      }
      const woke = wakeStage(p);
      const stage = woke === 'seed' || woke === 'sprout' ? 'growing' : woke;
      ctx.db.plant.path.update({ ...p, lines: a.lines ?? p.lines, stage, lastActivity: ctx.timestamp, lastTouchedBy: handle });
      return;
    }
    // Any other activity on an existing plant: a seed sprouts, a dormant plant wakes.
    if (p) {
      const woke = wakeStage(p);
      ctx.db.plant.path.update({ ...p, stage: woke === 'seed' ? 'sprout' : woke, lastActivity: ctx.timestamp });
    }
  }
);

export const reportStatus = spacetimedb.reducer(
  { handle: t.string(), sessionId: opt(t.string()), status: t.string() },
  (ctx, a) => {
    const handle = reqHandle(a.handle);
    const status = a.status.trim();
    if (!(AGENT_STATUSES as readonly string[]).includes(status)) {
      throw new SenderError(`status must be one of ${AGENT_STATUSES.join(', ')}`);
    }
    ensureMember(ctx, handle);
    if (a.sessionId) {
      upsertAgent(ctx, reqText(a.sessionId, 'sessionId', LIM.session), handle, { status, currentAction: status });
      return;
    }
    const live = [...ctx.db.agent.iter()].filter((x) => x.handle === handle && x.status !== 'dormant' && x.kind === 'claude');
    if (live.length === 0) upsertAgent(ctx, `${handle}:mcp`, handle, { status, currentAction: status });
    for (const x of live) upsertAgent(ctx, x.sessionId, handle, { status, currentAction: status });
  }
);

export const recordTestRun = spacetimedb.reducer(
  { handle: t.string(), repo: t.string(), command: t.string(), exitCode: t.i32() },
  (ctx, a) => {
    const handle = reqHandle(a.handle);
    const repo = reqText(a.repo, 'repo', LIM.repo);
    const command = cap(a.command.trim(), MAX_COMMAND);
    if (!touchMember(ctx, handle)) return;
    ctx.db.testRun.insert({ id: 0n, handle, repo, command, exitCode: a.exitCode, at: ctx.timestamp });
    const pass = a.exitCode === 0;
    for (const p of touchedSinceBloom(ctx, handle)) {
      const bugs = pass ? 0 : Math.min(p.bugs + 1, MAX_BUGS);
      if (bugs !== p.bugs) ctx.db.plant.path.update({ ...p, bugs });
    }
    log(ctx, handle, pass ? 'test_pass' : 'test_fail', { detail: `${command} → exit ${a.exitCode}` });
  }
);

export const recordDiff = spacetimedb.reducer(
  { handle: t.string(), paths: t.array(t.string()), commit: opt(t.string()) },
  (ctx, a) => {
    const handle = reqHandle(a.handle);
    if (a.paths.length > 1000) throw new SenderError('recordDiff takes at most 1000 paths');
    const paths = [...new Set(a.paths.map(reqPath))];
    const commit = a.commit?.trim() ? reqText(a.commit, 'commit', LIM.commit) : undefined;
    if (!touchMember(ctx, handle)) return;

    for (const path of paths) {
      ctx.db.diff.insert({ id: 0n, handle, path, at: ctx.timestamp, commit });
      const p = ctx.db.plant.path.find(path);
      // Real diff = a bud waiting for the botanist. A bloomed plant goes back to bud.
      // Exception: a commit only records work earlier diffs already covered (the companion reports edits as they
      // happen). Letting it move lastDiffAt would demand a fresh test run after every commit and un-bloom
      // certified work. So a commit does not reset the evidence clock when a diff is already pending or the
      // plant is already certified.
      if (p) {
        const diffPending = !!p.lastDiffAt && (!p.lastBloomAt || p.lastDiffAt.microsSinceUnixEpoch > p.lastBloomAt.microsSinceUnixEpoch);
        const certified = p.stage === 'bloom' && !diffPending;
        if (commit && certified) continue; // committing certified work: nothing changes
        if (commit && diffPending) ctx.db.plant.path.update({ ...p, stage: wakeStage(p), lastActivity: ctx.timestamp, lastTouchedBy: handle });
        else ctx.db.plant.path.update({ ...p, stage: 'bud', lastActivity: ctx.timestamp, lastTouchedBy: handle, lastDiffAt: ctx.timestamp });
      } else {
        ctx.db.plant.insert({
          path, bed: bedOf(path), lines: 0, stage: 'bud', bugs: 0, lastActivity: ctx.timestamp,
          lastTouchedBy: handle, lastDiffAt: ctx.timestamp, lastBloomAt: undefined,
        });
      }
    }
    if (!commit) return;

    // One 'commit' per bed (the garden rains there); path is the bed name.
    const beds = new Map<string, number>();
    for (const path of paths) beds.set(bedOf(path), (beds.get(bedOf(path)) ?? 0) + 1);
    for (const [bed, n] of beds) {
      log(ctx, handle, 'commit', { path: bed, detail: `${commit.slice(0, 7)}: ${n} file${n === 1 ? '' : 's'} in ${bed}` });
    }
    const mine = [...ctx.db.claim.iter()].filter((c) => c.handle === handle && paths.some((f) => claimMatches(c.path, f)));
    removeClaims(ctx, mine, `committed ${commit.slice(0, 7)}`);
  }
);

// ---------------- claims ----------------

export const claimFiles = spacetimedb.reducer(
  { handle: t.string(), paths: t.array(t.string()), ttlMinutes: opt(t.u32()) },
  (ctx, a) => {
    const handle = reqHandle(a.handle);
    if (a.paths.length === 0) throw new SenderError('give at least one path to claim');
    if (a.paths.length > 50) throw new SenderError('claim at most 50 paths at once');
    const paths = [...new Set(a.paths.map(reqPath))];
    const ttl = Math.min(Math.max(a.ttlMinutes ?? Number(cfg(ctx, 'claimTtlMinutes') ?? DEFAULT_CLAIM_TTL_MIN), 1), 24 * 60);
    ensureMember(ctx, handle);

    const now = ctx.timestamp.microsSinceUnixEpoch;
    const active = [...ctx.db.claim.iter()].filter((c) => c.expiresAt.microsSinceUnixEpoch > now);
    for (const path of paths) {
      const clash = active.find((c) => c.handle !== handle && claimsOverlap(c.path, path));
      if (clash) {
        throw new SenderError(
          `${path} is fenced by ${clash.handle} (claim on ${clash.path}) until ${fmtUntil(clash.expiresAt, ctx.timestamp)}. ` +
          `Use post_finding to ask them, or work elsewhere.`
        );
      }
    }
    const expiresAt = later(ctx, ttl);
    for (const path of paths) {
      const own = active.find((c) => c.handle === handle && c.path === path);
      if (own) ctx.db.claim.id.update({ ...own, expiresAt });
      else ctx.db.claim.insert({ id: 0n, path, handle, createdAt: ctx.timestamp, expiresAt });
      log(ctx, handle, 'claim', { path, detail: `claimed ${path} for ${ttl} min` });
    }
  }
);

export const releaseFiles = spacetimedb.reducer({ handle: t.string(), paths: t.array(t.string()) }, (ctx, a) => {
  const handle = reqHandle(a.handle);
  const paths = new Set(a.paths.map(reqPath));
  const mine = [...ctx.db.claim.iter()].filter((c) => c.handle === handle && (paths.size === 0 || paths.has(c.path)));
  removeClaims(ctx, mine, 'released');
});

// ---------------- messages + handoffs ----------------

export const postMessage = spacetimedb.reducer(
  { fromHandle: t.string(), fromSession: opt(t.string()), toHandle: t.string(), kind: t.string(), body: t.string() },
  (ctx, a) => {
    const from = reqHandle(a.fromHandle);
    const to = reqHandle(a.toHandle);
    const kind = a.kind.trim();
    if (!(MESSAGE_KINDS as readonly string[]).includes(kind)) {
      throw new SenderError(`message kind must be one of ${MESSAGE_KINDS.join(', ')}`);
    }
    const body = a.body.trim();
    if (!body) throw new SenderError('message body is empty');
    const fromSession = a.fromSession ? reqText(a.fromSession, 'fromSession', LIM.session) : undefined;
    ensureMember(ctx, from);
    reqMember(ctx, to);
    sendMessage(ctx, from, fromSession, to, kind, body);
  }
);

function recipientMessage(ctx: Ctx, handle: string, id: bigint, verb: string) {
  const m = ctx.db.message.id.find(id);
  if (!m) throw new SenderError(`no message #${id}`);
  if (m.toHandle !== handle) throw new SenderError(`only ${m.toHandle} can ${verb} message #${id}`);
  return m;
}

export const markDelivered = spacetimedb.reducer({ handle: t.string(), id: t.u64() }, (ctx, a) => {
  const handle = reqHandle(a.handle);
  const m = recipientMessage(ctx, handle, a.id, 'mark delivered');
  if (m.status !== 'sent') return; // already delivered or acked
  ctx.db.message.id.update({ ...m, status: 'delivered', deliveredAt: ctx.timestamp });
  log(ctx, handle, 'message_delivered', { detail: `#${m.id} from ${m.fromHandle}` });
});

export const ackMessage = spacetimedb.reducer({ handle: t.string(), id: t.u64() }, (ctx, a) => {
  const handle = reqHandle(a.handle);
  const m = recipientMessage(ctx, handle, a.id, 'ack');
  if (m.status === 'acked') return;
  ctx.db.message.id.update({ ...m, status: 'acked', deliveredAt: m.deliveredAt ?? ctx.timestamp, ackedAt: ctx.timestamp });
  log(ctx, handle, 'message_acked', { detail: `#${m.id} from ${m.fromHandle}` });
});

export const offerHandoff = spacetimedb.reducer(
  { fromHandle: t.string(), toHandle: t.string(), task: t.string(), notes: t.string() },
  (ctx, a) => {
    const from = reqHandle(a.fromHandle);
    const to = reqHandle(a.toHandle);
    if (from === to) throw new SenderError("you can't hand off to yourself");
    const task = reqText(a.task, 'task', LIM.task);
    const notes = cap(a.notes.trim(), LIM.notes);
    ensureMember(ctx, from);
    reqMember(ctx, to);
    const h = ctx.db.handoff.insert({ id: 0n, fromHandle: from, toHandle: to, task, notes, status: 'offered', createdAt: ctx.timestamp });
    sendMessage(ctx, from, undefined, to, 'handoff', `Handoff #${h.id}: ${task}${notes ? ` — ${notes}` : ''}`);
    log(ctx, from, 'handoff_offered', { detail: `#${h.id} → ${to}: ${task}` });
  }
);

export const respondHandoff = spacetimedb.reducer({ handle: t.string(), id: t.u64(), accept: t.bool() }, (ctx, a) => {
  const handle = reqHandle(a.handle);
  const h = ctx.db.handoff.id.find(a.id);
  if (!h) throw new SenderError(`no handoff #${a.id}`);
  if (h.toHandle !== handle) throw new SenderError(`only ${h.toHandle} can respond to handoff #${h.id}`);
  if (h.status !== 'offered') throw new SenderError(`handoff #${h.id} was already ${h.status}`);
  ctx.db.handoff.id.update({ ...h, status: a.accept ? 'accepted' : 'declined' });
  if (a.accept) {
    log(ctx, handle, 'handoff_accepted', { detail: `#${h.id} from ${h.fromHandle}: ${h.task}` });
  } else {
    sendMessage(ctx, handle, undefined, h.fromHandle, 'system', `${handle} declined handoff #${h.id}: ${h.task}`);
  }
});

// ---------------- botanist ----------------

export const submitEvidence = spacetimedb.reducer({ handle: t.string(), path: t.string(), task: t.string() }, (ctx, a) => {
  const handle = reqHandle(a.handle);
  const path = reqPath(a.path);
  const task = cap(a.task.trim(), LIM.task);
  ensureMember(ctx, handle);
  const p = ctx.db.plant.path.find(path);
  if (!p) throw new SenderError(`no plant for ${path}; the botanist only certifies files the garden knows`);

  // One database = one team repo: evidence must be in the repo of the latest test run seen.
  const runs = [...ctx.db.testRun.iter()];
  const repo = runs.reduce<typeof runs[number] | undefined>(
    (best, r) => (!best || r.at.microsSinceUnixEpoch > best.at.microsSinceUnixEpoch ? r : best), undefined
  )?.repo ?? '';
  const verdict = checkEvidence({
    repo,
    lastDiffAt: p.lastDiffAt ? toMs(p.lastDiffAt) : undefined,
    lastBloomAt: p.lastBloomAt ? toMs(p.lastBloomAt) : undefined,
    testRuns: runs.map((r) => ({ repo: r.repo, exitCode: r.exitCode, at: toMs(r.at) })),
    reviews: [...ctx.db.review.iter()].filter((r) => r.path === path).map((r) => ({ handle: r.handle, ok: r.ok, at: toMs(r.at) })),
    requireReview: cfg(ctx, 'requireReview') === 'true',
    requester: handle,
  });

  if (verdict.ok) {
    ctx.db.plant.path.update({ ...p, stage: 'bloom', lastBloomAt: ctx.timestamp, bugs: 0, lastActivity: ctx.timestamp });
    ctx.db.certification.insert({ id: 0n, path, handle, task, result: 'bloom', reason: 'Bloom certified', at: ctx.timestamp });
    log(ctx, handle, 'certify_bloom', { path, detail: task ? `bloom: ${task}` : 'bloom certified' });
  } else {
    const reason = cap(verdict.missing.join('; '), LIM.reason);
    ctx.db.certification.insert({ id: 0n, path, handle, task, result: 'refused', reason, at: ctx.timestamp });
    log(ctx, handle, 'certify_refused', { path, detail: reason });
  }
});

export const submitReview = spacetimedb.reducer({ handle: t.string(), path: t.string(), ok: t.bool() }, (ctx, a) => {
  const handle = reqHandle(a.handle);
  const path = reqPath(a.path);
  ensureMember(ctx, handle);
  ctx.db.review.insert({ id: 0n, path, handle, ok: a.ok, at: ctx.timestamp });
});

// ---------------- config ----------------

const CONFIG_RULES: Record<string, (v: string) => boolean> = {
  claimMode: (v) => v === 'warn' || v === 'block',
  claimTtlMinutes: (v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 1440,
  requireReview: (v) => v === 'true' || v === 'false',
};

export const setConfig = spacetimedb.reducer({ key: t.string(), value: t.string() }, (ctx, a) => {
  const key = a.key.trim();
  const value = a.value.trim();
  const ok = CONFIG_RULES[key];
  if (!ok) throw new SenderError(`unknown config key "${key}" (known: ${Object.keys(CONFIG_RULES).join(', ')})`);
  if (!ok(value)) throw new SenderError(`bad value "${cap(value, 40)}" for ${key}`);
  if (ctx.db.config.key.find(key)) ctx.db.config.key.update({ key, value });
  else ctx.db.config.insert({ key, value });
});

// ---------------- scheduled ----------------

export const sweep = spacetimedb.reducer({ onSchedule: sweepTimer }, { arg: sweepTimer.rowType }, (ctx) => {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  for (const m of [...ctx.db.member.iter()]) {
    if (m.online && now - m.lastSeen.microsSinceUnixEpoch > 2n * MIN_US) ctx.db.member.handle.update({ ...m, online: false });
  }
  for (const a of [...ctx.db.agent.iter()]) {
    if (a.status !== 'dormant' && now - a.lastSeen.microsSinceUnixEpoch > 10n * MIN_US) {
      ctx.db.agent.sessionId.update({ ...a, status: 'dormant', currentAction: 'dormant' });
    }
  }
  for (const p of [...ctx.db.plant.iter()]) {
    if (shouldGoDormant(p, now)) ctx.db.plant.path.update({ ...p, stage: 'dormant' });
  }
});

export const expireClaims = spacetimedb.reducer(
  { onSchedule: expireClaimsTimer }, { arg: expireClaimsTimer.rowType },
  (ctx) => {
    const now = ctx.timestamp.microsSinceUnixEpoch;
    removeClaims(ctx, [...ctx.db.claim.iter()].filter((c) => c.expiresAt.microsSinceUnixEpoch <= now), 'expired');
  }
);
