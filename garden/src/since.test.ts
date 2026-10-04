import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GardenSnapshot } from '../../shared/types.ts';
import { lastVisit, sinceSummary } from './since.ts';

const NOW = 100_000_000, MIN = 60_000, SINCE = NOW - 90 * MIN;
const base = (o: Partial<GardenSnapshot> = {}): GardenSnapshot => ({ at: NOW, members: [], agents: [], plants: [], claims: [], messages: [], testRuns: [],
  certifications: [], activity: [], tasks: [], taskItems: [], ...o });
const cert = (id: number, path: string, handle: string, result: 'bloom' | 'refused', at: number) => ({ id, path, handle, task: '', result, reason: '', at });

test('sinceSummary: blooms, refusals, finished tasks, new fences and commits since the last visit, newest work only', () => {
  const s = base({
    certifications: [cert(1, 'src/old.ts', 'ana', 'bloom', SINCE - MIN), cert(2, 'src/a.ts', 'ana', 'bloom', NOW - 10 * MIN), cert(3, 'src/b.ts', 'ben', 'bloom', NOW - 5 * MIN), cert(4, 'web/x.ts', 'ben', 'refused', NOW - 4 * MIN)],
    tasks: [{ id: 1, handle: 'ana', title: 'add retry to upload client.', status: 'done', bed: '', paths: [], createdAt: 0, updatedAt: NOW - MIN, doneAt: NOW - MIN }],
    claims: [{ id: 1, path: 'src/api/', handle: 'ben', createdAt: NOW - 20 * MIN, expiresAt: NOW + 10 * MIN }, { id: 2, path: 'old/', handle: 'ben', createdAt: SINCE - MIN, expiresAt: NOW + MIN }],
    activity: [{ id: 1, at: NOW - 30 * MIN, handle: 'ana', kind: 'commit', detail: 'x' }, { id: 2, at: NOW - 3 * MIN, handle: 'ben', kind: 'commit', detail: 'y' }, { id: 3, at: SINCE - 5, handle: 'ben', kind: 'commit', detail: 'z' }],
  });
  const r = sinceSummary(s, SINCE)!;
  assert.equal(r.title, 'Since you were last here (1h 30m ago)');
  const t = r.lines.map((l) => l.text);
  assert.ok(t.includes('🌸 2 files bloomed: a.ts, b.ts'), JSON.stringify(t));
  assert.ok(t.includes('✋ The botanist refused x.ts (ben)'));
  assert.ok(t.includes('✅ ana finished "Add retry to upload client"'));
  assert.ok(t.includes('🔒 ben fenced src/api/'));
  assert.ok(t.includes('🌧️ 2 commits'));
  assert.ok(r.lines.length <= 6);
});

test('sinceSummary: with ?me, messages for you and refusals on your files come first', () => {
  const s = base({
    certifications: [cert(1, 'src/mine.ts', 'ana', 'refused', NOW - 2 * MIN)],
    plants: [{ path: 'src/mine.ts', bed: 'src', lines: 1, stage: 'growing', bugs: 0, lastActivity: NOW, lastTouchedBy: 'me' }],
    messages: [{ id: 1, fromHandle: 'ana', toHandle: 'me', kind: 'finding', body: 'hi', status: 'sent', sentAt: NOW - MIN }, { id: 2, fromHandle: 'ana', toHandle: 'ben', kind: 'finding', body: 'x', status: 'sent', sentAt: NOW - MIN }],
  } as never);
  const r = sinceSummary(s, SINCE, 'me')!;
  assert.equal(r.lines[0]!.text, '🦋 1 message for you (from ana)');
  assert.equal(r.lines[1]!.text, '✋ The botanist refused your mine.ts');
  assert.deepEqual(r.lines[1]!.pick, { kind: 'plant', key: 'src/mine.ts' });
});

test('sinceSummary: nothing new, or a visit under 10 minutes ago → no card', () => {
  assert.equal(sinceSummary(base(), SINCE), null);
  assert.equal(sinceSummary(base({ activity: [{ id: 2, at: NOW - MIN, handle: 'ben', kind: 'commit', detail: 'y' }] }), NOW - 5 * MIN), null);
});

test('lastVisit: returns the previous visit and records now; storage failures never throw', () => {
  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  assert.equal(lastVisit(store, 'db1', 1000), undefined);
  assert.equal(lastVisit(store, 'db1', 5000), 1000);
  assert.equal(lastVisit(store, 'db2', 5000), undefined); // per garden
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(lastVisit(broken, 'db1', 1), undefined);
});
