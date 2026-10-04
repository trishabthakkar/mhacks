import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOTANIST_MODEL, characterFor, GARDENER_MODELS } from './characterPick.ts';

test('each person gets the same character every time', () => {
  for (const h of ['manahil', 'trisha', 'seno', 'shriya']) assert.equal(characterFor(h), characterFor(h));
});

test('gardeners never look like the botanist', () => {
  assert.ok(!(GARDENER_MODELS as readonly string[]).includes(BOTANIST_MODEL));
  for (let i = 0; i < 200; i++) assert.notEqual(characterFor(`user${i}`), BOTANIST_MODEL);
});

test('a small team mostly gets different characters', () => {
  assert.ok(new Set(['manahil', 'trisha', 'seno', 'shriya'].map(characterFor)).size >= 3);
});
