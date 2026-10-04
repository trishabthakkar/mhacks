import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { TourPlayer } from './tourPlayer.ts';

const stops = [{ pick: { kind: 'garden' as const }, caption: 'arch' }, { pick: { kind: 'pond' as const }, caption: 'pond' }];
const rig = () => {
  const log: string[] = [];
  const p = new TourPlayer({ select: (x) => log.push(`select ${x ? x.kind : 'none'}`), caption: (c) => log.push(`cap ${c ?? '-'}`), done: () => log.push('done') });
  return { p, log };
};

test('TourPlayer: shows each stop for the hold time, then clears and hands back the camera', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { p, log } = rig();
  p.start(stops, 6000);
  assert.deepEqual(log, ['select garden', 'cap arch (1/2)']);
  mock.timers.tick(6000);
  assert.deepEqual(log.slice(2), ['select pond', 'cap pond (2/2)']);
  mock.timers.tick(6000);
  assert.deepEqual(log.slice(4), ['select none', 'cap -', 'done']);
  assert.equal(p.running, false);
  mock.timers.reset();
});

test('TourPlayer: stop() mid-tour ends at once and no later stop fires; start() again restarts', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { p, log } = rig();
  p.start(stops, 6000); p.stop();
  assert.deepEqual(log.slice(2), ['select none', 'cap -', 'done']);
  mock.timers.tick(20000);
  assert.equal(log.length, 5);
  p.start(stops, 6000);
  assert.equal(p.running, true);
  assert.equal(log[5], 'select garden');
  p.stop(); p.stop(); // idempotent
  assert.equal(log.filter((l) => l === 'done').length, 2);
  mock.timers.reset();
});
