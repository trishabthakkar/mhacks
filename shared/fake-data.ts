import type {
  ActivityKind, ActivityView, AgentView, ClaimView, GardenSnapshot, MemberView, MessageView, PlantView,
} from './types.ts';
import { MEMBER_COLORS } from './constants.ts';

// Fixed epoch (Sat Oct 3, 2026 12:00 EDT) so output never depends on the clock or randomness.
export const FAKE_START = Date.UTC(2026, 9, 3, 16, 0, 0);
const MIN = 60_000;
export const FAKE_REPO = 'mhacks';
export const FAKE_HANDLES = ['seno', 'manahil', 'shriya', 'trisha'] as const;

const FILES: Array<[string, number]> = [
  ['src/api/routes.ts', 120], ['src/api/auth.ts', 80], ['src/db.ts', 60],
  ['tests/api.test.ts', 90], ['README.md', 20], ['package.json', 15],
];

const bedOf = (p: string) => (p.includes('/') ? p.split('/')[0]! : '.');

/** Mutable working state for the script; snapshots are deep copies of it. */
type State = Omit<GardenSnapshot, 'at'> & { nextId: number };

function initialState(): State {
  const members: MemberView[] = FAKE_HANDLES.map((handle, i) => ({
    handle, color: MEMBER_COLORS[i]!, online: false, paused: false, lastSeen: FAKE_START,
  }));
  const plants: PlantView[] = FILES.map(([path, lines]) => ({
    path, bed: bedOf(path), lines, stage: 'seed', bugs: 0, lastActivity: FAKE_START,
  }));
  return {
    members, agents: [], plants, claims: [], messages: [], testRuns: [], certifications: [], activity: [],
    tasks: [], taskItems: [], nextId: 1,
  };
}

function log(s: State, at: number, handle: string, kind: ActivityKind, detail: string, path?: string, sessionId?: string) {
  const a: ActivityView = { id: s.nextId++, at, handle, kind, detail };
  if (path !== undefined) a.path = path;
  if (sessionId !== undefined) a.sessionId = sessionId;
  s.activity.push(a);
}
const plant = (s: State, path: string) => s.plants.find((p) => p.path === path)!;
const agent = (s: State, id: string) => s.agents.find((a) => a.sessionId === id)!;
const member = (s: State, h: string) => s.members.find((m) => m.handle === h)!;
const task = (s: State, h: string) => s.tasks!.find((t) => t.handle === h)!;
const items = (s: State, h: string) => s.taskItems!.filter((i) => i.taskId === task(s, h).id).sort((a, b) => a.ord - b.ord);
const setItem = (s: State, h: string, ord: number, state: 'pending' | 'in_progress' | 'completed', at: number) => {
  items(s, h)[ord]!.state = state; task(s, h).updatedAt = at;
};

