import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkClaim, claimMatches, Daemon } from './daemon.ts';
import { FakeDb } from './db.ts';
import type { SproutConfig } from './config.ts';

process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-daemon-test-'));

const cfg = (): SproutConfig => ({
  handle: 'trisha', color: '#2a9d8f', stdbUri: 'ws://x', db: 'sprout', mcpUrl: 'http://x',
  repos: [{ root: '/Users/t/proj', name: 'team/proj' }], paused: false,
});
const quiet = () => {};
const tick = () => new Promise((r) => setTimeout(r, 20));

async function daemon(db = new FakeDb()) {
  const d = new Daemon(cfg(), quiet);
  await d.start({ db, listen: false, poll: false });
  await tick();
  return { d, db };
}

test('claim matching: exact file or dir prefix ending in /', () => {
  assert.ok(claimMatches('src/api/routes.ts', 'src/api/routes.ts'));
  assert.ok(claimMatches('src/api/', 'src/api/routes.ts'));
  assert.ok(!claimMatches('src/api', 'src/api/routes.ts'));
  assert.ok(!claimMatches('src/api/', 'src/apiary.ts'));
});

test('checkClaim ignores my own and expired claims; reports mode', () => {
  const now = 1_000_000;
  const claims = [
    { id: '1', path: 'a.ts', handle: 'trisha', expiresAt: now + 1000 },
    { id: '2', path: 'b/', handle: 'alex', expiresAt: now - 1 },
    { id: '3', path: 'b/', handle: 'sam', expiresAt: now + 5000 },
  ];
  assert.deepEqual(checkClaim(claims, 'trisha', 'a.ts', 'block', now), { fenced: false, mode: 'block' });
  assert.deepEqual(checkClaim(claims, 'trisha', 'b/x.ts', 'warn', now), { fenced: true, mode: 'warn', holder: 'sam', claimPath: 'b/', expiresAt: now + 5000 });
  assert.equal(checkClaim(claims, 'trisha', 'c.ts', undefined, now).mode, 'warn');
});

test('connect → joinMember; activity → ingestActivity with my handle', async () => {
  const { d, db } = await daemon();
  assert.deepEqual(db.calls[0], { name: 'joinMember', args: { handle: 'trisha', color: '#2a9d8f' } });
  d.handleEvent({ type: 'activity', repo: 'team/proj', sessionId: 's1', kind: 'edit', path: 'src/a.ts', lines: 12 });
  await tick();
  assert.deepEqual(db.calls.at(-1), { name: 'ingestActivity', args: { handle: 'trisha', kind: 'edit', sessionId: 's1', parentSessionId: undefined, path: 'src/a.ts', lines: 12, detail: undefined } });
  d.stop();
});

test('defense in depth: bad kinds, absolute and .. paths never leave', async () => {
  const { d, db } = await daemon();
  const n = db.calls.length;
  d.handleEvent({ type: 'activity', kind: 'nope' as never });
  d.handleEvent({ type: 'activity', kind: 'read', path: '/etc/passwd' });
  d.handleEvent({ type: 'activity', kind: 'read', path: '../x' });
  await tick();
  assert.equal(db.calls.length, n + 2);
  for (const c of db.calls.slice(n)) assert.equal((c.args as { path?: string }).path, undefined);
  d.stop();
});

test('shell events: tests → recordTestRun (redacted), others → shell_cmd (binary+sub); outside repo dropped', async () => {
  const { d, db } = await daemon();
  const n = db.calls.length;
  d.handleEvent({ type: 'shell', cmd: 'TOKEN=abc123 npm test', exitCode: 1, cwd: '/Users/t/proj/src' });
  d.handleEvent({ type: 'shell', cmd: 'git commit -m "secret plans"', exitCode: 0, cwd: '/Users/t/proj' });
  d.handleEvent({ type: 'shell', cmd: 'npm test', exitCode: 0, cwd: '/Users/t/other' });
  d.handleEvent({ type: 'shell', cmd: 'sprout status', exitCode: 0, cwd: '/Users/t/proj' });
  await tick();
  const calls = db.calls.slice(n);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { name: 'recordTestRun', args: { handle: 'trisha', repo: 'team/proj', command: 'TOKEN=*** npm test', exitCode: 1 } });
  assert.equal((calls[1]!.args as { kind: string; detail: string }).kind, 'shell_cmd');
  assert.equal((calls[1]!.args as { detail: string }).detail, 'git commit');
  d.stop();
});

test('commit diff → recordDiff with sha (the module logs the commit activity)', async () => {
  const { d, db } = await daemon();
  const n = db.calls.length;
  d.handleEvent({ type: 'diff', repo: 'team/proj', paths: ['a.ts', '/abs/b.ts'], commit: 'abcdef1234567' });
  await tick();
  assert.deepEqual(db.calls[n], { name: 'recordDiff', args: { handle: 'trisha', paths: ['a.ts'], commit: 'abcdef1234567' } });
  assert.equal(db.calls.length, n + 1);
  d.stop();
});

