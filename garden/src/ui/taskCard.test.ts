import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskCardHtml } from './taskCard.ts';
import type { TaskModel } from '../tasks.ts';

const m = (o: Partial<TaskModel> = {}): TaskModel => ({
  id: 1, handle: 'manahil', color: '#2a9d8f', title: 'Add untilText helper', status: 'active', bed: 'mcp', paths: ['mcp/src/'],
  items: [{ text: 'Read time.ts', state: 'completed' }, { text: 'Add untilText()', state: 'in_progress' }, { text: 'Run tests', state: 'pending' }],
  done: 1, total: 3, fence: { path: 'mcp/src/', expiresAt: Date.UTC(2026, 9, 3, 23, 22) }, roadblocks: [],
  agents: [{ kind: 'main', sessionId: 's', status: 'working', action: 'edit', path: 'mcp/src/time.ts', agoMs: 4000 },
    { kind: 'spirit', sessionId: 's:a', status: 'working', action: 'search', path: 'companion/src/hookMap.ts', agoMs: 0 }],
  current: true, createdAt: 0, updatedAt: 0, ...o,
});

test('card shows title, owner, progress, checklist marks, fence and live lines', () => {
  const h = taskCardHtml(m(), Date.UTC(2026, 9, 3, 23, 0));
  for (const s of ['Add untilText helper', 'manahil', '1 / 3', '✓', '▸', '○', 'fenced mcp/src/', '🤖', '✨', 'search hookMap.ts', 'just now']) assert.ok(h.includes(s), s);
});

test('card escapes agent-written text', () => {
  const h = taskCardHtml(m({ title: '<img src=x onerror=alert(1)>', items: [{ text: '<b>x</b>', state: 'pending' }], roadblocks: ['<script>'] }), 0);
  assert.ok(!h.includes('<img') && !h.includes('<b>x') && !h.includes('<script>'));
  assert.ok(h.includes('&lt;img'));
});

test('card caps the checklist at 8 items with "+N more"', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ text: `step ${i}`, state: 'pending' as const }));
  const h = taskCardHtml(m({ items, total: 20, done: 0 }), 0);
  assert.ok(h.includes('step 7') && !h.includes('step 8'));
  assert.ok(h.includes('+12 more'));
});

test('done task shows the bloom, roadblocks show the hand', () => {
  assert.ok(taskCardHtml(m({ status: 'done', current: false, agents: [] }), 0).includes('🌸 certified'));
  assert.ok(taskCardHtml(m({ status: 'blocked', roadblocks: ['fenced by seno until 7:00pm'] }), 0).includes('✋ fenced by seno'));
});
