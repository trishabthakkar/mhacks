import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GardenSnapshot } from '../../../shared/types.ts';
import { hoverText, inspect } from './inspect.ts';

const NOW = Date.UTC(2026, 9, 4, 12, 0);
const snap = (o: Partial<GardenSnapshot> = {}): GardenSnapshot => ({
  at: NOW,
  members: [{ handle: 'trisha', color: '#7fb069', online: true, paused: false, lastSeen: NOW }, { handle: 'seno', color: '#e4572e', online: false, paused: false, lastSeen: 0 }],
  agents: [{ sessionId: 's1', handle: 'trisha', kind: 'claude', status: 'working', currentPath: 'src/api/routes.ts', currentAction: 'edit', lastSeen: NOW }],
  plants: [
    { path: 'src/api/routes.ts', bed: 'src/api', lines: 120, stage: 'growing', bugs: 2, lastActivity: NOW - 120_000, lastTouchedBy: 'trisha' },
    { path: 'src/api/db.ts', bed: 'src/api', lines: 40, stage: 'bloom', bugs: 0, lastActivity: NOW - 7_200_000 },
    { path: 'spacetimedb/module_bindings/a.ts', bed: 'spacetimedb', lines: 10, stage: 'growing', bugs: 0, lastActivity: NOW },
    { path: 'spacetimedb/module_bindings/b.ts', bed: 'spacetimedb', lines: 12, stage: 'growing', bugs: 0, lastActivity: NOW },
  ],
  claims: [{ id: 1, path: 'src/api/', handle: 'trisha', createdAt: NOW - 60_000, expiresAt: NOW + 30 * 60_000 }],
  messages: [], testRuns: [{ id: 1, handle: 'trisha', repo: '/x/mhacks', command: 'npm test', exitCode: 1, at: NOW - 60_000 }],
  certifications: [{ id: 1, path: 'src/api/db.ts', handle: 'trisha', task: 'db', result: 'bloom', reason: '', at: NOW - 3_600_000 }],
  activity: [
    { id: 1, at: NOW - 300_000, handle: 'trisha', kind: 'edit', path: 'src/api/routes.ts', detail: '' },
    { id: 2, at: NOW - 200_000, handle: 'trisha', kind: 'commit', path: 'src/api/routes.ts', detail: 'routes refactor' },
  ],
  ...o,
});
const ctx = { repo: 'mhacks' };

test('plant: path, stage, last toucher, fence and recent events', () => {
  const r = inspect({ kind: 'plant', key: 'src/api/routes.ts' }, snap(), ctx)!;
  assert.equal(r.title, 'routes.ts');
  assert.match(r.body, /src\/api\/routes\.ts/);
  assert.match(r.body, /growing/);
  assert.match(r.body, /2 bugs/);
  assert.match(r.body, /trisha/);
  assert.match(r.body, /fenced by <b>trisha<\/b>/);
  assert.match(r.body, /watering routes\.ts/);
});

test('plant: a generated hedge key summarises its folder', () => {
  const r = inspect({ kind: 'plant', key: 'spacetimedb/module_bindings/' }, snap(), ctx)!;
  assert.match(r.title, /module_bindings/);
  assert.match(r.body, /2 generated files/);
});

test('bed: file count, stage breakdown, its fence, recent files', () => {
  const r = inspect({ kind: 'bed', key: 'src/api' }, snap(), ctx)!;
  assert.match(r.body, /2 files/);
  assert.match(r.body, /data-select="plant:src\/api\/routes\.ts"/);
  assert.match(r.body, /src\/api\//);
});

test('member: status, last test, recent events', () => {
  const r = inspect({ kind: 'member', key: 'trisha' }, snap(), ctx)!;
  assert.match(r.body, /tests failing/);
  assert.match(r.body, /routes\.ts/);
});

test('botanist, pond, commit and garden views', () => {
  assert.match(inspect({ kind: 'botanist' }, snap(), ctx)!.body, /Bloom/);
  assert.match(inspect({ kind: 'pond' }, snap(), ctx)!.body, /routes refactor/);
  assert.match(inspect({ kind: 'commit', key: 2 }, snap(), ctx)!.body, /class="hit"/);
  const g = inspect({ kind: 'garden' }, snap(), ctx)!;
  assert.equal(g.title, 'mhacks');
  assert.match(g.body, /4 plants/);
});

test('a just-touched plant says "just now", not "now ago"', () => {
  const r = inspect({ kind: 'plant', key: 'src/api/routes.ts' }, snap({ plants: [{ path: 'src/api/routes.ts', bed: 'src/api', lines: 1, stage: 'seed', bugs: 0, lastActivity: NOW }] }), ctx)!;
  assert.match(r.body, /just now/);
  assert.doesNotMatch(r.body, /now ago/);
});

test('returns null when the subject is gone', () => {
  assert.equal(inspect({ kind: 'plant', key: 'gone.ts' }, snap(), ctx), null);
  assert.equal(inspect({ kind: 'bed', key: 'nope' }, snap(), ctx), null);
  assert.equal(inspect({ kind: 'member', key: 'ghost' }, snap(), ctx), null);
  assert.equal(inspect({ kind: 'task', key: 99 }, snap(), ctx), null);
  assert.equal(inspect({ kind: 'commit', key: 99 }, snap(), ctx), null);
});

test('escapes hostile text everywhere', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const s = snap({ plants: [{ path: `src/${evil}.ts`, bed: 'src', lines: 1, stage: 'seed', bugs: 0, lastActivity: NOW }],
    activity: [{ id: 3, at: NOW, handle: evil, kind: 'commit', path: `src/${evil}.ts`, detail: evil }] });
  for (const p of [{ kind: 'plant', key: `src/${evil}.ts` }, { kind: 'bed', key: 'src' }, { kind: 'pond' }] as const) {
    assert.doesNotMatch(inspect(p, s, { repo: evil })!.body, /<img/); // titles are plain text; the shed escapes them
  }
  assert.doesNotMatch(inspect({ kind: 'garden' }, s, { repo: evil })!.body, /<img/);
});

test('hover text is one short plain line', () => {
  assert.equal(hoverText({ kind: 'plant', key: 'src/api/routes.ts' }, snap()), 'routes.ts · growing · 2 🐛 · trisha 2m ago');
  assert.equal(hoverText({ kind: 'member', key: 'seno' }, snap()), 'seno · offline');
  assert.equal(hoverText({ kind: 'plant', key: 'gone.ts' }, snap()), null);
});
