import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Daemon } from './daemon.ts';
import { FakeDb } from './db.ts';
import type { SproutConfig } from './config.ts';
import { categoryOf, isHidden, shareOf } from './share.ts';
import { safeText } from './messages.ts';

process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-share-test-'));

const cfg = (share: SproutConfig['share'] = {}): SproutConfig => ({
  handle: 'shriya', color: '', stdbUri: 'ws://x', db: 'sprout', mcpUrl: 'http://x',
  repos: [{ root: '/Users/s/proj', name: 'team/proj' }], paused: false, share,
});
const tick = () => new Promise((r) => setTimeout(r, 20));

async function daemon(share: SproutConfig['share'] = {}, db = new FakeDb()) {
  const d = new Daemon(cfg(share), () => {});
  await d.start({ db, listen: false, poll: false });
  await tick();
  db.calls.length = 0;
  return { d, db };
}

const msg = (id: string, fromHandle: string, toHandle: string, status: 'sent' | 'delivered' | 'acked' = 'sent') =>
  ({ id, fromHandle, toHandle, kind: 'finding', body: `hello ${id}`, status, sentAt: Date.now() });

test('isHidden: files, folders, name globs and path globs', () => {
  const h = ['secrets/', '.env*', 'src/private.ts', 'config/**/*.local.json'];
  assert.ok(isHidden(h, 'secrets/a.txt'));
  assert.ok(isHidden(h, 'secrets/deep/b.txt'));
  assert.ok(isHidden(h, '.env'));
  assert.ok(isHidden(h, 'app/.env.local'));
  assert.ok(isHidden(h, 'src/private.ts'));
  assert.ok(isHidden(h, 'config/a/b/db.local.json'));
  assert.ok(!isHidden(h, 'secretsauce.ts'));
  assert.ok(!isHidden(h, 'src/private.tsx'));
  assert.ok(!isHidden(h, 'src/env.ts'));
  assert.ok(!isHidden([], 'anything'));
});

test('shareOf fills defaults and ignores junk', () => {
  assert.deepEqual(shareOf(null), { activity: true, reads: true, commands: true, tests: true, diffs: true, hidden: [], inbox: 'auto', compliments: true });
  const s = shareOf({ share: { reads: false, inbox: 'nope' as never, hidden: ['a/', 3 as never] } });
  assert.equal(s.reads, false);
  assert.equal(s.inbox, 'auto');
  assert.deepEqual(s.hidden, ['a/']);
  assert.equal(categoryOf('read'), 'reads');
  assert.equal(categoryOf('shell_cmd'), 'commands');
  assert.equal(categoryOf('edit'), 'activity');
});

test('turned-off categories never leave; hidden paths are stripped or dropped', async () => {
  const { d, db } = await daemon({ reads: false, commands: false, hidden: ['secrets/'] });
  d.handleEvent({ type: 'activity', repo: 'team/proj', kind: 'read', path: 'src/a.ts' });
  d.handleEvent({ type: 'activity', repo: 'team/proj', kind: 'bash', detail: 'git status' });
  d.handleEvent({ type: 'activity', repo: 'team/proj', kind: 'edit', path: 'secrets/key.txt' });
  d.handleEvent({ type: 'activity', repo: 'team/proj', kind: 'file_change', path: 'secrets/key.txt' });
  d.handleEvent({ type: 'activity', repo: 'team/proj', kind: 'edit', path: 'src/a.ts' });
  d.handleEvent({ type: 'diff', repo: 'team/proj', paths: ['secrets/key.txt', 'src/a.ts'] });
  await tick();
  assert.deepEqual(db.calls.map((c) => [c.name, (c.args as { kind?: string }).kind, (c.args as { path?: string }).path]), [
    ['ingestActivity', 'edit', undefined],
    ['ingestActivity', 'edit', 'src/a.ts'],
    ['recordDiff', undefined, undefined],
  ]);
  assert.deepEqual((db.calls[2]!.args as { paths: string[] }).paths, ['src/a.ts']);
  d.stop();
});

test('tests off: test runs stay local', async () => {
  const { d, db } = await daemon({ tests: false });
  d.handleEvent({ type: 'test_run', repo: 'team/proj', command: 'npm test', exitCode: 0 });
  await tick();
  assert.equal(db.calls.length, 0);
  d.stop();
});

test('inbox auto / ask / off decides what the hook injects; allow and ack', async () => {
  const db = new FakeDb();
  db.messages.push(msg('1', 'seno', 'shriya'), msg('2', 'trisha', 'shriya'), msg('3', 'shriya', 'seno'));
  const { d } = await daemon({}, db);
  assert.deepEqual(d.inbox().map((m) => m.id), ['1', '2']);

  d.cfg.share = { inbox: 'ask' };
  assert.deepEqual(d.inbox(), []);
  assert.deepEqual(d.held().map((m) => m.id), ['1', '2']);
  assert.deepEqual(d.allow(['2', '99']), ['2']);
  assert.deepEqual(d.inbox().map((m) => m.id), ['2']);
  assert.deepEqual(d.messagesView().inbox.map((m) => [m.id, m.held]), [['1', true], ['2', false]]);

  // ack a held message: it never reaches the agent
  assert.deepEqual(await d.ack(['1']), [{ id: '1' }]);
  assert.deepEqual(d.held(), []);
  assert.deepEqual(d.messagesView().inbox.map((m) => m.id), ['2']);
  assert.deepEqual((await d.ack(['3']))[0]!.error, 'only seno can ack message #3');

  d.cfg.share = { inbox: 'off' };
  assert.deepEqual(d.inbox(), []);
  assert.deepEqual(d.allow('all'), []);
  d.stop();
});

test('send: masks secrets, clips, refuses offline and bad input', async () => {
  const db = new FakeDb();
  const { d } = await daemon({}, db);
  const r = await d.sendMessage('@seno', 'routes moved,\n  token=abc123def456 see src/api.ts', 'finding');
  assert.deepEqual(r, { ok: true, body: 'routes moved, token=*** see src/api.ts', masked: true });
  assert.deepEqual(db.calls.at(-1), { name: 'postMessage', args: { fromHandle: 'shriya', toHandle: 'seno', kind: 'finding', body: 'routes moved, token=*** see src/api.ts' } });
  assert.equal(d.messagesView().sent.length, 1);
  assert.equal((await d.sendMessage('seno', 'x'.repeat(900), 'request') as { body: string }).body.length, 500);
  assert.deepEqual(await d.sendMessage('seno', '   ', 'finding'), { ok: false, error: 'message is empty' });
  assert.equal((await d.sendMessage('bad handle!', 'hi', 'finding')).ok, false);
  assert.equal((await d.sendMessage('seno', 'hi', 'system')).ok, false);
  db.setConnected(false);
  assert.match((await d.sendMessage('seno', 'hi', 'finding') as { error: string }).error, /offline/);
  d.stop();
});

test('safeText strips terminal escapes from untrusted messages', () => {
  assert.equal(safeText('hi\u001b[2Jthere\u0007\nnext'), 'hi[2Jthere next');
});
