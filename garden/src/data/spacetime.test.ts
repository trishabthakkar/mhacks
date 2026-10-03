import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, type LiveTables } from './spacetime.ts';

const ts = (ms: number) => ({ toDate: () => new Date(ms) });
const it = <T>(rows: T[]) => ({ iter: () => rows });

test('maps rows to a snapshot; optional fields are absent, ids become numbers', () => {
  const db = {
    member: it([{ handle: 'ivy', color: '#e76f51', online: true, paused: false, lastSeen: ts(1000) }]),
    agent: it([{ sessionId: 's1', handle: 'ivy', kind: 'claude', parentSessionId: undefined, status: 'working', currentPath: 'src/a.ts', currentAction: 'edit', lastSeen: ts(2000) }]),
    plant: it([{ path: 'src/a.ts', bed: 'src', lines: 10, stage: 'bud', bugs: 1, lastActivity: ts(3000), lastTouchedBy: undefined, lastDiffAt: ts(2500), lastBloomAt: undefined }]),
    claim: it([{ id: 5n, path: 'src/', handle: 'ivy', createdAt: ts(10), expiresAt: ts(20) }]),
    message: it([{ id: 7n, fromHandle: 'a', fromSession: undefined, toHandle: 'b', kind: 'finding', body: 'hi', status: 'sent', sentAt: ts(5), deliveredAt: undefined, ackedAt: undefined }]),
    testRun: it([{ id: 1n, handle: 'ivy', repo: 'x/y', command: 'npm test', exitCode: 0, at: ts(9) }]),
    certification: it([{ id: 2n, path: 'src/a.ts', handle: 'ivy', task: 't', result: 'refused', reason: 'no test', at: ts(8) }]),
    activity: it([
      { id: 3n, at: ts(2), handle: 'ivy', sessionId: undefined, kind: 'edit', path: undefined, detail: '' },
      { id: 1n, at: ts(1), handle: 'ivy', sessionId: 's1', kind: 'prompt', path: undefined, detail: '' },
    ]),
  } as unknown as LiveTables;
  const s = buildSnapshot(db, 123);
  assert.equal(s.at, 123);
  assert.equal(s.members[0]!.lastSeen, 1000);
  assert.ok(!('parentSessionId' in s.agents[0]!), 'undefined optional must be absent');
  assert.ok(!('lastTouchedBy' in s.plants[0]!));
  assert.equal(s.plants[0]!.lastDiffAt, 2500);
  assert.equal(s.claims[0]!.id, 5);
  assert.equal(typeof s.messages[0]!.id, 'number');
  assert.ok(!('deliveredAt' in s.messages[0]!));
  assert.deepEqual(s.activity.map((a) => a.id), [1, 3], 'activity sorted by id');
  assert.ok(!('path' in s.activity[0]!));
});

test('activity is windowed to the newest rows', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: BigInt(i), at: ts(i), handle: 'a', sessionId: undefined, kind: 'read', path: undefined, detail: '' }));
  const empty = it([]);
  const s = buildSnapshot({ member: empty, agent: empty, plant: empty, claim: empty, message: empty, testRun: empty, certification: empty, activity: it(rows) } as unknown as LiveTables, 0);
  assert.equal(s.activity.length, 200);
  assert.equal(s.activity.at(-1)!.id, 499);
});
