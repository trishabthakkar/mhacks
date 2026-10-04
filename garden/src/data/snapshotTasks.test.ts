import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, type LiveTables } from './spacetime.ts';

const ts = (ms: number) => ({ toDate: () => new Date(ms) });
const empty = { iter: () => [] as never[] };

test('buildSnapshot maps task and taskItem rows (ids → number, ms times, optional fields absent)', () => {
  const db = {
    member: empty, agent: empty, plant: empty, claim: empty, message: empty, testRun: empty, certification: empty, activity: empty,
    task: { iter: () => [{ id: 7n, handle: 'seno', title: 'Refactor', status: 'weird', bed: 'spacetimedb', paths: ['spacetimedb/src/'],
      blockedReason: undefined, createdAt: ts(1000), updatedAt: ts(2000), doneAt: undefined }] },
    taskItem: { iter: () => [{ id: 9n, taskId: 7n, ord: 0, text: 'Read', state: 'in_progress' }] },
  } as unknown as LiveTables;
  const s = buildSnapshot(db, 5000);
  assert.deepEqual(s.tasks, [{ id: 7, handle: 'seno', title: 'Refactor', status: 'active', bed: 'spacetimedb', paths: ['spacetimedb/src/'], createdAt: 1000, updatedAt: 2000 }]);
  assert.deepEqual(s.taskItems, [{ id: 9, taskId: 7, ord: 0, text: 'Read', state: 'in_progress' }]);
});
