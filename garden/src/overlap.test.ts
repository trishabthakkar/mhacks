import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView, GardenSnapshot, TaskView } from '../../shared/types.ts';
import { overlaps, touches } from './overlap.ts';

const NOW = 50_000_000;
const member = (handle: string, online = true, paused = false) => ({ handle, color: '#888', online, paused, lastSeen: NOW });
const task = (id: number, handle: string, paths: string[], status: TaskView['status'] = 'active'): TaskView =>
  ({ id, handle, title: `t${id}`, status, bed: '', paths, createdAt: 0, updatedAt: id });
const agent = (handle: string, currentPath?: string, status: AgentView['status'] = 'working'): AgentView =>
  ({ sessionId: `s-${handle}`, handle, kind: 'claude', status, currentPath, currentAction: 'edit', lastSeen: NOW });
const snap = (o: Partial<GardenSnapshot>): GardenSnapshot => ({ at: NOW, members: [member('ana'), member('ben'), member('cy')], agents: [],
  plants: [], claims: [], messages: [], testRuns: [], certifications: [], activity: [], tasks: [], taskItems: [], ...o });

test('touches: same file, or a folder that contains the other', () => {
  assert.equal(touches('src/a.ts', 'src/a.ts'), 'src/a.ts');
  assert.equal(touches('src/', 'src/a.ts'), 'src/a.ts');
  assert.equal(touches('src/api/x.ts', 'src/'), 'src/api/x.ts');
  assert.equal(touches('src/api/', 'src/'), 'src/api/');
  assert.equal(touches('src/a.ts', 'src/b.ts'), undefined);
  assert.equal(touches('src/ap/', 'src/api/x.ts'), undefined);
});

test('overlaps: two people whose current tasks share a file are flagged once, at the most specific shared path', () => {
  const s = snap({ tasks: [task(1, 'ana', ['src/api/', 'README.md']), task(2, 'ben', ['src/api/routes.ts', 'docs/x.md']), task(3, 'cy', ['web/'])] });
  assert.deepEqual(overlaps(s), [{ a: 'ana', b: 'ben', path: 'src/api/routes.ts' }]);
});

test('overlaps: a teammate\'s live file counts even without a task; done tasks, offline and paused people do not', () => {
  assert.deepEqual(overlaps(snap({ tasks: [task(1, 'ana', ['src/'])], agents: [agent('ben', 'src/x.ts')] })), [{ a: 'ana', b: 'ben', path: 'src/x.ts' }]);
  assert.deepEqual(overlaps(snap({ tasks: [task(1, 'ana', ['src/']), task(2, 'ben', ['src/'], 'done')] })), []);
  assert.deepEqual(overlaps(snap({ members: [member('ana'), member('ben', false)], tasks: [task(1, 'ana', ['src/']), task(2, 'ben', ['src/'])] })), []);
  assert.deepEqual(overlaps(snap({ members: [member('ana'), member('ben', true, true)], tasks: [task(1, 'ana', ['src/']), task(2, 'ben', ['src/'])] })), []);
  assert.deepEqual(overlaps(snap({ tasks: [task(1, 'ana', ['src/'])], agents: [agent('ben', 'src/x.ts', 'dormant')] })), []);
});

test('overlaps: only each member\'s current task (an older open task is ignored), and nobody overlaps themselves', () => {
  const s = snap({ tasks: [task(1, 'ana', ['old/']), task(5, 'ana', ['src/a.ts']), task(2, 'ben', ['old/x.ts'])], agents: [agent('ana', 'src/a.ts')] });
  assert.deepEqual(overlaps(s), []);
});
