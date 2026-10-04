import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toClaimPath } from './claims.ts';
import { Daemon } from './daemon.ts';
import { FakeDb } from './db.ts';

const root = mkdtempSync(join(tmpdir(), 'sprout-claims-'));
mkdirSync(join(root, 'src/api'), { recursive: true });
writeFileSync(join(root, 'src/api/routes.ts'), 'x\n');
const cfg = { repos: [{ root, name: 'team/proj' }] };

test('toClaimPath: files, folders, relative to cwd, outside the repo', () => {
  assert.deepEqual(toClaimPath(cfg, 'src/api/routes.ts', root), { path: 'src/api/routes.ts' });
  assert.deepEqual(toClaimPath(cfg, 'src/api', root), { path: 'src/api/' });
  assert.deepEqual(toClaimPath(cfg, 'src/api/', root), { path: 'src/api/' });
  assert.deepEqual(toClaimPath(cfg, 'routes.ts', join(root, 'src/api')), { path: 'src/api/routes.ts' });
  assert.deepEqual(toClaimPath(cfg, 'src/new-file.ts', root), { path: 'src/new-file.ts' }); // not on disk yet
  assert.ok('error' in toClaimPath(cfg, '/etc/passwd', root));
  assert.ok('error' in toClaimPath(cfg, '.', root));
  assert.ok('error' in toClaimPath({ repos: [] }, 'x.ts', root));
});

async function daemon() {
  process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-claims-home-'));
  const db = new FakeDb();
  const d = new Daemon({ handle: 'shriya', color: '', stdbUri: '', db: '', mcpUrl: '', repos: cfg.repos, paused: false }, () => {});
  await d.start({ db, listen: false, poll: false });
  return { d, db };
}

test('claim → claimFiles; a clash returns the error and claims nothing; release all', async () => {
  const { d, db } = await daemon();
  const ok = await d.claim(['src/api/', 'README.md'], 45);
  assert.equal(ok.ok, true);
  assert.deepEqual(db.calls.find((c) => c.name === 'claimFiles')!.args, { handle: 'shriya', paths: ['src/api/', 'README.md'], ttlMinutes: 45 });
  assert.deepEqual(d.claimsView().claims.map((c) => c.path), ['README.md', 'src/api/']);

  db.claimRows.push({ id: '9', path: 'garden/', handle: 'trisha', expiresAt: Date.now() + 60_000 });
  const clash = await d.claim(['garden/src/main.ts']);
  assert.equal(clash.ok, false);
  assert.match((clash as { error: string }).error, /fenced by trisha/);

  const rel = await d.release([]);
  assert.deepEqual(rel, { ok: true, released: ['src/api/', 'README.md'] });
  assert.deepEqual(d.claimsView().claims.map((c) => c.handle), ['trisha']);
  d.stop();
});

test('claim refuses bad paths, hidden paths and offline', async () => {
  const { d, db } = await daemon();
  assert.equal((await d.claim(['/etc/passwd'])).ok, false);
  assert.equal((await d.claim(['../x'])).ok, false);
  d.cfg = { ...d.cfg, share: { hidden: ['secrets/'] } } as typeof d.cfg;
  assert.match(((await d.claim(['secrets/key.txt'])) as { error: string }).error, /hidden/);
  db.setConnected(false);
  assert.match(((await d.claim(['src/a.ts'])) as { error: string }).error, /offline/);
  assert.equal(db.calls.filter((c) => c.name === 'claimFiles').length, 0);
  d.stop();
});
