import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_STEPS, makeFakeSnapshots } from '../../../shared/fake-data.ts';
import { pickSpoken, summarize } from './announce.ts';

const final = makeFakeSnapshots(FAKE_STEPS + 1).at(-1)!;

test('only meaningful events are spoken, newest first-class, capped', () => {
  const lines = pickSpoken(final.activity, 3);
  assert.equal(lines.length, 3);
  assert.ok(lines.some((l) => /bloom/i.test(l)), 'the bloom is announced');
  assert.equal(pickSpoken(final.activity.filter((a) => ['read', 'search', 'prompt'].includes(a.kind))).length, 0);
});

test('summary mentions people, plants by stage, bugs, fences, requests', () => {
  const s = summarize(final);
  assert.match(s, /4 of 4 gardeners online|gardeners online/);
  assert.match(s, /1 bloom/);
  assert.match(s, /no bugs/);
  assert.match(s, /Press P/);
  assert.match(summarize({ ...final, plants: [], claims: [], messages: [] }), /0 plants; no bugs; 0 fenced areas; 0 open requests/);
});
