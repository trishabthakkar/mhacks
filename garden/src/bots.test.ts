import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView, GardenSnapshot } from '../../shared/types.ts';
import { botFor, botHandleOf, botLine, followHandle, recentFiles, sleepZScale } from './bots.ts';

const NOW = 10_000_000;
const ag = (o: Partial<AgentView>): AgentView => ({ sessionId: 's', handle: 'trisha', kind: 'claude', status: 'idle', currentAction: '', lastSeen: 0, ...o });
const snap = (agents: AgentView[], online = true, paused = false) => ({
  at: NOW, members: [{ handle: 'trisha', color: '#f00', online, paused, lastSeen: NOW }], agents,
  plants: [], claims: [], messages: [], testRuns: [], certifications: [], activity: [],
}) as GardenSnapshot;

test('working beats dormant and a newer idle session', () => {
  const s = snap([ag({ sessionId: 'a', status: 'dormant', lastSeen: 9 }), ag({ sessionId: 'b', status: 'working', lastSeen: 1 }), ag({ sessionId: 'c', status: 'idle', lastSeen: 8 })]);
  assert.equal(botFor(s, 'trisha').agent?.sessionId, 'b');
  assert.equal(botFor(s, 'trisha').asleep, false);
});

test('nothing awake: the latest dormant session, asleep', () => {
  const s = snap([ag({ sessionId: 'a', status: 'dormant', lastSeen: 1 }), ag({ sessionId: 'b', status: 'dormant', lastSeen: 5 })]);
  assert.equal(botFor(s, 'trisha').agent?.sessionId, 'b');
  assert.equal(botFor(s, 'trisha').asleep, true);
});

test('no agents → asleep with no session; idle → asleep; offline or paused → asleep even if working', () => {
  assert.deepEqual(botFor(snap([]), 'trisha'), { agent: undefined, asleep: true });
  assert.equal(botFor(snap([ag({ status: 'idle' })]), 'trisha').asleep, true);
  assert.equal(botFor(snap([ag({ status: 'working' })], false), 'trisha').asleep, true);
  assert.equal(botFor(snap([ag({ status: 'working' })], true, true), 'trisha').asleep, true);
  assert.equal(botFor(snap([ag({ status: 'waiting' })]), 'trisha').asleep, false);
});

test('subagents are not bots; any session id maps to its member', () => {
  const s = snap([ag({ sessionId: 'x', kind: 'subagent', status: 'working' }), ag({ sessionId: 'old', status: 'dormant' })]);
  assert.equal(botFor(s, 'trisha').agent?.sessionId, 'old');
  assert.equal(botHandleOf(s, 'old'), 'trisha');
  assert.equal(botHandleOf(s, 'x'), 'trisha');
  assert.equal(botHandleOf(s, 'nope'), undefined);
});

test('botLine says what the Claude is doing, or how long it has slept', () => {
  assert.equal(botLine(snap([]), 'trisha'), 'Claude asleep · no session yet');
  assert.equal(botLine(snap([ag({ status: 'dormant', lastSeen: NOW - 2 * 3_600_000 })]), 'trisha'), 'Claude asleep · last active 2h ago');
  assert.equal(botLine(snap([ag({ status: 'working', currentPath: 'src/api/routes.ts', lastSeen: NOW })]), 'trisha'), 'Claude working on routes.ts');
  assert.equal(botLine(snap([ag({ status: 'needs_review', lastSeen: NOW })]), 'trisha'), 'Claude waiting for review');
});

test('followHandle: only the session the bot shows, while awake-ish (an ended session stops the follow)', () => {
  const s = snap([ag({ sessionId: 'old', status: 'dormant', lastSeen: 1 }), ag({ sessionId: 'now', status: 'working', lastSeen: 5 })]);
  assert.equal(followHandle(s, 'now'), 'trisha');
  assert.equal(followHandle(s, 'old'), undefined);
  assert.equal(followHandle(snap([ag({ sessionId: 'x', status: 'dormant' })]), 'x'), undefined);
  assert.equal(followHandle(snap([ag({ sessionId: 'i', status: 'idle' })]), 'i'), 'trisha');
  assert.equal(followHandle(s, 'nope'), undefined);
});

test('sleepZScale: z z z grow when the camera is far, so a sleeping bot reads from the overview', () => {
  assert.equal(sleepZScale(5), 1);
  assert.equal(sleepZScale(12), 1);
  assert.ok(sleepZScale(30) > 2 && sleepZScale(30) <= 3);
  assert.equal(sleepZScale(200), 3);
});

test('recentFiles: files this member touched in the last 30 min, newest first, no repeats, capped', () => {
  const act = (id: number, handle: string, path: string | undefined, ago: number, kind = 'edit') => ({ id, at: NOW - ago, handle, kind, path, detail: '' });
  const s = { ...snap([]), activity: [
    act(1, 'trisha', 'old.ts', 40 * 60_000), act(2, 'trisha', 'a.ts', 5 * 60_000), act(3, 'trisha', 'b.ts', 4 * 60_000, 'read'),
    act(4, 'trisha', 'a.ts', 3 * 60_000), act(5, 'seno', 'z.ts', 60_000), act(6, 'trisha', undefined, 60_000, 'bash'),
    act(7, 'trisha', 'c.ts', 2 * 60_000), act(8, 'trisha', 'd.ts', 60_000), act(9, 'trisha', 'e.ts', 30_000),
  ] } as unknown as GardenSnapshot;
  assert.deepEqual(recentFiles(s, 'trisha'), ['e.ts', 'd.ts', 'c.ts', 'a.ts']);
  assert.deepEqual(recentFiles(s, 'nobody'), []);
});
