import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_STEPS, makeFakeSnapshots } from '../../../shared/fake-data.ts';
import { boardHtml } from './plan.ts';

const snaps = makeFakeSnapshots(FAKE_STEPS + 1);

test('board: one column per member, in member order, with their task cards', () => {
  const h = boardHtml(snaps[6]!);
  const cols = [...h.matchAll(/data-col="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cols, snaps[6]!.members.map((m) => m.handle));
  assert.ok(h.includes('Refactor the API routes') && h.includes('Add auth checks'));
});

test('board: member without a task says so; orphan tasks go to Other', () => {
  const s = { ...snaps[2]!, tasks: [...snaps[2]!.tasks!, { id: 999, handle: 'ghost', title: 'Old work', status: 'active' as const, bed: 'src', paths: [], createdAt: 0, updatedAt: 0 }] };
  const h = boardHtml(s);
  assert.ok(h.includes('No task yet'));
  assert.ok(h.includes('data-col="__other"') && h.includes('Old work'));
});

test('board: needs-attention strip lists blocked and refused', () => {
  assert.match(boardHtml(snaps[6]!), /class="attn[^"]*"[\s\S]*manahil blocked/);
  assert.match(boardHtml(snaps[11]!), /Botanist refused/);
});

test('board: done tasks are collapsed under a details element', () => {
  assert.match(boardHtml(snaps[FAKE_STEPS]!), /<details class="done"><summary>1 certified<\/summary>[\s\S]*Refactor the API routes/);
});
