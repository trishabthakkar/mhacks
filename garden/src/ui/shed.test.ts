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
import { memberStatus, shedHtml } from './shed.ts';

const NOW = Date.UTC(2026, 9, 4, 12, 0);
const full = (o: Partial<GardenSnapshot> = {}): GardenSnapshot => ({
  at: NOW, members: [{ handle: 'trisha', color: '#7fb069', online: true, paused: false, lastSeen: NOW }, { handle: 'seno', color: '#e4572e', online: false, paused: false, lastSeen: 0 }],
  agents: [agent('s1', 'trisha', { currentPath: 'src/a.ts' }), agent('k1', 'trisha', { kind: 'subagent' })],
  plants: [{ path: 'src/a.ts', bed: 'src', lines: 3, stage: 'growing', bugs: 0, lastActivity: NOW }],
  claims: [], messages: [], testRuns: [], certifications: [], activity: [], ...o,
});
const opts = { source: 'live', connection: 'live', collapsed: false, selected: null, repo: 'mhacks' };
const view = { tab: 'team' as const, filter: 'all' as const, expanded: new Set<string>(), lastMaxId: -1 };

test('team tab: one card per online member, offline folded, status pill, helper badge', () => {
  const h = shedHtml(full(), opts, view);
  assert.match(h, /class="person[^"]*"[^>]*style="--c:#7fb069"/);
  assert.match(h, /pill working/);
  assert.match(h, /\+1 helper/);
  assert.match(h, /\+1 offline/);
  assert.doesNotMatch(h, /data-select="member:seno"/);
});

test('all quiet line when nothing needs attention; the strip otherwise', () => {
  assert.match(shedHtml(full(), opts, view), /All quiet/);
  const h = shedHtml(full({ testRuns: [{ id: 1, handle: 'trisha', repo: '', command: '', exitCode: 1, at: NOW }] }), opts, view);
  assert.match(h, /Tests failing for <b>trisha<\/b>/);
  assert.match(h, /data-select="member:trisha"/);
});

test('the attention strip shows at most 3, then "+N more"', () => {
  const runs = ['a', 'b', 'c', 'd', 'e'].map((h, i) => ({ id: i, handle: h, repo: '', command: '', exitCode: 1, at: NOW }));
  const h = shedHtml(full({ testRuns: runs }), opts, view);
  assert.equal((h.match(/class="row"/g) ?? []).length, 3);
  assert.match(h, /\+2 more/);
});

test('activity tab: open-now group only when non-empty; grouped feed rows with icons and times', () => {
  const act = (id: number) => ({ id, at: NOW - 120_000, handle: 'trisha', kind: 'edit' as const, path: 'src/a.ts', detail: '' });
  const h = shedHtml(full({ activity: [act(1), act(2)] }), opts, { ...view, tab: 'activity' });
  assert.doesNotMatch(h, /Open now/);
  assert.match(h, /💧/);
  assert.match(h, /×2/);
  assert.match(h, /2m/);
  const h2 = shedHtml(full({ claims: [{ id: 1, path: 'src/', handle: 'trisha', createdAt: 0, expiresAt: NOW + 3_600_000 }] }), opts, { ...view, tab: 'activity' });
  assert.match(h2, /Open now/);
});

test('a selection replaces the tabs with the inspector and a back button', () => {
  const h = shedHtml(full(), { ...opts, selected: { kind: 'plant', key: 'src/a.ts' } }, view);
  assert.match(h, /data-back/);
  assert.match(h, /a\.ts/);
  assert.doesNotMatch(h, /role="tablist"/);
});

test('member status', () => {
  const s = full();
  assert.equal(memberStatus(s, 'trisha'), 'working');
  assert.equal(memberStatus(s, 'seno'), 'offline');
  assert.equal(memberStatus(full({ agents: [agent('s1', 'trisha', { status: 'blocked' })] }), 'trisha'), 'blocked');
});

test('an idle gardener reads "between tasks", not "idle" twice; action names lose underscores', () => {
  const h = shedHtml(full({ agents: [agent('s1', 'trisha', { status: 'idle', currentAction: 'idle' })] }), opts, view);
  assert.match(h, /between tasks/);
  const h2 = shedHtml(full({ agents: [agent('s1', 'trisha', { status: 'blocked', currentAction: 'blocked_edit', currentPath: 'src/a.ts' })] }), opts, view);
  assert.match(h2, /blocked edit/);
});