// Each step advances the state by one scripted event; step i happens at FAKE_START + (i+1) minutes * 10.
const SCRIPT: Array<(s: State, at: number) => void> = [
  // 0: everyone joins; one bot each
  (s, at) => {
    for (const m of s.members) {
      m.online = true; m.lastSeen = at;
      s.agents.push({ sessionId: `s-${m.handle}`, handle: m.handle, kind: 'claude', status: 'idle', currentAction: 'idle', lastSeen: at });
      log(s, at, m.handle, 'session_start', 'session started', undefined, `s-${m.handle}`);
    }
  },
  // 1: trisha fences src/api/
  (s, at) => {
    const c: ClaimView = { id: s.nextId++, path: 'src/api/', handle: 'trisha', createdAt: at, expiresAt: at + 180 * MIN }; // outlives the whole fake timeline so the fence stays up until the commit releases it
    s.claims.push(c);
    log(s, at, 'trisha', 'claim', 'claimed src/api/', 'src/api/');
    // her task appears with a 3-item checklist
    const t = { id: s.nextId++, handle: 'trisha', title: 'Refactor the API routes', status: 'active' as const, bed: 'src', paths: ['src/api/'], createdAt: at, updatedAt: at };
    s.tasks!.push(t);
    ['Read routes.ts', 'Split the handlers', 'Run the tests'].forEach((text, ord) =>
      s.taskItems!.push({ id: s.nextId++, taskId: t.id, ord, text, state: ord === 0 ? 'in_progress' : 'pending' }));
  },
  // 2: trisha's bot edits routes.ts
  (s, at) => {
    const p = plant(s, 'src/api/routes.ts');
    p.stage = 'growing'; p.lines = 140; p.lastActivity = at; p.lastTouchedBy = 'trisha';
    Object.assign(agent(s, 's-trisha'), { status: 'working', currentPath: p.path, currentAction: 'edit', lastSeen: at });
    log(s, at, 'trisha', 'edit', 'edited routes.ts (+20 lines)', p.path, 's-trisha');
    // first item done, second in progress, file joins the task
    setItem(s, 'trisha', 0, 'completed', at); setItem(s, 'trisha', 1, 'in_progress', at);
    task(s, 'trisha').paths.push('src/api/routes.ts');
  },
  // 3: subagent trip starts (bee flies to src/db.ts)
  (s, at) => {
    const b: AgentView = {
      sessionId: 'sub-trisha-1', handle: 'trisha', kind: 'subagent', parentSessionId: 's-trisha',
      status: 'working', currentPath: 'src/db.ts', currentAction: 'read', lastSeen: at,
    };
    s.agents.push(b);
    plant(s, 'src/db.ts').stage = 'sprout';
    log(s, at, 'trisha', 'subagent_start', 'subagent started', 'src/db.ts', b.sessionId);
  },
  // 4: subagent returns
  (s, at) => {
    s.agents = s.agents.filter((a) => a.sessionId !== 'sub-trisha-1');
    log(s, at, 'trisha', 'subagent_stop', 'subagent finished', undefined, 'sub-trisha-1');
  },
  // 5: manahil's agent tries to edit the fenced file
  (s, at) => {
    Object.assign(agent(s, 's-manahil'), { status: 'blocked', currentPath: 'src/api/routes.ts', currentAction: 'blocked_edit', lastSeen: at });
    log(s, at, 'manahil', 'blocked_edit', 'routes.ts is fenced by trisha', 'src/api/routes.ts', 's-manahil');
    // manahil's task, blocked by the fence
    s.tasks!.push({ id: s.nextId++, handle: 'manahil', title: 'Add auth checks', status: 'blocked', bed: 'src', paths: ['src/api/auth.ts'], blockedReason: 'fenced by trisha until 3:00pm', createdAt: at, updatedAt: at });
  },
  // 6: manahil messages trisha (sent)
  (s, at) => {
    const m: MessageView = {
      id: s.nextId++, fromHandle: 'manahil', fromSession: 's-manahil', toHandle: 'trisha', kind: 'request',
      body: 'Can I touch src/api/auth.ts while you finish routes.ts?', status: 'sent', sentAt: at,
    };
    s.messages.push(m);
    log(s, at, 'manahil', 'message_sent', `→ trisha (request) #${m.id}`, undefined, 's-manahil');
  },
  // 7: delivered on trisha's next prompt
  (s, at) => {
    const m = s.messages[0]!; m.status = 'delivered'; m.deliveredAt = at;
    log(s, at, 'trisha', 'message_delivered', `#${m.id} from manahil`, undefined, 's-trisha');
  },
  // 8: acked
  (s, at) => {
    const m = s.messages[0]!; m.status = 'acked'; m.ackedAt = at;
    log(s, at, 'trisha', 'message_acked', `#${m.id} from manahil`, undefined, 's-trisha');
    // manahil works elsewhere, unblocked
    { const a = task(s, 'manahil'); a.status = 'active'; delete a.blockedReason; a.updatedAt = at; }
  },
  // 9: tests fail -> bugs
  (s, at) => {
    s.testRuns.push({ id: s.nextId++, handle: 'trisha', repo: FAKE_REPO, command: 'npm test', exitCode: 1, at });
    const p = plant(s, 'src/api/routes.ts'); p.bugs = 2; p.lastActivity = at;
    log(s, at, 'trisha', 'test_fail', 'npm test failed', undefined, 's-trisha');
  },
  // 10: botanist refuses
  (s, at) => {
    s.certifications.push({
      id: s.nextId++, path: 'src/api/routes.ts', handle: 'trisha', task: 'routes refactor',
      result: 'refused', reason: 'no passing test run seen after your last edit', at,
    });
    plant(s, 'src/api/routes.ts').stage = 'bud';
    log(s, at, 'trisha', 'certify_refused', 'botanist refused: no passing test run', 'src/api/routes.ts', 's-trisha');
    // roadblock on trisha's task, tests step starts
    { const t = task(s, 'trisha'); t.blockedReason = 'Botanist refused: no passing test run seen after your last edit'; }
    setItem(s, 'trisha', 1, 'completed', at); setItem(s, 'trisha', 2, 'in_progress', at);
  },
  // 11: tests pass -> bugs clear
  (s, at) => {
    s.testRuns.push({ id: s.nextId++, handle: 'trisha', repo: FAKE_REPO, command: 'npm test', exitCode: 0, at });
    plant(s, 'src/api/routes.ts').bugs = 0;
    log(s, at, 'trisha', 'test_pass', 'npm test passed', undefined, 's-trisha');
    setItem(s, 'trisha', 2, 'completed', at);
  },
  // 12: commit -> claim auto-released
  (s, at) => {
    plant(s, 'src/api/routes.ts').lastDiffAt = at;
    s.claims = [];
    log(s, at, 'trisha', 'commit', 'committed routes.ts', 'src/api/routes.ts', 's-trisha');
    log(s, at, 'trisha', 'release', 'claim on src/api/ released by commit', 'src/api/');
  },
  // 13: botanist grants bloom
  (s, at) => {
    s.testRuns.push({ id: s.nextId++, handle: 'trisha', repo: FAKE_REPO, command: 'npm test', exitCode: 0, at });
    const p = plant(s, 'src/api/routes.ts'); p.stage = 'bloom'; p.lastBloomAt = at;
    s.certifications.push({ id: s.nextId++, path: p.path, handle: 'trisha', task: 'routes refactor', result: 'bloom', reason: 'diff + passing tests after it', at });
    Object.assign(agent(s, 's-trisha'), { status: 'idle', currentAction: 'idle', lastSeen: at });
    log(s, at, 'trisha', 'certify_bloom', 'Bloom certified', p.path, 's-trisha');
    // task done
    { const t = task(s, 'trisha'); t.status = 'done'; t.doneAt = at; delete t.blockedReason; t.updatedAt = at; }
  },
];

export const FAKE_STEP_MS = 10 * MIN;
export const FAKE_STEPS = SCRIPT.length;

/** Snapshot after the first `step` script events (0 = bare soil, FAKE_STEPS = final). */
function snapshotAt(step: number): GardenSnapshot {
  const s = initialState();
  for (let i = 0; i < step; i++) SCRIPT[i]!(s, FAKE_START + (i + 1) * FAKE_STEP_MS);
  const { nextId: _unused, ...rest } = s;
  return { at: FAKE_START + step * FAKE_STEP_MS, ...rest };
}

/**
 * Deterministic timeline of `count` snapshots from bare soil to full bloom.
 * Same input → deep-equal output; no clock or randomness.
 */
export function makeFakeSnapshots(count: number): GardenSnapshot[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
  if (count === 1) return [snapshotAt(FAKE_STEPS)];
  return Array.from({ length: count }, (_, i) => snapshotAt(Math.round((i * FAKE_STEPS) / (count - 1))));
}
