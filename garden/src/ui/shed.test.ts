import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView, GardenSnapshot } from '../../../shared/types.ts';
import { agentRows } from './shed.ts';

const agent = (sessionId: string, handle: string, extra: Partial<AgentView> = {}): AgentView =>
  ({ sessionId, handle, kind: 'claude', status: 'working', currentAction: 'edit', lastSeen: 0, ...extra });
const snap = (agents: AgentView[]) => ({ agents } as unknown as GardenSnapshot);

test("lists a gardener's bot with the file it is on, as a camera target", () => {
  const html = agentRows(snap([agent('s1', 'manahil', { currentPath: 'garden/src/main.ts' })]), 'manahil');
  assert.match(html, /data-focus="agent:s1"/);
  assert.match(html, /main\.ts/);
});

test('lists each live subagent of that gardener, not dormant ones or other people', () => {
  const html = agentRows(snap([
    agent('s1', 'manahil'),
    agent('k1', 'manahil', { kind: 'subagent', parentSessionId: 's1', currentAction: 'search' }),
    agent('k2', 'manahil', { kind: 'subagent', parentSessionId: 's1', status: 'dormant' }),
    agent('k3', 'trisha', { kind: 'subagent' }),
  ]), 'manahil');
  assert.match(html, /data-focus="agent:k1"/);
  assert.match(html, /search/);
  assert.doesNotMatch(html, /agent:k2/);
  assert.doesNotMatch(html, /agent:k3/);
});

test('nothing to list without live agents', () => {
  assert.equal(agentRows(snap([agent('s1', 'manahil', { status: 'dormant' })]), 'manahil'), '');
});

test('the followed agent is marked', () => {
  const html = agentRows(snap([agent('s1', 'manahil'), agent('k1', 'manahil', { kind: 'subagent' })]), 'manahil', 'agent:k1');
  assert.match(html, /class="[^"]*following[^"]*"[^>]*data-focus="agent:k1"/);
  assert.doesNotMatch(html, /class="[^"]*following[^"]*"[^>]*data-focus="agent:s1"/);
});

test('agent text is escaped', () => {
  assert.doesNotMatch(agentRows(snap([agent('s1', 'manahil', { currentAction: '<img>' })]), 'manahil'), /<img>/);
});
