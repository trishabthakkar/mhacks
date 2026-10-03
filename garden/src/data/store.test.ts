import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeSnapshots, FAKE_STEPS } from '../../../shared/fake-data.ts';
import { Store, type StoreUpdate } from './store.ts';

const frames = makeFakeSnapshots(FAKE_STEPS + 1);

function collect(store: Store) {
  const got: StoreUpdate[] = [];
  store.subscribe((u) => got.push(u));
  got.length = 0; // drop the initial replay to subscribers
  return got;
}

test('subscribe replays the current snapshot once, flagged reset', () => {
  const s = new Store();
  const seen: StoreUpdate[] = [];
  s.subscribe((u) => seen.push(u));
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.reset, true);
});

test('reset sets state without events', () => {
  const s = new Store();
  const got = collect(s);
  s.set(frames[3]!, true);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0]!.events, []);
  assert.deepEqual(got[0]!.newActivity, []);
  assert.equal(got[0]!.reset, true);
  assert.equal(s.snapshot, frames[3]);
});

test('a normal set emits inserted / updated / deleted per table', () => {
  const s = new Store();
  s.set(frames[0]!, true);
  const got = collect(s);
  s.set(frames[3]!); // join, claim and the first edit happen between steps 0..3
  const ev = got[0]!.events;
  assert.ok(ev.some((e) => e.table === 'claims' && e.op === 'inserted'));
  assert.ok(ev.some((e) => e.table === 'plants' && e.op === 'updated'));
  assert.ok(ev.some((e) => e.table === 'agents' && e.op === 'inserted'));
  // going back removes what was inserted
  const back = collect(s);
  s.set(frames[0]!);
  assert.ok(back[0]!.events.some((e) => e.table === 'claims' && e.op === 'deleted'));
});

test('newActivity contains exactly the activity rows that are new', () => {
  const s = new Store();
  s.set(frames[1]!, true);
  const got = collect(s);
  s.set(frames[2]!);
  const prev = new Set(frames[1]!.activity.map((a) => a.id));
  const fresh = frames[2]!.activity.filter((a) => !prev.has(a.id));
  assert.deepEqual(got[0]!.newActivity.map((a) => a.id), fresh.map((a) => a.id));
  assert.ok(fresh.length > 0);
});

test('identical snapshot emits no events', () => {
  const s = new Store();
  s.set(frames[4]!, true);
  const got = collect(s);
  s.set(structuredClone(frames[4]!));
  assert.equal(got[0]!.events.length, 0);
});

test('unsubscribe stops updates', () => {
  const s = new Store();
  let n = 0;
  const off = s.subscribe(() => n++);
  off();
  const before = n;
  s.set(frames[1]!);
  assert.equal(n, before);
});
