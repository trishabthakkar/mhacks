import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseComplimenter, compliment, PHRASES } from './compliments.ts';
import { Daemon } from './daemon.ts';
import { FakeDb } from './db.ts';
import type { SproutConfig } from './config.ts';

process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-compliments-test-'));

const tick = () => new Promise((r) => setTimeout(r, 20));
const TEAM = ['manahil', 'seno', 'shriya', 'trisha'];

async function daemon(handle: string, db: FakeDb, share: SproutConfig['share'] = {}) {
  const d = new Daemon({ handle, color: '', stdbUri: 'ws://x', db: 'sprout', mcpUrl: 'http://x', repos: [], paused: false, share }, () => {});
  await d.start({ db, listen: false, poll: false });
  await tick();
  return d;
}

test('exactly one teammate (never the finisher) is picked, and it rotates by task', () => {
  const picks = new Set<string>();
  for (let id = 1; id <= 40; id++) {
    const p = chooseComplimenter(TEAM, 'trisha', String(id));
    assert.ok(p && p !== 'trisha');
    assert.equal(chooseComplimenter([...TEAM].reverse(), 'trisha', String(id)), p); // order-independent
    picks.add(p);
  }
  assert.equal(picks.size, 3);
  assert.equal(chooseComplimenter(['trisha'], 'trisha', '1'), undefined);
});

test('phrases vary and never repeat back to back', () => {
  const a = compliment('seno', 'Add auth checks', -1, () => 0);
  assert.equal(a.body, `${PHRASES[0]} seno, "Add auth checks" just bloomed 🌸`);
  const b = compliment('seno', 'Add auth checks', a.phrase, () => 0);
  assert.notEqual(b.phrase, a.phrase);
  assert.match(compliment('seno', '  ', -1, () => 0.5).body, /, your task just bloomed/);
});

test('only the picked teammate sends, once, to the finisher', async () => {
  const id = '7';
  const picked = chooseComplimenter(TEAM, 'trisha', id)!;
  const sent: string[] = [];
  for (const me of TEAM) {
    const db = new FakeDb();
    db.online = TEAM;
    const d = await daemon(me, db);
    db.taskDone({ id, handle: 'trisha', title: 'Refactor the API' });
    await tick();
    for (const c of db.calls) if (c.name === 'postMessage') { sent.push(me); assert.equal((c.args as { toHandle: string }).toHandle, 'trisha'); }
    d.stop();
  }
  assert.deepEqual(sent, [picked]);
});

test('no compliment for my own task, when paused, or with compliments off', async () => {
  const db = new FakeDb();
  db.online = ['shriya', 'trisha'];
  const d = await daemon('shriya', db);
  assert.equal(await d.complimentTask({ id: '1', handle: 'shriya', title: 'x' }), false);
  d.cfg.share = { compliments: false };
  assert.equal(await d.complimentTask({ id: '1', handle: 'trisha', title: 'x' }), false);
  d.cfg.share = {};
  d.cfg.paused = true;
  assert.equal(await d.complimentTask({ id: '1', handle: 'trisha', title: 'x' }), false);
  d.cfg.paused = false;
  assert.equal(await d.complimentTask({ id: '1', handle: 'trisha', title: 'x' }), true); // only teammate online: always me
  assert.equal(db.calls.filter((c) => c.name === 'postMessage').length, 1);
  d.stop();
});
