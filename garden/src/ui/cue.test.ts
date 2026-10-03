import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUE_STEPS, currentStep, resetCue, seen, stepState, toggleManual } from './cue.ts';

test('starts at the hook; nothing is done', () => {
  resetCue();
  assert.equal(currentStep()?.name, 'Hook');
  assert.ok(CUE_STEPS.every((s) => stepState(s) !== 'done'));
});

test('events tick steps; the hook completes once anything later starts', () => {
  resetCue();
  seen('session_start');
  assert.equal(stepState(CUE_STEPS[0]!), 'done');
  assert.equal(stepState(CUE_STEPS[1]!), 'done');
  assert.equal(currentStep()?.name, 'Live work');
  seen('claim');
  assert.equal(stepState(CUE_STEPS[2]!), 'partial'); // needs claim AND edit
  seen('edit');
  assert.equal(stepState(CUE_STEPS[2]!), 'done');
});

test('the botanist step needs refuse, pass and bloom', () => {
  resetCue();
  seen('certify_refused'); seen('test_pass');
  assert.equal(stepState(CUE_STEPS[6]!), 'partial');
  seen('certify_bloom');
  assert.equal(stepState(CUE_STEPS[6]!), 'done');
});

test('manual ticks and reset', () => {
  resetCue();
  toggleManual(7);
  assert.equal(stepState(CUE_STEPS[7]!), 'done');
  resetCue();
  assert.equal(stepState(CUE_STEPS[7]!), 'todo');
});
