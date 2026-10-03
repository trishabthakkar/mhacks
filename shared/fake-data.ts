import type {
  ActivityKind, ActivityView, AgentView, ClaimView, GardenSnapshot, MemberView, MessageView, PlantView,
} from './types.ts';
import { MEMBER_COLORS } from './constants.ts';

// Fixed epoch (Sat Oct 3, 2026 12:00 EDT) so output never depends on the clock or randomness.
export const FAKE_START = Date.UTC(2026, 9, 3, 16, 0, 0);
const MIN = 60_000;
export const FAKE_REPO = 'mhacks';
export const FAKE_HANDLES = ['trisha', 'alex', 'sam', 'jo'] as const;

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
  return { members, agents: [], plants, claims: [], messages: [], testRuns: [], certifications: [], activity: [], nextId: 1 };
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
    const c: ClaimView = { id: s.nextId++, path: 'src/api/', handle: 'trisha', createdAt: at, expiresAt: at + 30 * MIN };
    s.claims.push(c);
    log(s, at, 'trisha', 'claim', 'claimed src/api/', 'src/api/');
  },
  // 2: trisha's bot edits routes.ts
  (s, at) => {
    const p = plant(s, 'src/api/routes.ts');
    p.stage = 'growing'; p.lines = 140; p.lastActivity = at; p.lastTouchedBy = 'trisha';
    Object.assign(agent(s, 's-trisha'), { status: 'working', currentPath: p.path, currentAction: 'edit', lastSeen: at });
    log(s, at, 'trisha', 'edit', 'edited routes.ts (+20 lines)', p.path, 's-trisha');
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
  // 5: alex's agent tries to edit the fenced file
  (s, at) => {
    Object.assign(agent(s, 's-alex'), { status: 'blocked', currentPath: 'src/api/routes.ts', currentAction: 'blocked_edit', lastSeen: at });
    log(s, at, 'alex', 'blocked_edit', 'routes.ts is fenced by trisha', 'src/api/routes.ts', 's-alex');
  },
  // 6: alex messages trisha (sent)
  (s, at) => {
    const m: MessageView = {
      id: s.nextId++, fromHandle: 'alex', fromSession: 's-alex', toHandle: 'trisha', kind: 'request',
      body: 'Can I touch src/api/auth.ts while you finish routes.ts?', status: 'sent', sentAt: at,
    };
    s.messages.push(m);
    log(s, at, 'alex', 'message_sent', 'request to trisha', undefined, 's-alex');
  },
  // 7: delivered on trisha's next prompt
  (s, at) => {
    const m = s.messages[0]!; m.status = 'delivered'; m.deliveredAt = at;
    log(s, at, 'trisha', 'message_delivered', 'inbox delivered', undefined, 's-trisha');
  },
  // 8: acked
  (s, at) => {
    const m = s.messages[0]!; m.status = 'acked'; m.ackedAt = at;
    log(s, at, 'trisha', 'message_acked', 'acked alex\'s request', undefined, 's-trisha');
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
  },
  // 11: tests pass -> bugs clear
  (s, at) => {
    s.testRuns.push({ id: s.nextId++, handle: 'trisha', repo: FAKE_REPO, command: 'npm test', exitCode: 0, at });
    plant(s, 'src/api/routes.ts').bugs = 0;
    log(s, at, 'trisha', 'test_pass', 'npm test passed', undefined, 's-trisha');
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
