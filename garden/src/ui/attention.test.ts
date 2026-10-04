import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityView, GardenSnapshot } from '../../../shared/types.ts';
import { groupFeed, shedAttention } from './attention.ts';

const NOW = Date.UTC(2026, 9, 4, 12, 0), MIN = 60_000;
const empty = (o: Partial<GardenSnapshot> = {}): GardenSnapshot => ({ at: NOW, members: [], agents: [], plants: [], claims: [], messages: [], testRuns: [], certifications: [], activity: [], ...o });
const act = (id: number, kind: ActivityView['kind'], o: Partial<ActivityView> = {}): ActivityView => ({ id, at: NOW, handle: 'seno', kind, detail: '', ...o });

test('all quiet: nothing to show', () => { assert.deepEqual(shedAttention(empty()), []); });

test('ranks: blocked edit, refusal, failing tests, expiring fence, stuck message, handoff', () => {
  const items = shedAttention(empty({
    activity: [act(1, 'blocked_edit', { path: 'src/a.ts', at: NOW - 2 * MIN })],
    certifications: [{ id: 1, path: 'src/b.ts', handle: 'trisha', task: '', result: 'refused', reason: 'no tests', at: NOW - MIN }],
    testRuns: [{ id: 1, handle: 'shriya', repo: 'r', command: 'npm test', exitCode: 1, at: NOW }],
    claims: [{ id: 1, path: 'src/c.ts', handle: 'trisha', createdAt: 0, expiresAt: NOW + 3 * MIN }],
    messages: [{ id: 1, fromHandle: 'seno', toHandle: 'manahil', kind: 'request', body: 'hi', status: 'sent', sentAt: NOW - 6 * MIN }],
    handoffs: [{ id: 1, fromHandle: 'a', toHandle: 'b', task: 't', notes: '', status: 'offered', createdAt: NOW }],
  }));
  assert.deepEqual(items.map((i) => i.rank), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(items[0]!.pick, { kind: 'plant', key: 'src/a.ts' });
  assert.deepEqual(items[2]!.pick, { kind: 'member', key: 'shriya' });
});

test('ignores old blocked edits, refusals since fixed by a bloom, passing reruns, far fences, fresh messages', () => {
  assert.deepEqual(shedAttention(empty({
    activity: [act(1, 'blocked_edit', { path: 'a', at: NOW - 11 * MIN })],
    certifications: [
      { id: 1, path: 'b', handle: 't', task: '', result: 'refused', reason: '', at: NOW - 5 * MIN },
      { id: 2, path: 'b', handle: 't', task: '', result: 'bloom', reason: '', at: NOW - MIN },
    ],
    testRuns: [{ id: 1, handle: 's', repo: '', command: '', exitCode: 1, at: NOW - 2 * MIN }, { id: 2, handle: 's', repo: '', command: '', exitCode: 0, at: NOW - MIN }],
    claims: [{ id: 1, path: 'c', handle: 't', createdAt: 0, expiresAt: NOW + 30 * MIN }],
    messages: [{ id: 1, fromHandle: 'a', toHandle: 'b', kind: 'request', body: '', status: 'sent', sentAt: NOW - 2 * MIN }],
  })), []);
});

test('a folder fence points at its bed; text is escaped', () => {
  const items = shedAttention(empty({
    plants: [{ path: 'src/api/x.ts', bed: 'src/api', lines: 1, stage: 'seed', bugs: 0, lastActivity: 0 }],
    claims: [{ id: 1, path: 'src/api/', handle: '<b>x</b>', createdAt: 0, expiresAt: NOW + MIN }],
  }));
  assert.deepEqual(items[0]!.pick, { kind: 'bed', key: 'src/api' });
  assert.doesNotMatch(items[0]!.text, /<b>x<\/b>/); assert.match(items[0]!.text, /&lt;b&gt;x/);
});

test('repeated identical events collapse into one row with a count', () => {
  const g = groupFeed([act(1, 'edit', { path: 'a' }), act(2, 'edit', { path: 'a' }), act(3, 'edit', { path: 'b' }), act(4, 'edit', { path: 'a' })]);
  assert.deepEqual(g.map((x) => [x.a.id, x.count]), [[2, 2], [3, 1], [4, 1]]);
});
