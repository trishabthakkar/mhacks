import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelRule } from './labelRules.ts';

test('people and bubbles outrank places, and only they get nudged out of the way', () => {
  assert.ok(labelRule('bubble spirit').pri > labelRule('label member').pri);
  assert.ok(labelRule('label member').pri > labelRule('label bed').pri);
  assert.equal(labelRule('label member').nudge, true);
  assert.equal(labelRule('bubble').nudge, true);
  for (const c of ['label bed', 'label plant', 'label task', 'label botanist']) assert.equal(labelRule(c).nudge, false, c);
});

test('task and plant labels only show up close; beds, people and bubbles always', () => {
  assert.ok(labelRule('label task').maxDist < 40);
  assert.ok(labelRule('label plant').maxDist < 40);
  for (const c of ['label bed', 'label member', 'bubble', 'label big']) assert.equal(labelRule(c).maxDist, Infinity, c);
});

test('beds outrank task and plant labels so folder names win a collision', () => {
  assert.ok(labelRule('label bed').pri > labelRule('label task').pri);
  assert.ok(labelRule('label bed').pri > labelRule('label plant').pri);
});
