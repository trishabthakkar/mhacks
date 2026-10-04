import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Daemon } from './daemon.ts';
import { FakeDb } from './db.ts';
import type { DaemonEvent } from './events.ts';
import { mapHook, type HookPayload } from './hookMap.ts';
import { sproutHooks } from './join.ts';

// Real payloads from Claude Code 2.1.288 (TaskCreate ×3, TaskUpdate ×3), paths sanitized.
const todos = readFileSync(new URL('../test/fixtures/todos.jsonl', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as HookPayload);
const repos = [{ root: '/Users/alex/proj', name: 'team/proj' }];
const SID = '11111111-2222-3333-4444-555555555555';
const map = (p: HookPayload) => JSON.parse(JSON.stringify(mapHook('PostToolUse', p, { repos }))).events as DaemonEvent[];

test('TaskCreate / TaskUpdate payloads → todo_op events (subject only, never the description)', () => {
  const evs = todos.flatMap(map);
  assert.deepEqual(evs, [
    { type: 'todo_op', repo: 'team/proj', sessionId: SID, op: 'create', id: '1', text: 'Define greet function signature', state: 'pending' },
    { type: 'todo_op', repo: 'team/proj', sessionId: SID, op: 'create', id: '2', text: 'Implement greet function', state: 'pending' },
    { type: 'todo_op', repo: 'team/proj', sessionId: SID, op: 'create', id: '3', text: 'Add tests for greet function', state: 'pending' },
    { type: 'todo_op', repo: 'team/proj', sessionId: SID, op: 'update', id: '1', state: 'in_progress' },
    { type: 'todo_op', repo: 'team/proj', sessionId: SID, op: 'update', id: '1', state: 'completed' },
    { type: 'todo_op', repo: 'team/proj', sessionId: SID, op: 'update', id: '2', state: 'in_progress' },
  ]);
  assert.ok(!JSON.stringify(evs).includes('Decide the name'), 'description must not leave the laptop');
});

test('TodoWrite (full list) → todos event; secrets masked; text ≤80; ≤20 items', () => {
  const base = todos[0]!;
  const long = 'x'.repeat(200);
  const items = [{ content: 'rotate key sk-ant-api03-abcdefghijklmnopqrstu', status: 'in_progress' }, { content: long, status: 'completed' },
    ...Array.from({ length: 30 }, (_, i) => ({ content: `step ${i}`, status: 'bogus' }))];
  const [ev] = map({ ...base, tool_name: 'TodoWrite', tool_input: { todos: items }, tool_response: {} });
  assert.equal(ev!.type, 'todos');
  const list = (ev as Extract<DaemonEvent, { type: 'todos' }>).items;
  assert.equal(list.length, 20);
  assert.ok(!JSON.stringify(list).includes('sk-ant-api03'));
  assert.ok(list.every((i) => i.text.length <= 80 && ['pending', 'in_progress', 'completed'].includes(i.state)));
});

test('outside a joined repo, bad ids, failed updates → nothing', () => {
  assert.deepEqual(mapHook('PostToolUse', { ...todos[0]!, cwd: '/elsewhere' }, { repos }).events, []);
  assert.deepEqual(map({ ...todos[0]!, tool_response: {} }), []); // no id
  assert.deepEqual(map({ ...todos[3]!, tool_response: { success: false } }), []);
  const del = map({ ...todos[3]!, tool_input: { taskId: '2', status: 'deleted' } });
  assert.equal((del[0] as { state: string }).state, 'deleted');
});

test('sprout join installs the PostToolUse hook for the to-do tools', () => {
  const m = sproutHooks('/n', '/b').PostToolUse![0]!.matcher!;
  for (const t of ['TodoWrite', 'TaskCreate', 'TaskUpdate']) assert.ok(m.split('|').includes(t), t);
});

async function daemon(extra: object = {}) {
  process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-todos-'));
  const db = new FakeDb();
  const d = new Daemon({ handle: 'shriya', color: '', stdbUri: '', db: '', mcpUrl: '', repos, paused: false, ...extra }, () => {});
  await d.start({ db, listen: false, poll: false });
  return { d, db };
}
const settle = () => new Promise((r) => setTimeout(r, 400));
const sets = (db: FakeDb) => db.calls.filter((c) => c.name === 'setTaskItems').map((c) => c.args as { handle: string; items: { text: string; state: string }[] });

test('daemon: the create burst is sent once; updates re-send the whole checklist in order', async () => {
  const { d, db } = await daemon();
  for (const ev of todos.slice(0, 3).flatMap(map)) d.handleEvent(ev);
  await settle();
  assert.equal(sets(db).length, 1, 'debounced to one call');
  assert.deepEqual(sets(db)[0], { handle: 'shriya', items: [
    { text: 'Define greet function signature', state: 'pending' },
    { text: 'Implement greet function', state: 'pending' },
    { text: 'Add tests for greet function', state: 'pending' },
  ] });
  for (const ev of todos.slice(3).flatMap(map)) d.handleEvent(ev);
  await settle();
  assert.deepEqual(sets(db).at(-1)!.items.map((i) => i.state), ['completed', 'in_progress', 'pending']);
  d.handleEvent({ type: 'todo_op', repo: 'team/proj', sessionId: SID, op: 'update', id: '3', state: 'deleted' });
  d.handleEvent({ type: 'todo_op', repo: 'team/proj', sessionId: SID, op: 'update', id: '99', state: 'completed' }); // never created: ignored
  await settle();
  assert.deepEqual(sets(db).at(-1)!.items.map((i) => i.text), ['Define greet function signature', 'Implement greet function']);
  d.stop();
});

test('daemon: separate sessions keep separate lists; >20 drops oldest completed first', async () => {
  const { d } = await daemon();
  for (let i = 0; i < 22; i++) d.todo({ type: 'todo_op', repo: 'team/proj', sessionId: 'a', op: 'create', id: String(i), text: `t${i}`, state: 'pending' });
  d.todo({ type: 'todo_op', repo: 'team/proj', sessionId: 'a', op: 'update', id: '5', state: 'completed' });
  d.todo({ type: 'todo_op', repo: 'team/proj', sessionId: 'b', op: 'create', id: '1', text: 'other session', state: 'pending' });
  const a = d.todoItems('a');
  assert.equal(a.length, 20);
  assert.ok(!a.some((i) => i.text === 't5'), 'completed one dropped first');
  assert.equal(a[0]!.text, 't1', 'then the oldest');
  assert.deepEqual(d.todoItems('b'), [{ text: 'other session', state: 'pending' }]);
  d.stop();
});

test('daemon: respects pause and `share activity off`', async () => {
  const off = await daemon({ share: { activity: false } });
  for (const ev of todos.flatMap(map)) off.d.handleEvent(ev);
  await settle();
  assert.equal(sets(off.db).length, 0);
  off.d.stop();
  const paused = await daemon({ paused: true });
  for (const ev of todos.flatMap(map)) paused.d.handleEvent(ev);
  await settle();
  assert.equal(sets(paused.db).length, 0);
  paused.d.stop();
});
