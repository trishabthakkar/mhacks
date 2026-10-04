import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView, GardenSnapshot } from '../../shared/types.ts';
import { botFor, botHandleOf, botLine } from './bots.ts';

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
