import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_STEPS, makeFakeSnapshots } from '../../shared/fake-data.ts';
import type { GardenSnapshot } from '../../shared/types.ts';
import { tourStops } from './tour.ts';

const snaps = makeFakeSnapshots(FAKE_STEPS + 1);

test('tour: starts at the arch with the repo name and ends at the botanist or pond; every stop has a caption', () => {
  const t = tourStops(snaps[9]!, 'mhacks');
  assert.deepEqual(t[0]!.pick, { kind: 'garden' });
  assert.match(t[0]!.caption, /^mhacks/);
  assert.ok(t.length >= 4 && t.length <= 7, String(t.length));
  for (const s of t) assert.ok(s.caption.length > 10 && s.caption.length < 120, s.caption);
  assert.ok(['botanist', 'pond'].includes(t.at(-1)!.pick.kind));
});

test('tour: visits the busiest bed, a working teammate, and the collision warning when there is one', () => {
  const t = tourStops(snaps[9]!, 'mhacks'), kinds = t.map((s) => s.pick.kind);
  assert.ok(kinds.includes('bed'));
  const working = t.find((s) => s.pick.kind === 'member' && /working|editing/i.test(s.caption));
  assert.ok(working, JSON.stringify(t.map((s) => s.caption)));
  assert.ok(t.some((s) => s.caption.startsWith('⚠️')), 'overlap stop');
});

test('tour: an empty garden still tours (arch, botanist), nothing crashes', () => {
  const empty = { at: 1, members: [], agents: [], plants: [], claims: [], messages: [], testRuns: [], certifications: [], activity: [] } as GardenSnapshot;
  const t = tourStops(empty, 'our garden');
  assert.deepEqual(t.map((s) => s.pick.kind), ['garden', 'botanist']);
});