test('/check logs blocked_edit (block: who/until; warn: "warned")', async () => {
  const db = new FakeDb();
  const { d } = await daemon(db);
  db.claimRows = [{ id: '1', path: 'src/api/', handle: 'alex', expiresAt: Date.now() + 60_000 }];
  db.configRows.set('claimMode', 'block');
  const n = db.calls.length;
  const r = d.check('src/api/routes.ts', 's1');
  assert.equal(r.fenced && r.holder, 'alex');
  db.configRows.set('claimMode', 'warn');
  d.check('src/api/routes.ts', 's1');
  await tick();
  const [b, w] = db.calls.slice(n).map((c) => c.args as { kind: string; detail: string });
  assert.equal(b!.kind, 'blocked_edit');
  assert.match(b!.detail, /^fenced by alex until \d+:\d\d[ap]m$/);
  assert.equal(w!.detail, 'warned');
  d.stop();
});

test('inbox: undelivered only, once; /delivered → markDelivered', async () => {
  const db = new FakeDb();
  const { d } = await daemon(db);
  db.messages.push(
    { id: '12', fromHandle: 'alex', toHandle: 'trisha', kind: 'finding', body: 'hi', sentAt: 1, status: 'sent' },
    { id: '13', fromHandle: 'alex', toHandle: 'sam', kind: 'finding', body: 'not mine', sentAt: 1, status: 'sent' },
  );
  assert.deepEqual(d.inbox().map((m) => m.id), ['12']);
  d.markDelivered(['12']);
  assert.deepEqual(d.inbox(), []);
  await tick();
  assert.deepEqual(db.calls.at(-1), { name: 'markDelivered', args: { handle: 'trisha', id: '12' } });
  d.stop();
});

test('offline queue: persisted to queue.jsonl, flushed in order on reconnect', async () => {
  const db = new FakeDb();
  const { d } = await daemon(db);
  db.setConnected(false);
  d.handleEvent({ type: 'activity', kind: 'read', path: 'a.ts' });
  d.handleEvent({ type: 'activity', kind: 'edit', path: 'b.ts' });
  assert.equal(d.queue.length, 2);
  d.persistQueue();
  const lines = readFileSync(join(process.env.SPROUT_HOME!, 'queue.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  // a restarted daemon picks the queue back up
  const db2 = new FakeDb();
  const d2 = new Daemon(cfg(), quiet);
  await d2.start({ db: db2, listen: false, poll: false });
  await tick();
  const kinds = db2.calls.filter((c) => c.name === 'ingestActivity').map((c) => (c.args as { kind: string }).kind);
  assert.deepEqual(kinds, ['read', 'edit']);
  assert.equal(d2.queue.length, 0);
  d.queue = [];
  d.stop(); d2.stop();
});

test('hook spool (daemon was down) is ingested on start', async () => {
  writeFileSync(join(process.env.SPROUT_HOME!, 'spool.jsonl'), JSON.stringify({ type: 'activity', kind: 'session_start', sessionId: 'sp' }) + '\n');
  const { d, db } = await daemon();
  await tick();
  assert.ok(db.calls.some((c) => c.name === 'ingestActivity' && (c.args as { sessionId?: string }).sessionId === 'sp'));
  assert.ok(!existsSync(join(process.env.SPROUT_HOME!, 'spool.jsonl')));
  d.stop();
});

test('pause: nothing is reported; setPaused sent', async () => {
  const { d, db } = await daemon();
  writeFileSync(join(process.env.SPROUT_HOME!, 'config.json'), JSON.stringify({ ...cfg(), paused: true }));
  d.reloadConfig();
  const n = db.calls.length;
  d.handleEvent({ type: 'activity', kind: 'read', path: 'a.ts' });
  d.handleEvent({ type: 'shell', cmd: 'npm test', exitCode: 0, cwd: '/Users/t/proj' });
  await tick();
  assert.deepEqual(db.calls.slice(n - 1).map((c) => c.name), ['setPaused']);
  d.stop();
});

test('botanist ordering: an unreported edit is recorded as a diff BEFORE the test run', async () => {
  const { execFileSync } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'sprout-order-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
  g('init', '-q'); g('config', 'user.email', 't@e.com'); g('config', 'user.name', 't');
  writeFileSync(join(root, 'users.js'), 'a\n'); g('add', '-A'); g('commit', '-qm', 'init');
  const db = new FakeDb();
  const d = new Daemon({ ...cfg(), repos: [{ root, name: 'team/demo' }] }, quiet);
  await d.start({ db, listen: false, poll: true });
  await d.poller.pollAll();
  writeFileSync(join(root, 'users.js'), 'a\nb\n'); // edited, not yet polled (5s tick)
  d.handleEvent({ type: 'test_run', repo: 'team/demo', command: 'npm test', exitCode: 0 });
  await new Promise((r) => setTimeout(r, 300));
  const names = db.calls.map((c) => c.name).filter((n) => n === 'recordDiff' || n === 'recordTestRun');
  assert.deepEqual(names, ['recordDiff', 'recordTestRun']);
  assert.deepEqual((db.calls.find((c) => c.name === 'recordDiff')!.args as { paths: string[] }).paths, ['users.js']);
  d.stop();
});
