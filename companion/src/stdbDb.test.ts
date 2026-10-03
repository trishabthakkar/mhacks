import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StdbDb } from './stdbDb.ts';

process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-stdb-test-'));

test('unreachable SpacetimeDB: connect rejects, nothing throws, writes refuse (daemon queues them)', async () => {
  const logs: string[] = [];
  const db = new StdbDb('ws://127.0.0.1:1', 'sprout', (l) => logs.push(l), 1500);
  await assert.rejects(db.connect('trisha'));
  assert.equal(db.isConnected(), false);
  assert.deepEqual(db.claims(), []);
  assert.equal(db.config('claimMode'), undefined);
  assert.deepEqual(db.undelivered('trisha'), []);
  assert.throws(() => db.heartbeat('trisha'), /not connected/);
  db.close();
  assert.ok(logs.some((l) => l.includes('connect error')), logs.join('\n'));
});
