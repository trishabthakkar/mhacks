import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_STEPS, makeFakeSnapshots } from '../../shared/fake-data.ts';
import { attention, currentTaskOf, taskModels } from './tasks.ts';

const snaps = makeFakeSnapshots(FAKE_STEPS + 1);

// snaps[n] = the fake story after script steps 0..n-1 (step 1 = trisha's fence, 2 = her edit, 3 = subagent out, 4 = back).
test('model: progress, fence, owner color, current flag', () => {
  const s = snaps[3]!;
  const [m] = taskModels(s).filter((t) => t.handle === 'trisha');
  assert.equal(m!.title, 'Refactor the API routes');
  assert.equal(`${m!.done}/${m!.total}`, '1/3');
  assert.equal(m!.fence?.path, 'src/api/');
  assert.equal(m!.color, s.members.find((x) => x.handle === 'trisha')!.color);
  assert.equal(m!.current, true);
});

test('model: live agent lines on the current task only (main + spirit)', () => {
  const out = taskModels(snaps[4]!).find((t) => t.handle === 'trisha')!;   // subagent is out
  assert.ok(out.agents.some((a) => a.kind === 'main'));
  assert.ok(out.agents.some((a) => a.kind === 'spirit' && a.path === 'src/db.ts'));
  const back = taskModels(snaps[5]!).find((t) => t.handle === 'trisha')!;  // subagent returned
  assert.equal(back.agents.filter((a) => a.kind === 'spirit').length, 0);
});

test('model: roadblocks from blocked reason, refusal and bugs', () => {
  assert.match(taskModels(snaps[6]!).find((t) => t.handle === 'alex')!.roadblocks.join('|'), /fenced by trisha/);
  const r = taskModels(snaps[11]!).find((t) => t.handle === 'trisha')!.roadblocks.join('|');
  assert.match(r, /Botanist refused/);
  assert.match(r, /bug/);
});

test('currentTaskOf ignores done tasks', () => {
  assert.equal(currentTaskOf(snaps[2]!, 'trisha')!.title, 'Refactor the API routes');
  assert.equal(currentTaskOf(snaps[FAKE_STEPS]!, 'trisha'), undefined);
});

test('attention: blocked task, refusal and unacked message become chips', () => {
  const kinds = (i: number) => attention(snaps[i]!).map((a) => a.kind);
  assert.ok(kinds(6).includes('blocked'));
  assert.ok(kinds(7).includes('message'));
  assert.ok(kinds(11).includes('refused'));
  assert.ok(!kinds(FAKE_STEPS).includes('refused')); // bloom after the refusal clears it
});
