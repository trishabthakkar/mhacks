# Garden Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 3D garden clickable (hover tooltip + click-to-inspect), replace the cluttered shed with a scannable Team / Activity / Inspector panel, fence the garden with a repo-name arch, and give it grounded lighting.

**Architecture:** Pure, unit-tested modules decide *what* (picking, inspector HTML, attention ranking, fence geometry, repo name); thin scene/UI classes draw it. Picking uses a ground-plane hit plus screen-space circles for characters instead of raycasting instanced meshes. The shed renders by comparing the full HTML string with the last render. Post-processing is an optional `EffectComposer` that falls back to a plain render.

**Tech Stack:** TypeScript (ESM, Node 22), three r170 + `three/addons`, Vite 6, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-04-garden-visual-polish-design.md`

## Global Constraints

- Only `garden/**`, `status/P4.md` and this plan/spec change. Never touch `shared/**`, `CONTRACT.md`, `garden/src/module_bindings/**`.
- No new runtime dependencies (three addons are already in `three`). Scratch tooling (playwright-core) lives in the session scratchpad and is never committed.
- Every agent- or user-written string (paths, task titles, message bodies, repo names) goes through `esc()` before entering HTML. A canvas `fillText` call doesn't need escaping, but its text is clipped.
- Respect `calm` / `prefers-reduced-motion` (no sway, no bounce, no auto-orbit) and `?quality=low` (no post-processing, no contact shadows).
- WebGL failing or the composer failing must never break the page (fall back to a plain render or the plan view).
- After each task: `cd garden && npm test` and `npm run build` are green. Then `git pull --rebase && git push`. Commit messages have **no** `Co-Authored-By` trailer.
- Baseline: 106 tests passing at the start.

## Execution Order

Run Task 6 (pure boundary + `repoName`) right after Task 3: Task 4's `main.ts` change imports `repoName`. Order: 0, 1, 2, 3, 6, 4, 5, 7, 8, 9, 10, 11. `memberStatus` lives in `ui/inspect.ts` (exported); `shed.ts` re-exports it instead of keeping a second copy, and a missing member is `'offline'` in both.

## Review Focus

1. **A drag that ends on an object must not select it.** Orbiting the camera ends with a pointerup over a plant. Only a press-and-release within 5 px is a click. This is pinned by the `isClick` tests in Task 1.
2. **The selected subject vanishes:** a file is deleted, a member leaves, or a timelapse resets. The inspector must close cleanly instead of showing stale data or throwing. This is pinned by the `inspect() returns null` tests in Task 2 and the check in `refresh()` in Task 5.
3. **Hostile or very long strings in a path, title, repo name or message body.** These must render escaped and clipped in the inspector, tooltip, attention strip and arch sign. This is pinned by the escaping tests in Tasks 2 and 3 and the `repoName` clip test in Task 6.
4. **Large gardens (`?bench=1000`).** Hover must not raycast per pointer event, and the fence must stay one draw call. Hover is processed once per frame (Task 5). The pickets are an InstancedMesh (Task 7). Task 1 has a 5000-plant `pickAt` correctness test.
5. **Clicking while the shed is collapsed, on a phone bottom sheet, or with the plan view open.** Selecting opens the shed. With the plan open, nothing is picked. This is pinned by the manual check in Task 5, step 6.

---

## Task 0: Scratch screenshot/interaction harness (not committed)

**Files:**
- Create: `$SCRATCH/shoot.mjs`, where `$SCRATCH=/private/tmp/claude-501/-Users-trishathakkar-Projects-mhacks/3529241e-d4ca-4349-8468-c87248c016f6/scratchpad`

- [ ] **Step 1: Install playwright-core in the scratchpad (drives the installed Chrome)**

```bash
cd $SCRATCH && npm init -y >/dev/null && npm i playwright-core@1 >/dev/null && echo ok
```

- [ ] **Step 2: Write `shoot.mjs`**

```js
// usage: node shoot.mjs <url> <out.png> [js-to-eval-after-load] [clickX,clickY]
import { chromium } from 'playwright-core';
const [url, out, js, click] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
p.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
p.on('pageerror', (e) => console.log('page error:', e.message));
await p.goto(url); await p.waitForTimeout(6000);
if (click) { const [x, y] = click.split(',').map(Number); await p.mouse.move(x, y); await p.waitForTimeout(400); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(1500); }
if (js) console.log(JSON.stringify(await p.evaluate(js)));
await p.screenshot({ path: out }); await b.close();
```

- [ ] **Step 3: Smoke it against the dev server**

```bash
cd /Users/trishathakkar/Projects/mhacks/garden && (npx vite --port 5199 >$SCRATCH/vite.log 2>&1 &); sleep 3
node $SCRATCH/shoot.mjs "http://localhost:5199/?source=fake&step=14&paused=1&debug=1" $SCRATCH/t0.png "__garden.bench(60)"
```

Expected: a JSON bench line is printed and `t0.png` shows the garden. Record `avgMs` and `drawCalls` for both `?source=fake...` and `?bench=120&debug=1` as the **baseline**.

---

## Task 1: Pure picker (`src/pick.ts`)

**Files:**
- Create: `garden/src/pick.ts`
- Test: `garden/src/pick.test.ts`

**Interfaces:**
- Produces: `type Pick`, `interface PickScene`, `interface PickInput`, `pickAt(inp, sc): Pick | null`, `pickKey(p): string`, `parsePick(s): Pick | null`, `samePick(a, b): boolean`, `isClick(down, up): boolean`, `const CLICK_PX = 5`.

- [ ] **Step 1: Write the failing tests**

```ts
// garden/src/pick.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isClick, parsePick, pickAt, pickKey, samePick, type PickInput, type PickScene } from './pick.ts';

const scene = (o: Partial<PickScene> = {}): PickScene => ({ people: [], plants: [], commits: [], beds: [], ...o });
const at = (x: number, z: number, o: Partial<PickInput> = {}): PickInput => ({ screen: { x: 500, y: 500 }, ground: { x, z }, shed: false, arch: false, ...o });

test('a person under the pointer beats the plant behind them', () => {
  const sc = scene({ people: [{ pick: { kind: 'member', key: 'trisha' }, sx: 505, sy: 498, r: 30, depth: 10 }], plants: [{ path: 'a.ts', x: 0, z: 0, size: 1 }] });
  assert.deepEqual(pickAt(at(0, 0), sc), { kind: 'member', key: 'trisha' });
});

test('of two overlapping people, the nearer to the camera wins', () => {
  const sc = scene({ people: [
    { pick: { kind: 'member', key: 'far' }, sx: 500, sy: 500, r: 30, depth: 20 },
    { pick: { kind: 'botanist' }, sx: 510, sy: 500, r: 30, depth: 8 },
  ] });
  assert.deepEqual(pickAt(at(99, 99), sc), { kind: 'botanist' });
});

test('a task pot (raycast hit) beats plants', () => {
  assert.deepEqual(pickAt(at(0, 0, { task: 7 }), scene({ plants: [{ path: 'a.ts', x: 0, z: 0, size: 1 }] })), { kind: 'task', key: 7 });
});

test('picks the nearest plant within its radius, else the bed', () => {
  const sc = scene({
    plants: [{ path: 'a.ts', x: 0, z: 0, size: 1 }, { path: 'b.ts', x: 1.7, z: 0, size: 1 }],
    beds: [{ name: 'src', x: 1, z: 0, w: 6, d: 4 }],
  });
  assert.deepEqual(pickAt(at(1.4, 0.1), sc), { kind: 'plant', key: 'b.ts' });
  assert.deepEqual(pickAt(at(1, 1.6), sc), { kind: 'bed', key: 'src' });
});

test('a lily pad beats the pond; open water is the pond', () => {
  const sc = scene({ pond: { x: 20, z: 0, r: 3 }, commits: [{ id: 42, x: 21, z: 0, size: 0.3 }] });
  assert.deepEqual(pickAt(at(21.1, 0.1), sc), { kind: 'commit', key: 42 });
  assert.deepEqual(pickAt(at(19, -1), sc), { kind: 'pond' });
});

test('shed and arch come from raycasts and only win over empty ground', () => {
  assert.deepEqual(pickAt(at(50, 50, { shed: true }), scene()), { kind: 'shed' });
  assert.deepEqual(pickAt(at(50, 50, { arch: true }), scene()), { kind: 'garden' });
  assert.deepEqual(pickAt(at(0, 0, { arch: true }), scene({ plants: [{ path: 'a.ts', x: 0, z: 0, size: 1 }] })), { kind: 'plant', key: 'a.ts' });
});

test('empty meadow (or no ground hit) picks nothing', () => {
  assert.equal(pickAt(at(50, 50), scene({ beds: [{ name: 'src', x: 0, z: 0, w: 4, d: 4 }] })), null);
  assert.equal(pickAt({ screen: { x: 0, y: 0 }, ground: null, shed: false, arch: false }, scene()), null);
});

test('stays correct with 5000 plants', () => {
  const plants = Array.from({ length: 5000 }, (_, i) => ({ path: `f${i}.ts`, x: (i % 100) * 1.7, z: Math.floor(i / 100) * 1.7, size: 1 }));
  assert.deepEqual(pickAt(at(1.7 * 37, 1.7 * 12), scene({ plants })), { kind: 'plant', key: 'f1237.ts' });
});

test('keys round-trip, including paths with colons', () => {
  for (const p of [{ kind: 'plant', key: 'src/a:b.ts' }, { kind: 'commit', key: 3 }, { kind: 'botanist' }, { kind: 'task', key: 12 }] as const) {
    assert.deepEqual(parsePick(pickKey(p)), p);
  }
  assert.equal(parsePick('nonsense:1'), null);
  assert.ok(samePick({ kind: 'bed', key: 'src' }, { kind: 'bed', key: 'src' }));
  assert.ok(!samePick({ kind: 'bed', key: 'src' }, null));
});

test('a press that moved more than 5px is a drag, not a click', () => {
  assert.ok(isClick({ x: 10, y: 10 }, { x: 13, y: 14 }));
  assert.ok(!isClick({ x: 10, y: 10 }, { x: 16, y: 10 }));
  assert.ok(!isClick(undefined, { x: 1, y: 1 }));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd garden && npx tsx --test src/pick.test.ts`
Expected: FAIL (cannot find module `./pick.ts`).

- [ ] **Step 3: Implement**

```ts
// garden/src/pick.ts
// Pure: what is under the pointer. The world fills a PickScene (characters projected to the screen, everything else
// on the ground) and passes raycast results for the few real meshes (task pots, shed, arch); this picks by priority.

export type Pick =
  | { kind: 'plant'; key: string } | { kind: 'bed'; key: string } | { kind: 'member'; key: string }
  | { kind: 'task'; key: number } | { kind: 'commit'; key: number }
  | { kind: 'botanist' } | { kind: 'pond' } | { kind: 'garden' } | { kind: 'shed' };

export interface PickScene {
  /** Gardeners and the botanist as screen-space circles (px); depth = distance to the camera. */
  people: Array<{ pick: Pick; sx: number; sy: number; r: number; depth: number }>;
  plants: Array<{ path: string; x: number; z: number; size: number }>;
  commits: Array<{ id: number; x: number; z: number; size: number }>;
  pond?: { x: number; z: number; r: number };
  beds: Array<{ name: string; x: number; z: number; w: number; d: number }>;
}
export interface PickInput {
  screen: { x: number; y: number };
  /** Where the pointer ray meets the plant-height plane, or null (pointing at the sky). */
  ground: { x: number; z: number } | null;
  task?: number; shed: boolean; arch: boolean;
}

export const CLICK_PX = 5;
export const isClick = (down: { x: number; y: number } | undefined, up: { x: number; y: number }) =>
  !!down && Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_PX;

const plantR = (size: number) => Math.max(0.6, size * 0.55);

export function pickAt(inp: PickInput, sc: PickScene): Pick | null {
  let best: { pick: Pick; depth: number } | undefined;
  for (const p of sc.people) {
    if (Math.hypot(inp.screen.x - p.sx, inp.screen.y - p.sy) <= p.r && (!best || p.depth < best.depth)) best = { pick: p.pick, depth: p.depth };
  }
  if (best) return best.pick;
  if (inp.task !== undefined) return { kind: 'task', key: inp.task };
  const g = inp.ground;
  if (g) {
    let plant: string | undefined, pd = Infinity;
    for (const p of sc.plants) {
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      if (d <= plantR(p.size) && d < pd) { pd = d; plant = p.path; }
    }
    if (plant !== undefined) return { kind: 'plant', key: plant };
    for (const c of sc.commits) if (Math.hypot(g.x - c.x, g.z - c.z) <= c.size + 0.15) return { kind: 'commit', key: c.id };
    if (sc.pond && Math.hypot(g.x - sc.pond.x, g.z - sc.pond.z) <= sc.pond.r) return { kind: 'pond' };
    for (const b of sc.beds) if (Math.abs(g.x - b.x) <= b.w / 2 && Math.abs(g.z - b.z) <= b.d / 2) return { kind: 'bed', key: b.name };
  }
  if (inp.shed) return { kind: 'shed' };
  if (inp.arch) return { kind: 'garden' };
  return null;
}

const KEYED = new Set(['plant', 'bed', 'member', 'task', 'commit']);
const NUMERIC = new Set(['task', 'commit']);
const BARE = new Set(['botanist', 'pond', 'garden', 'shed']);

/** A stable string for a pick ("plant:src/a.ts", "pond"), used in data attributes and comparisons. */
export function pickKey(p: Pick): string { return 'key' in p ? `${p.kind}:${p.key}` : p.kind; }
export function parsePick(s: string): Pick | null {
  const i = s.indexOf(':');
  const kind = i < 0 ? s : s.slice(0, i), rest = i < 0 ? '' : s.slice(i + 1);
  if (BARE.has(kind) && i < 0) return { kind } as Pick;
  if (!KEYED.has(kind) || !rest) return null;
  if (NUMERIC.has(kind)) { const n = Number(rest); return Number.isFinite(n) ? ({ kind, key: n } as Pick) : null; }
  return { kind, key: rest } as Pick;
}
export const samePick = (a: Pick | null, b: Pick | null) => !!a && !!b && pickKey(a) === pickKey(b);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd garden && npx tsx --test src/pick.test.ts`
Expected: all 10 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/trishathakkar/Projects/mhacks && git add garden/src/pick.ts garden/src/pick.test.ts && git commit -m "garden: pure picker (people by screen circle, plants/pads/pond/beds by ground point, raycast shed/arch/task pots), click-vs-drag"
```

---

## Task 2: Shared formatting + inspector HTML (`ui/fmt.ts`, `ui/inspect.ts`)

**Files:**
- Create: `garden/src/ui/fmt.ts`, `garden/src/ui/inspect.ts`
- Test: `garden/src/ui/inspect.test.ts`

**Interfaces:**
- Consumes: `Pick` (Task 1), `taskModels`, `currentTaskOf` (`src/tasks.ts`), `taskCardHtml`, `esc` (`ui/taskCard.ts`), `sentence` (`ui/sentences.ts`), `normalizeBed` (`src/layout.ts`).
- Produces:
  - `fmt.ts`: `esc`, `base(p)`, `clip(s, n)`, `rel(ms)` (e.g. `"now"`, `"3m"`, `"2h"`, `"1d"`), `ICON: Record<string, string>`
  - `inspect.ts`: `interface Inspect { title: string; body: string }`, `inspect(p: Pick, s: GardenSnapshot, ctx: { repo: string }): Inspect | null` (null means the subject is gone), `hoverText(p: Pick, s: GardenSnapshot): string | null`

- [ ] **Step 1: Write `fmt.ts` (no behaviour to test beyond what inspect tests cover)**

```ts
// garden/src/ui/fmt.ts
// Small text helpers shared by the shed, inspector and tooltips. Pure.
export { esc } from './taskCard.ts';
export const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Compact relative time: now, 4m, 2h, 3d. */
export const rel = (ms: number) => (ms < 45_000 ? 'now' : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : ms < 86_400_000 ? `${Math.floor(ms / 3_600_000)}h` : `${Math.floor(ms / 86_400_000)}d`);
/** One icon per activity kind for feed rows. */
export const ICON: Record<string, string> = {
  session_start: '👋', session_end: '🏠', prompt: '💬', read: '👀', search: '🔎', edit: '💧', create: '🌱', delete: '🪓',
  bash: '🧰', tool_error: '⚠️', subagent_start: '✨', subagent_stop: '✨', waiting: '⏳', idle: '😴', blocked_edit: '🚧',
  shell_cmd: '🧰', test_pass: '✅', test_fail: '🐛', commit: '🌧️', file_change: '✏️', claim: '🔒', release: '🔓',
  message_sent: '🦋', message_delivered: '🦋', message_acked: '👍', handoff_offered: '🤝', handoff_accepted: '🤝',
  certify_bloom: '🌸', certify_refused: '✋',
};
```

- [ ] **Step 2: Write the failing inspector tests**

```ts
// garden/src/ui/inspect.test.ts
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
    const r = inspect(p, s, { repo: evil })!;
    assert.doesNotMatch(r.body + r.title, /<img/);
  }
  assert.doesNotMatch(inspect({ kind: 'garden' }, s, { repo: evil })!.title, /<img/);
});

test('hover text is one short plain line', () => {
  assert.equal(hoverText({ kind: 'plant', key: 'src/api/routes.ts' }, snap()), 'routes.ts · growing · trisha 2m ago');
  assert.equal(hoverText({ kind: 'member', key: 'seno' }, snap()), 'seno · offline');
  assert.equal(hoverText({ kind: 'plant', key: 'gone.ts' }, snap()), null);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd garden && npx tsx --test src/ui/inspect.test.ts`
Expected: FAIL (cannot find `./inspect.ts`).

- [ ] **Step 4: Implement `inspect.ts`**

```ts
// garden/src/ui/inspect.ts
// Pure: the shed inspector's content for whatever was clicked in the 3D garden, and the one-line hover tooltip.
// Returns null when the subject no longer exists (the caller then clears the selection). Every string is escaped.
import type { ActivityView, GardenSnapshot } from '../../../shared/types.ts';
import type { Pick } from '../pick.ts';
import { normalizeBed } from '../layout.ts';
import { currentTaskOf, taskModels } from '../tasks.ts';
import { taskCardHtml } from './taskCard.ts';
import { sentence } from './sentences.ts';
import { base, clip, esc, ICON, rel } from './fmt.ts';

export interface Inspect { title: string; body: string }

const TRACK = ['seed', 'sprout', 'growing', 'bud', 'bloom'] as const;
const DAY = 86_400_000;
const covers = (claim: string, file: string) => claim === file || (claim.endsWith('/') && file.startsWith(claim));
const sec = (h: string, body: string) => `<section class="insp-sec"><h4>${h}</h4>${body}</section>`;
const kv = (rows: Array<[string, string]>) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const plantBtn = (path: string, label = base(path)) => `<button class="link" data-select="plant:${esc(path)}">${esc(clip(label, 34))}</button>`;

function eventList(s: GardenSnapshot, f: (a: ActivityView) => boolean, n = 5, hit?: number): string {
  const rows = s.activity.filter(f).slice(-n).reverse();
  if (!rows.length) return '<p class="sub">nothing yet</p>';
  return `<ul class="ev">${rows.map((a) => `<li${a.id === hit ? ' class="hit"' : ''}><span class="i" aria-hidden="true">${ICON[a.kind] ?? '•'}</span><span class="s">${esc(sentence(a))}${a.kind === 'commit' && a.detail ? ` <span class="sub">“${esc(clip(a.detail, 60))}”</span>` : ''}</span><span class="t">${rel(s.at - a.at)}</span></li>`).join('')}</ul>`;
}

function stageTrack(stage: string): string {
  if (stage === 'dormant') return '<span class="pill idle">💤 dormant</span>';
  const at = TRACK.indexOf(stage as (typeof TRACK)[number]);
  return `<ol class="track" aria-label="stage ${esc(stage)}">${TRACK.map((t, i) => `<li class="${i < at ? 'past' : i === at ? 'now' : ''}">${t}</li>`).join('')}</ol>`;
}

function breakdown(stages: string[]): string {
  const order = [...TRACK, 'dormant'], n = stages.length || 1;
  const parts = order.map((st) => [st, stages.filter((x) => x === st).length] as const).filter(([, c]) => c > 0);
  return `<div class="stagebar" role="img" aria-label="${parts.map(([st, c]) => `${c} ${st}`).join(', ')}">${parts.map(([st, c]) => `<span class="st-${st}" style="flex:${c / n}" title="${c} ${st}"></span>`).join('')}</div>
    <p class="sub">${parts.map(([st, c]) => `${c} ${st}`).join(' · ')}</p>`;
}

function memberStatus(s: GardenSnapshot, handle: string): string {
  const m = s.members.find((x) => x.handle === handle);
  if (!m) return 'gone';
  if (!m.online) return 'offline';
  if (m.paused) return 'paused';
  const bot = s.agents.find((a) => a.handle === handle && a.kind === 'claude' && a.status !== 'dormant');
  return bot?.status === 'blocked' ? 'blocked' : bot?.status === 'working' ? 'working' : 'idle';
}

export function inspect(p: Pick, s: GardenSnapshot, ctx: { repo: string }): Inspect | null {
  switch (p.kind) {
    case 'plant': {
      if (p.key.endsWith('/')) { // a folded module_bindings hedge
        const kids = s.plants.filter((x) => x.path.startsWith(p.key));
        if (!kids.length) return null;
        return { title: base(p.key), body: kv([['folder', `<code>${esc(p.key)}</code>`], ['files', `${kids.length} generated files`], ['lines', String(kids.reduce((a, k) => a + k.lines, 0))]]) +
          '<p class="sub">Generated code is folded into one hedge. Regenerate it, don\'t hand-edit it.</p>' };
      }
      const pv = s.plants.find((x) => x.path === p.key);
      if (!pv) return null;
      const fence = s.claims.find((c) => covers(c.path, pv.path));
      const cert = s.certifications.filter((c) => c.path === pv.path).at(-1);
      const rows: Array<[string, string]> = [
        ['path', `<code>${esc(pv.path)}</code>`],
        ['size', `${pv.lines} lines`],
        ['last touched', pv.lastTouchedBy ? `<b>${esc(pv.lastTouchedBy)}</b> · ${rel(s.at - pv.lastActivity)} ago` : `${rel(s.at - pv.lastActivity)} ago`],
      ];
      if (pv.bugs) rows.push(['bugs', `<span class="bad">🐛 ${pv.bugs} bug${pv.bugs === 1 ? '' : 's'}</span>`]);
      if (fence) rows.push(['fence', `🔒 fenced by <b>${esc(fence.handle)}</b> · ${Math.max(0, Math.round((fence.expiresAt - s.at) / 60_000))} min left`]);
      if (cert) rows.push(['botanist', `${cert.result === 'bloom' ? '🌸 Bloom' : '✋ Refused'} · ${rel(s.at - cert.at)} ago${cert.result === 'refused' && cert.reason ? `<div class="sub">${esc(clip(cert.reason, 140))}</div>` : ''}`]);
      return { title: base(pv.path), body: stageTrack(pv.stage) + kv(rows) + sec('Recent', eventList(s, (a) => a.path === pv.path)) };
    }
    case 'bed': {
      const files = s.plants.filter((x) => normalizeBed(x.bed) === p.key);
      if (!files.length) return null;
      const fences = s.claims.filter((c) => files.some((f) => covers(c.path, f.path)));
      const active = [...new Set(s.activity.filter((a) => a.path && files.some((f) => f.path === a.path) && s.at - a.at < 30 * 60_000).map((a) => a.handle))];
      const recent = [...files].sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 5);
      return {
        title: p.key,
        body: kv([['files', `${files.length} files`], ['lines', String(files.reduce((a, f) => a + f.lines, 0))]]) + breakdown(files.map((f) => f.stage)) +
          (fences.length ? sec('Fences', `<ul class="plain">${fences.map((c) => `<li>🔒 <b>${esc(c.handle)}</b> <code>${esc(c.path)}</code></li>`).join('')}</ul>`) : '') +
          (active.length ? sec('Working here', `<p>${active.map((h) => `<button class="link" data-select="member:${esc(h)}">${esc(h)}</button>`).join(', ')}</p>`) : '') +
          sec('Recently active', `<ul class="plain">${recent.map((f) => `<li>${plantBtn(f.path)} <span class="sub">${f.stage} · ${rel(s.at - f.lastActivity)}</span></li>`).join('')}</ul>`),
      };
    }
    case 'member': {
      const m = s.members.find((x) => x.handle === p.key);
      if (!m) return null;
      const task = currentTaskOf(s, m.handle);
      const model = task ? taskModels(s).find((t) => t.id === task.id) : undefined;
      const run = s.testRuns.filter((t) => t.handle === m.handle).at(-1);
      const unread = s.messages.filter((x) => x.toHandle === m.handle && x.status !== 'acked').length;
      const agents = s.agents.filter((a) => a.handle === m.handle && a.status !== 'dormant');
      const rows: Array<[string, string]> = [['status', `<span class="pill ${memberStatus(s, m.handle)}">${memberStatus(s, m.handle)}</span>`]];
      if (agents.length) rows.push(['agents', agents.map((a) => `${a.kind === 'subagent' ? '✨ helper' : '🤖 bot'} · ${esc(clip(a.currentAction || a.status, 24))}${a.currentPath ? ` ${plantBtn(a.currentPath)}` : ''}`).join('<br>')]);
      if (run) rows.push(['tests', run.exitCode === 0 ? '<span class="good">✓ passing</span>' : '<span class="bad">✗ tests failing</span>']);
      if (unread) rows.push(['inbox', `✉ ${unread} unread`]);
      return { title: m.handle, body: kv(rows) + (model ? sec('Current task', taskCardHtml(model, s.at, { compact: true })) : '') + sec('Recent', eventList(s, (a) => a.handle === m.handle)) };
    }
    case 'task': {
      const model = taskModels(s).find((t) => t.id === p.key);
      return model ? { title: model.title, body: taskCardHtml(model, s.at) } : null;
    }
    case 'botanist': {
      const certs = s.certifications.slice(-5).reverse();
      return { title: 'The botanist', body: '<p class="sub">Certifies a file only after its tests ran and passed.</p>' + (certs.length
        ? `<ul class="plain">${certs.map((c) => `<li>${c.result === 'bloom' ? '🌸 Bloom' : '✋ Refused'} ${plantBtn(c.path)} <span class="sub">${esc(c.handle)} · ${rel(s.at - c.at)}</span>${c.result === 'refused' && c.reason ? `<div class="sub">${esc(clip(c.reason, 140))}</div>` : ''}</li>`).join('')}</ul>`
        : '<p class="sub">Not asked yet.</p>') };
    }
    case 'pond':
    case 'commit': {
      if (p.kind === 'commit' && !s.activity.some((a) => a.id === p.key && a.kind === 'commit')) return null;
      return { title: 'The pond', body: '<p class="sub">Each lily pad is a commit from the last day, in the committer\'s colour.</p>' +
        eventList(s, (a) => a.kind === 'commit' && s.at - a.at <= DAY, 14, p.kind === 'commit' ? p.key : undefined) };
    }
    case 'garden': {
      const online = s.members.filter((m) => m.online).length, blooms = s.plants.filter((x) => x.stage === 'bloom').length;
      return { title: clip(ctx.repo, 40), body: kv([['gardeners', `${online} online · ${s.members.length} total`], ['plants', `${s.plants.length} plants`], ['blooming', String(blooms)], ['fences', String(s.claims.length)]]) + breakdown(s.plants.map((x) => x.stage)) };
    }
    case 'shed': return null;
  }
}

/** One plain-text line for the hover tooltip (set with textContent, so no escaping needed). */
export function hoverText(p: Pick, s: GardenSnapshot): string | null {
  switch (p.kind) {
    case 'plant': {
      if (p.key.endsWith('/')) return `${base(p.key)} · generated code`;
      const pv = s.plants.find((x) => x.path === p.key);
      if (!pv) return null;
      return `${clip(base(pv.path), 30)} · ${pv.stage}${pv.bugs ? ` · ${pv.bugs} 🐛` : ''}${pv.lastTouchedBy ? ` · ${pv.lastTouchedBy} ${rel(s.at - pv.lastActivity)} ago` : ''}`;
    }
    case 'bed': { const n = s.plants.filter((x) => normalizeBed(x.bed) === p.key).length; return n ? `${clip(p.key, 30)} · ${n} files` : null; }
    case 'member': return s.members.some((m) => m.handle === p.key) ? `${p.key} · ${memberStatus(s, p.key)}` : null;
    case 'task': { const t = (s.tasks ?? []).find((x) => x.id === p.key); return t ? clip(t.title, 40) : null; }
    case 'commit': { const a = s.activity.find((x) => x.id === p.key); return a ? `${a.handle} committed${a.detail ? `: ${clip(a.detail, 40)}` : ''}` : null; }
    case 'botanist': return 'The botanist · click for verdicts';
    case 'pond': return 'The pond · today\'s commits';
    case 'garden': return 'Click for the whole garden';
    case 'shed': return 'Garden shed · click to open the panel';
  }
}
```

- [ ] **Step 5: Run to verify it passes, then the full suite**

Run: `cd garden && npx tsx --test src/ui/inspect.test.ts && npm test`
Expected: inspect tests pass; full suite 106 + 10 + 8 pass. If the `hoverText` "2m ago" expectation is off by rounding, fix the implementation (`rel` rounds minutes), not the test.

- [ ] **Step 6: Commit**

```bash
cd /Users/trishathakkar/Projects/mhacks && git add garden/src/ui/fmt.ts garden/src/ui/inspect.ts garden/src/ui/inspect.test.ts && git commit -m "garden: inspector content for every clickable thing (plant, hedge, bed, gardener, task, botanist, pond/commit, whole garden) + hover line; escaped, null when the subject is gone"
```

---

## Task 3: Attention ranking + feed grouping (`ui/attention.ts`)

**Files:**
- Create: `garden/src/ui/attention.ts`
- Test: `garden/src/ui/attention.test.ts`

**Interfaces:**
- Consumes: `Pick`, `pickKey` (Task 1); `base`, `clip` (Task 2).
- Produces: `interface AttentionItem { rank: number; icon: string; text: string; pick: Pick | null; at: number }`, `shedAttention(s: GardenSnapshot): AttentionItem[]` (sorted by rank, then newest; uncapped), `groupFeed(rows: ActivityView[]): Array<{ a: ActivityView; count: number }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// garden/src/ui/attention.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityView, GardenSnapshot } from '../../../shared/types.ts';
import { groupFeed, shedAttention } from './attention.ts';

const NOW = Date.UTC(2026, 9, 4, 12, 0), MIN = 60_000;
const empty = (o: Partial<GardenSnapshot> = {}): GardenSnapshot => ({ at: NOW, members: [], agents: [], plants: [], claims: [], messages: [], testRuns: [], certifications: [], activity: [], ...o });
const act = (id: number, kind: ActivityView['kind'], o: Partial<ActivityView> = {}): ActivityView => ({ id, at: NOW, handle: 'seno', kind, detail: '', ...o });

test('all quiet: nothing to show', () => { assert.deepEqual(shedAttention(empty()), []); });

test('ranks: blocked edit, refusal, failing tests, expiring fence, stuck message, handoff', () => {
  const items = shedAttention(empty({
    activity: [act(1, 'blocked_edit', { path: 'src/a.ts', at: NOW - 2 * MIN })],
    certifications: [{ id: 1, path: 'src/b.ts', handle: 'trisha', task: '', result: 'refused', reason: 'no tests', at: NOW - MIN }],
    testRuns: [{ id: 1, handle: 'shriya', repo: 'r', command: 'npm test', exitCode: 1, at: NOW }],
    claims: [{ id: 1, path: 'src/c.ts', handle: 'trisha', createdAt: 0, expiresAt: NOW + 3 * MIN }],
    messages: [{ id: 1, fromHandle: 'seno', toHandle: 'manahil', kind: 'request', body: 'hi', status: 'sent', sentAt: NOW - 6 * MIN }],
    handoffs: [{ id: 1, fromHandle: 'a', toHandle: 'b', task: 't', notes: '', status: 'offered', createdAt: NOW }],
  }));
  assert.deepEqual(items.map((i) => i.rank), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(items[0]!.pick, { kind: 'plant', key: 'src/a.ts' });
  assert.deepEqual(items[2]!.pick, { kind: 'member', key: 'shriya' });
});

test('ignores old blocked edits, refusals since fixed by a bloom, passing reruns, far fences, fresh messages', () => {
  assert.deepEqual(shedAttention(empty({
    activity: [act(1, 'blocked_edit', { path: 'a', at: NOW - 11 * MIN })],
    certifications: [
      { id: 1, path: 'b', handle: 't', task: '', result: 'refused', reason: '', at: NOW - 5 * MIN },
      { id: 2, path: 'b', handle: 't', task: '', result: 'bloom', reason: '', at: NOW - MIN },
    ],
    testRuns: [{ id: 1, handle: 's', repo: '', command: '', exitCode: 1, at: NOW - 2 * MIN }, { id: 2, handle: 's', repo: '', command: '', exitCode: 0, at: NOW - MIN }],
    claims: [{ id: 1, path: 'c', handle: 't', createdAt: 0, expiresAt: NOW + 30 * MIN }],
    messages: [{ id: 1, fromHandle: 'a', toHandle: 'b', kind: 'request', body: '', status: 'sent', sentAt: NOW - 2 * MIN }],
  })), []);
});

test('a folder fence points at its bed; text is escaped', () => {
  const items = shedAttention(empty({
    plants: [{ path: 'src/api/x.ts', bed: 'src/api', lines: 1, stage: 'seed', bugs: 0, lastActivity: 0 }],
    claims: [{ id: 1, path: 'src/api/', handle: '<b>x</b>', createdAt: 0, expiresAt: NOW + MIN }],
  }));
  assert.deepEqual(items[0]!.pick, { kind: 'bed', key: 'src/api' });
  assert.doesNotMatch(items[0]!.text, /<b>/);
});

test('repeated identical events collapse into one row with a count', () => {
  const g = groupFeed([act(1, 'edit', { path: 'a' }), act(2, 'edit', { path: 'a' }), act(3, 'edit', { path: 'b' }), act(4, 'edit', { path: 'a' })]);
  assert.deepEqual(g.map((x) => [x.a.id, x.count]), [[2, 2], [3, 1], [4, 1]]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd garden && npx tsx --test src/ui/attention.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// garden/src/ui/attention.ts
// Pure: what needs a human right now, ranked, for the shed's top strip; and feed grouping. (The team board keeps
// its own broader list in tasks.ts: this one is time-bounded and short on purpose.)
import type { ActivityView, GardenSnapshot } from '../../../shared/types.ts';
import { normalizeBed } from '../layout.ts';
import type { Pick } from '../pick.ts';
import { base, clip, esc } from './fmt.ts';

export interface AttentionItem { rank: number; icon: string; text: string; pick: Pick | null; at: number }

const MIN = 60_000;

export function shedAttention(s: GardenSnapshot): AttentionItem[] {
  const out: AttentionItem[] = [];
  const seen = new Set<string>();
  for (const a of s.activity) {
    if (a.kind !== 'blocked_edit' || s.at - a.at > 10 * MIN) continue;
    const k = `${a.handle}|${a.path}`; if (seen.has(k)) continue; seen.add(k);
    out.push({ rank: 1, icon: '🚧', at: a.at, text: `<b>${esc(a.handle)}</b> was stopped at a fence${a.path ? ` on <code>${esc(clip(base(a.path), 28))}</code>` : ''}`,
      pick: a.path ? { kind: 'plant', key: a.path } : { kind: 'member', key: a.handle } });
  }
  const latest = new Map<string, (typeof s.certifications)[number]>();
  for (const c of s.certifications) { const p = latest.get(c.path); if (!p || c.at >= p.at) latest.set(c.path, c); }
  for (const c of latest.values()) if (c.result === 'refused') {
    out.push({ rank: 2, icon: '✋', at: c.at, text: `Botanist refused <code>${esc(clip(base(c.path), 28))}</code> (${esc(c.handle)})`, pick: { kind: 'plant', key: c.path } });
  }
  const lastRun = new Map<string, (typeof s.testRuns)[number]>();
  for (const t of s.testRuns) { const p = lastRun.get(t.handle); if (!p || t.at >= p.at) lastRun.set(t.handle, t); }
  for (const t of lastRun.values()) if (t.exitCode !== 0) {
    out.push({ rank: 3, icon: '🐛', at: t.at, text: `Tests failing for <b>${esc(t.handle)}</b>`, pick: { kind: 'member', key: t.handle } });
  }
  for (const c of s.claims) {
    const left = c.expiresAt - s.at;
    if (left <= 0 || left > 5 * MIN) continue;
    const inFolder = c.path.endsWith('/') ? s.plants.find((p) => p.path.startsWith(c.path)) : undefined;
    out.push({ rank: 4, icon: '⏰', at: c.createdAt, text: `<b>${esc(c.handle)}</b>'s fence on <code>${esc(clip(c.path, 28))}</code> ends in ${Math.max(1, Math.round(left / MIN))} min`,
      pick: inFolder ? { kind: 'bed', key: normalizeBed(inFolder.bed) } : c.path.endsWith('/') ? null : { kind: 'plant', key: c.path } });
  }
  for (const m of s.messages) {
    if (m.status !== 'sent' || s.at - m.sentAt < 5 * MIN) continue;
    out.push({ rank: 5, icon: '🦋', at: m.sentAt, text: `Message <b>${esc(m.fromHandle)}</b> → <b>${esc(m.toHandle)}</b> not delivered yet (${Math.round((s.at - m.sentAt) / MIN)} min)`, pick: { kind: 'member', key: m.toHandle } });
  }
  for (const h of s.handoffs ?? []) if (h.status === 'offered') {
    out.push({ rank: 6, icon: '🤝', at: h.createdAt, text: `<b>${esc(h.toHandle)}</b> has a handoff to accept: ${esc(clip(h.task, 40))}`, pick: { kind: 'member', key: h.toHandle } });
  }
  return out.sort((a, b) => a.rank - b.rank || b.at - a.at);
}

/** Consecutive rows with the same kind, person and path collapse into the newest one with a count (oldest first in, oldest first out). */
export function groupFeed(rows: ActivityView[]): Array<{ a: ActivityView; count: number }> {
  const out: Array<{ a: ActivityView; count: number }> = [];
  for (const a of rows) {
    const last = out.at(-1);
    if (last && last.a.kind === a.kind && last.a.handle === a.handle && last.a.path === a.path) { last.a = a; last.count++; }
    else out.push({ a, count: 1 });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd garden && npx tsx --test src/ui/attention.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/trishathakkar/Projects/mhacks && git add garden/src/ui/attention.ts garden/src/ui/attention.test.ts && git commit -m "garden: shed attention ranking (blocked edit, refusal, failing tests, expiring fence, stuck message, handoff) and feed grouping"
```

---

## Task 4: Shed redesign (`ui/shed.ts`, `ui/shed.css`)

**Files:**
- Modify (rewrite): `garden/src/ui/shed.ts`
- Create: `garden/src/ui/shed.css`
- Modify: `garden/index.html` (remove shed CSS rules), `garden/src/main.ts` (import CSS, new options/handlers)
- Test: `garden/src/ui/shed.test.ts` (keep the existing `agentRows` tests, add the ones below)

**Interfaces:**
- Consumes: `Pick`, `pickKey`, `parsePick` (Task 1); `inspect` (Task 2); `shedAttention`, `groupFeed` (Task 3); `esc`, `base`, `clip`, `rel`, `ICON` (Task 2); `sentence`.
- Produces:
  - `ShedOptions { source; connection; collapsed; following?: string | null; selected: Pick | null; repo: string }`
  - `ShedHandlers { onFocus(kind: FocusKind, key: string): void; onSelect(p: Pick | null): void; onToggle(): void }`
  - `renderShed(el, s, o)`, `initShed(el, h)`, `tickFreshness(el)`, `agentRows(...)` (unchanged)
  - `shedHtml(s, o, view: { tab: Tab; filter: Filter; expanded: ReadonlySet<string>; lastMaxId: number }): string`, pure and testable
  - `memberStatus(s, handle)`

- [ ] **Step 1: Add the failing tests to `shed.test.ts`**

```ts
// append to garden/src/ui/shed.test.ts
import { memberStatus, shedHtml } from './shed.ts';

const NOW = Date.UTC(2026, 9, 4, 12, 0);
const full = (o: Partial<GardenSnapshot> = {}): GardenSnapshot => ({
  at: NOW, members: [{ handle: 'trisha', color: '#7fb069', online: true, paused: false, lastSeen: NOW }, { handle: 'seno', color: '#e4572e', online: false, paused: false, lastSeen: 0 }],
  agents: [agent('s1', 'trisha', { currentPath: 'src/a.ts' }), agent('k1', 'trisha', { kind: 'subagent' })],
  plants: [{ path: 'src/a.ts', bed: 'src', lines: 3, stage: 'growing', bugs: 0, lastActivity: NOW }],
  claims: [], messages: [], testRuns: [], certifications: [], activity: [], ...o,
});
const opts = { source: 'live', connection: 'live', collapsed: false, selected: null, repo: 'mhacks' };
const view = { tab: 'team' as const, filter: 'all' as const, expanded: new Set<string>(), lastMaxId: -1 };

test('team tab: one card per online member, offline folded, status pill, helper badge', () => {
  const h = shedHtml(full(), opts, view);
  assert.match(h, /class="person[^"]*"[^>]*style="--c:#7fb069"/);
  assert.match(h, /pill working/);
  assert.match(h, /\+1 helper/);
  assert.match(h, /\+1 offline/);
  assert.doesNotMatch(h, /data-select="member:seno"/);
});

test('all quiet line when nothing needs attention; the strip otherwise', () => {
  assert.match(shedHtml(full(), opts, view), /All quiet/);
  const h = shedHtml(full({ testRuns: [{ id: 1, handle: 'trisha', repo: '', command: '', exitCode: 1, at: NOW }] }), opts, view);
  assert.match(h, /Tests failing for <b>trisha<\/b>/);
  assert.match(h, /data-select="member:trisha"/);
});

test('the attention strip shows at most 3, then "+N more"', () => {
  const runs = ['a', 'b', 'c', 'd', 'e'].map((h, i) => ({ id: i, handle: h, repo: '', command: '', exitCode: 1, at: NOW }));
  const h = shedHtml(full({ testRuns: runs }), opts, view);
  assert.equal((h.match(/class="row"/g) ?? []).length, 3);
  assert.match(h, /\+2 more/);
});

test('activity tab: open-now group only when non-empty; grouped feed rows with icons and times', () => {
  const act = (id: number) => ({ id, at: NOW - 120_000, handle: 'trisha', kind: 'edit' as const, path: 'src/a.ts', detail: '' });
  const h = shedHtml(full({ activity: [act(1), act(2)] }), opts, { ...view, tab: 'activity' });
  assert.doesNotMatch(h, /Open now/);
  assert.match(h, /💧/);
  assert.match(h, /×2/);
  assert.match(h, /2m/);
  const h2 = shedHtml(full({ claims: [{ id: 1, path: 'src/', handle: 'trisha', createdAt: 0, expiresAt: NOW + 3_600_000 }] }), opts, { ...view, tab: 'activity' });
  assert.match(h2, /Open now/);
});

test('a selection replaces the tabs with the inspector and a back button', () => {
  const h = shedHtml(full(), { ...opts, selected: { kind: 'plant', key: 'src/a.ts' } }, view);
  assert.match(h, /data-back/);
  assert.match(h, /a\.ts/);
  assert.doesNotMatch(h, /role="tablist"/);
});

test('member status', () => {
  const s = full();
  assert.equal(memberStatus(s, 'trisha'), 'working');
  assert.equal(memberStatus(s, 'seno'), 'offline');
  assert.equal(memberStatus(full({ agents: [agent('s1', 'trisha', { status: 'blocked' })] }), 'trisha'), 'blocked');
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd garden && npx tsx --test src/ui/shed.test.ts`
Expected: FAIL (`shedHtml`/`memberStatus` not exported).

- [ ] **Step 3: Rewrite `garden/src/ui/shed.ts`**

```ts
import type { GardenSnapshot } from '../../../shared/types.ts';
import { sentence } from './sentences.ts';
import { base, clip, esc, ICON, rel } from './fmt.ts';
import { groupFeed, shedAttention } from './attention.ts';
import { inspect } from './inspect.ts';
import { parsePick, pickKey, type Pick } from '../pick.ts';

const mins = (ms: number) => Math.round(ms / 60000);
const fmtMin = (m: number) => (m <= 0 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);

export type Filter = 'all' | 'claims' | 'messages' | 'tests' | 'botanist';
export type Tab = 'team' | 'activity';
const FILTERS: Array<[Filter, string, ReadonlySet<string> | null]> = [
  ['all', 'All', null],
  ['claims', 'Fences', new Set(['claim', 'release', 'blocked_edit'])],
  ['messages', 'Messages', new Set(['message_sent', 'message_delivered', 'message_acked', 'handoff_offered', 'handoff_accepted'])],
  ['tests', 'Tests', new Set(['test_pass', 'test_fail', 'commit'])],
  ['botanist', 'Botanist', new Set(['certify_bloom', 'certify_refused'])],
];
const ATTN_MAX = 3, MAX_PEOPLE = 10, MAX_GROUPS = 4;

export interface ShedOptions {
  source: string;
  /** Human text for the connection state, e.g. "live", "reconnecting (2)", "demo data". */
  connection: string;
  collapsed: boolean;
  /** What the camera follows: a handle, or "agent:<sessionId>". */
  following?: string | null;
  /** What is open in the inspector (null: the tabs). */
  selected: Pick | null;
  repo: string;
}

/** A gardener's live bot and subagents, each a button that flies the camera to it. `following` marks the followed one. */
export function agentRows(s: GardenSnapshot, handle: string, following?: string | null): string {
  const live = s.agents.filter((a) => a.handle === handle && a.status !== 'dormant')
    .sort((a, b) => Number(a.kind === 'subagent') - Number(b.kind === 'subagent'));
  if (!live.length) return '';
  return `<ul class="agents">${live.map((a) => {
    const key = `agent:${a.sessionId}`, sub = a.kind === 'subagent';
    const what = `${esc(clip(a.currentAction || a.status, 24))}${a.currentPath ? ` <code>${esc(base(a.currentPath))}</code>` : ''}`;
    return `<li><button class="link agent${following === key ? ' following' : ''}" data-focus="${esc(key)}" aria-label="Fly the camera to ${esc(handle)}'s ${sub ? 'helper agent' : 'bot'}">${sub ? '✨ helper' : '🤖 bot'} · ${what}</button></li>`;
  }).join('')}</ul>`;
}

export function memberStatus(s: GardenSnapshot, handle: string): 'working' | 'idle' | 'blocked' | 'offline' | 'paused' {
  const m = s.members.find((x) => x.handle === handle);
  if (!m || !m.online) return 'offline';
  if (m.paused) return 'paused';
  const bot = s.agents.find((a) => a.handle === handle && a.kind === 'claude' && a.status !== 'dormant');
  if (bot?.status === 'blocked' || s.activity.some((a) => a.kind === 'blocked_edit' && a.handle === handle && s.at - a.at < 10 * 60_000)) return 'blocked';
  return bot?.status === 'working' ? 'working' : 'idle';
}

export type FocusKind = 'member' | 'agent' | 'plant' | 'fence';
export interface ShedHandlers { onFocus(kind: FocusKind, key: string): void; onSelect(p: Pick | null): void; onToggle(): void }

function teamHtml(s: GardenSnapshot, o: ShedOptions, expanded: ReadonlySet<string>): string {
  const lastRun = new Map<string, number>();
  for (const t of s.testRuns) lastRun.set(t.handle, t.exitCode);
  const online = s.members.filter((m) => m.online), offline = s.members.length - online.length;
  if (!s.members.length) return '<p class="sub">Nobody has joined yet. Run <code>sprout join</code>.</p>';
  const cards = online.slice(0, MAX_PEOPLE).map((m) => {
    const st = memberStatus(s, m.handle);
    const bot = s.agents.find((a) => a.handle === m.handle && a.kind === 'claude' && a.status !== 'dormant');
    const helpers = s.agents.filter((a) => a.handle === m.handle && a.kind === 'subagent' && a.status !== 'dormant').length;
    const unread = s.messages.filter((x) => x.toHandle === m.handle && x.status !== 'acked').length;
    const fences = s.claims.filter((c) => c.handle === m.handle).length;
    const t = lastRun.get(m.handle);
    const what = bot ? `${esc(clip(bot.currentAction || bot.status, 22))}${bot.currentPath ? ` · <code>${esc(clip(base(bot.currentPath), 26))}</code>` : ''}` : 'no agent running';
    const badges = [
      unread ? `<span class="badge">✉ ${unread}</span>` : '',
      t === undefined ? '' : t === 0 ? '<span class="badge good">✓ tests</span>' : '<span class="badge bad">✗ tests</span>',
      fences ? `<span class="badge">🔒 ${fences}</span>` : '',
      helpers ? `<button class="badge" data-expand="${esc(m.handle)}" aria-expanded="${expanded.has(m.handle)}">+${helpers} helper${helpers === 1 ? '' : 's'}</button>` : '',
    ].join('');
    const following = o.following === m.handle || (o.following?.startsWith('agent:') && s.agents.some((a) => `agent:${a.sessionId}` === o.following && a.handle === m.handle));
    return `<li class="person${following ? ' following' : ''}" style="--c:${esc(m.color)}">
      <div class="top"><button class="name" data-select="member:${esc(m.handle)}" aria-label="Inspect ${esc(m.handle)}">${esc(m.handle)}</button>
        <span class="pill ${st}">${st}</span>
        <button class="icon sm" data-focus="member:${esc(m.handle)}" aria-label="Follow ${esc(m.handle)} with the camera" title="Follow with the camera">🎥</button></div>
      <div class="what">${what}</div>${badges ? `<div class="badges">${badges}</div>` : ''}
      ${expanded.has(m.handle) ? agentRows(s, m.handle, o.following) : ''}</li>`;
  }).join('');
  const more = online.length > MAX_PEOPLE ? online.length - MAX_PEOPLE : 0;
  return `<ul class="people">${cards}</ul>${offline || more ? `<p class="sub fold">${[more ? `+${more} more online` : '', offline ? `+${offline} offline` : ''].filter(Boolean).join(' · ')}</p>` : ''}`;
}

function openNowHtml(s: GardenSnapshot): string {
  const color = (h: string) => s.members.find((m) => m.handle === h)?.color ?? '#888';
  const rows: string[] = [];
  for (const c of s.claims) {
    const left = mins(c.expiresAt - s.at);
    rows.push(`<li><span class="i">🔒</span><button class="link" data-focus="fence:${esc(c.path)}"><b style="color:${esc(color(c.handle))}">${esc(c.handle)}</b> fenced <code>${esc(clip(c.path, 28))}</code></button><span class="t">${left <= 5 ? '⚠ ' : ''}${fmtMin(left)}</span></li>`);
  }
  const groups = new Map<string, { from: string; to: string; count: number; waiting: number; body: string; sent: number; oldest: number }>();
  for (const m of s.messages) {
    if (m.status === 'acked') continue;
    const k = `${m.fromHandle}\0${m.toHandle}`, g = groups.get(k);
    if (g) { g.count++; g.oldest = Math.min(g.oldest, m.sentAt); if (m.status === 'sent') g.waiting++; if (m.sentAt >= g.sent) { g.sent = m.sentAt; g.body = m.body; } }
    else groups.set(k, { from: m.fromHandle, to: m.toHandle, count: 1, waiting: m.status === 'sent' ? 1 : 0, body: m.body, sent: m.sentAt, oldest: m.sentAt });
  }
  const sorted = [...groups.values()].sort((a, b) => b.sent - a.sent);
  for (const g of sorted.slice(0, MAX_GROUPS)) {
    const state = g.waiting === g.count ? 'not delivered yet' : g.waiting ? `${g.waiting} undelivered` : 'delivered, not acked';
    rows.push(`<li><span class="i">🦋</span><span class="s"><b>${esc(g.from)}</b> → <b>${esc(g.to)}</b>${g.count > 1 ? ` ×${g.count}` : ''} <span class="sub">${state}</span><span class="sub quote">${esc(clip(g.body, 90))}</span></span><span class="t">${rel(s.at - g.oldest)}</span></li>`);
  }
  if (sorted.length > MAX_GROUPS) rows.push(`<li class="sub">+${sorted.length - MAX_GROUPS} more conversations</li>`);
  for (const h of (s.handoffs ?? []).filter((x) => x.status === 'offered')) rows.push(`<li><span class="i">🤝</span><span class="s"><b>${esc(h.fromHandle)}</b> → <b>${esc(h.toHandle)}</b> <span class="sub">${esc(clip(h.task, 60))}</span></span></li>`);
  for (const c of s.certifications.slice(-3).reverse()) rows.push(`<li><span class="i">${c.result === 'bloom' ? '🌸' : '✋'}</span><span class="s"><button class="link" data-select="plant:${esc(c.path)}">${c.result === 'bloom' ? 'Bloom' : 'Refused'} <code>${esc(clip(base(c.path), 26))}</code></button> <span class="sub">${esc(c.handle)}</span></span><span class="t">${rel(s.at - c.at)}</span></li>`);
  return rows.length ? `<section class="open-now"><h3>Open now</h3><ul class="rows">${rows.join('')}</ul></section>` : '';
}

function activityHtml(s: GardenSnapshot, filter: Filter, lastMaxId: number): string {
  const allowed = FILTERS.find((f) => f[0] === filter)![2];
  const rows = groupFeed(s.activity.slice(-60).filter((a) => !allowed || allowed.has(a.kind))).slice(-14).reverse();
  const feed = rows.map(({ a, count }) => {
    const sel = a.path ? ` data-select="plant:${esc(a.path)}"` : '';
    return `<li class="${lastMaxId >= 0 && a.id > lastMaxId ? 'new' : ''}"><span class="i" aria-hidden="true">${ICON[a.kind] ?? '•'}</span>${a.path ? `<button class="link s"${sel}>` : '<span class="s">'}${esc(sentence(a))}${count > 1 ? ` <b>×${count}</b>` : ''}${a.path ? '</button>' : '</span>'}<span class="t">${rel(s.at - a.at)}</span></li>`;
  }).join('') || '<li class="sub">nothing yet</li>';
  const chips = FILTERS.map(([k, label]) => `<button class="chip${k === filter ? ' on' : ''}" data-filter="${k}" aria-pressed="${k === filter}">${label}</button>`).join('');
  return `${openNowHtml(s)}<div class="chips" role="group" aria-label="Filter the feed">${chips}</div><ul class="rows feed" aria-label="Live feed">${feed}</ul>`;
}

/** The whole panel as HTML. Pure (the DOM wrapper below only diffs and wires events). */
export function shedHtml(s: GardenSnapshot, o: ShedOptions, view: { tab: Tab; filter: Filter; expanded: ReadonlySet<string>; lastMaxId: number }): string {
  const live = o.source !== 'fake' && o.connection === 'live';
  const items = shedAttention(s);
  const attn = items.length
    ? `<section class="attn" aria-label="Needs attention"><h3>Needs attention</h3>${items.slice(0, ATTN_MAX).map((i) =>
        `<button class="row"${i.pick ? ` data-select="${esc(pickKey(i.pick))}"` : ''}><span class="i" aria-hidden="true">${i.icon}</span><span>${i.text}</span></button>`).join('')}${items.length > ATTN_MAX ? `<p class="sub">+${items.length - ATTN_MAX} more</p>` : ''}</section>`
    : '<section class="attn quiet" aria-label="Needs attention">All quiet 🌿</section>';
  const insp = o.selected ? inspect(o.selected, s, { repo: o.repo }) : null;
  const main = insp
    ? `<section class="insp" aria-label="Inspector"><div class="insp-head"><button class="icon" data-back aria-label="Back to the shed (Esc)">←</button><h3>${esc(insp.title)}</h3></div>${insp.body}</section>`
    : `<div class="tabs" role="tablist">${(['team', 'activity'] as const).map((t) => `<button role="tab" data-tab="${t}" aria-selected="${view.tab === t}" class="${view.tab === t ? 'on' : ''}">${t === 'team' ? 'Team' : 'Activity'}</button>`).join('')}</div>
       <div role="tabpanel">${view.tab === 'team' ? teamHtml(s, o, view.expanded) : activityHtml(s, view.filter, view.lastMaxId)}</div>`;
  return `<div class="shed-head">
      <span aria-hidden="true">🌱</span><h2>Garden shed</h2>
      <span class="conn"><span class="conn-dot${live ? ' live' : ''}" aria-hidden="true"></span><span class="conn-text" role="status">${esc(o.connection)}</span></span>
      <button class="icon" data-toggle aria-label="${o.collapsed ? 'Open' : 'Collapse'} the garden shed (S)" aria-expanded="${!o.collapsed}">${o.collapsed ? '▤' : '✕'}</button>
    </div>
    <div class="shed-scroll" tabindex="-1">${attn}${main}<div class="fresh sub" data-fresh>updated just now</div></div>`;
}

// ---- DOM wrapper ----
const TAB_KEY = 'sprout.shed.tab';
let tab: Tab = 'team';
try { if (localStorage.getItem(TAB_KEY) === 'activity') tab = 'activity'; } catch { /* storage blocked */ }
let filter: Filter = 'all';
const expanded = new Set<string>();
let lastHtml = '';
let lastMaxId = -1; // -1 until the first render, so existing history isn't flagged as new
let hovering = false;
let pending: (() => void) | undefined;
let updatedAt = Date.now();

/** Wire clicks once on the container; rendering never recreates the listeners. */
export function initShed(el: HTMLElement, h: ShedHandlers) {
  const rerender = () => { lastHtml = ''; el.dispatchEvent(new CustomEvent('shed-rerender')); };
  el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-toggle],[data-back],[data-tab],[data-filter],[data-expand],[data-select],[data-focus]');
    if (!t) return;
    if (t.dataset.toggle !== undefined) { h.onToggle(); return; }
    if (t.dataset.back !== undefined) { h.onSelect(null); return; }
    if (t.dataset.tab) { tab = t.dataset.tab as Tab; try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ } rerender(); return; }
    if (t.dataset.filter) { filter = t.dataset.filter as Filter; rerender(); return; }
    if (t.dataset.expand) { const k = t.dataset.expand; if (expanded.has(k)) expanded.delete(k); else expanded.add(k); rerender(); return; }
    if (t.dataset.select) { const p = parsePick(t.dataset.select); if (p) h.onSelect(p); return; }
    const [kind, ...rest] = (t.dataset.focus ?? '').split(':');
    if (kind) h.onFocus(kind as FocusKind, rest.join(':'));
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); h.onToggle(); } });
  el.addEventListener('mouseenter', () => { hovering = true; });
  el.addEventListener('mouseleave', () => { hovering = false; pending?.(); pending = undefined; });
}

/** Re-render only when the HTML changed; defer while the pointer is over the panel (keeps what's under the cursor still). */
export function renderShed(el: HTMLElement, s: GardenSnapshot, o: ShedOptions) {
  const html = shedHtml(s, o, { tab, filter, expanded, lastMaxId });
  el.classList.toggle('collapsed', o.collapsed);
  if (html === lastHtml) return;
  if (hovering && !o.collapsed && lastHtml && !o.selected === !lastHtml.includes('data-back')) { pending = () => renderShed(el, s, o); return; }
  lastHtml = html; updatedAt = Date.now();
  lastMaxId = Math.max(lastMaxId, 0, ...s.activity.map((a) => a.id));
  const sc = el.querySelector<HTMLElement>('.shed-scroll'), scroll = sc?.scrollTop ?? 0;
  el.innerHTML = html;
  const sc2 = el.querySelector<HTMLElement>('.shed-scroll'); if (sc2) sc2.scrollTop = o.selected ? 0 : scroll;
}

/** Cheap once-a-second tick for the "updated Ns ago" line; no re-render. */
export function tickFreshness(el: HTMLElement) {
  const f = el.querySelector<HTMLElement>('[data-fresh]');
  if (!f) return;
  const sec = Math.round((Date.now() - updatedAt) / 1000);
  f.textContent = sec < 3 ? 'updated just now' : `updated ${sec}s ago`;
}
```

Note on the hover-defer condition: opening or closing the inspector (a click inside the panel) must render immediately even while hovering. Only background data updates are deferred.

- [ ] **Step 4: Create `garden/src/ui/shed.css`**

```css
/* Garden shed: right column on wide screens, bottom sheet on phones. Uses the page tokens (--ink, --card, --line, --ctl). */
aside#shed { position:fixed; top:12px; right:12px; width:330px; max-height:calc(100% - 24px); display:flex; flex-direction:column; background:var(--card); border:1px solid var(--line); border-radius:16px; font-size:13px; backdrop-filter:blur(8px); box-shadow:0 12px 32px rgba(40,50,30,.18); overflow:hidden; }
aside#shed.collapsed { width:auto; } aside#shed.collapsed .shed-scroll { display:none; } aside#shed.collapsed h2 { font-size:14px; }
.shed-head { display:flex; align-items:center; gap:8px; padding:12px 10px 10px 14px; border-bottom:1px solid var(--line); }
.shed-head h2 { margin:0; font-size:16px; flex:1; }
.conn { display:inline-flex; align-items:center; gap:5px; } .conn-text { font-size:11px; opacity:.72; }
.conn-dot { width:9px; height:9px; border-radius:50%; background:#d9a520; box-shadow:0 0 0 3px rgba(217,165,32,.22); } .conn-dot.live { background:#2e9d5b; box-shadow:0 0 0 3px rgba(46,157,91,.2); }
.shed-scroll { overflow:auto; padding:10px 12px 12px; display:flex; flex-direction:column; gap:10px; }
#shed h3 { margin:0 0 4px; font-size:11px; letter-spacing:.08em; text-transform:uppercase; opacity:.65; }
#shed code { font-size:11.5px; background:rgba(0,0,0,.06); padding:0 4px; border-radius:4px; }
#shed .sub { opacity:.68; font-size:12px; margin:0; }
#shed button.link, #shed button.name, #shed button.row, #shed .tabs button, #shed button.badge { all:unset; cursor:pointer; }
#shed button.link:hover, #shed button.name:hover, #shed button.row:hover span:last-child { text-decoration:underline; }
#shed button.icon { all:unset; cursor:pointer; width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center; border-radius:8px; } #shed button.icon:hover { background:rgba(0,0,0,.07); } #shed button.icon.sm { width:24px; height:24px; font-size:13px; }
#shed :is(button):focus-visible { outline:3px solid #2a6df4; outline-offset:1px; border-radius:6px; }
/* needs attention */
.attn { border-radius:12px; background:#fff3e0; border:1px solid #f0c48a; padding:8px 10px; display:flex; flex-direction:column; gap:2px; }
.attn.quiet { background:#edf7e8; border-color:#c3e2b4; color:#2f6b3a; font-weight:600; padding:7px 10px; }
.attn button.row { display:flex; gap:8px; align-items:baseline; padding:3px 0; line-height:1.35; }
/* tabs */
.tabs { display:flex; gap:4px; background:rgba(0,0,0,.055); border-radius:10px; padding:3px; }
.tabs button { flex:1; text-align:center; padding:6px 0; border-radius:8px; font-weight:650; } .tabs button.on { background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.12); }
/* team */
.people { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
.person { position:relative; background:rgba(255,255,255,.85); border:1px solid var(--line); border-radius:12px; padding:8px 8px 8px 16px; }
.person::before { content:''; position:absolute; left:0; top:8px; bottom:8px; width:5px; border-radius:0 5px 5px 0; background:var(--c); }
.person.following { box-shadow:0 0 0 2px #f2c230; }
.person .top { display:flex; align-items:center; gap:8px; } .person .name { font-weight:700; font-size:14px; flex:1; }
.person .what { font-size:12px; opacity:.78; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pill { font-size:11px; font-weight:700; padding:1px 8px; border-radius:999px; background:#eef0e6; color:#5b5a4a; text-transform:lowercase; }
.pill.working { background:#d8f3dc; color:#1f6b3a; } .pill.blocked { background:#fde2dd; color:#a5281b; } .pill.offline, .pill.paused, .pill.gone { background:#ececec; color:#6f6f6f; }
.badges { display:flex; gap:5px; flex-wrap:wrap; margin-top:5px; } .badge { font-size:11px; padding:1px 7px; border-radius:6px; background:rgba(0,0,0,.055); }
.badge.good, .good { color:#1f6b3a; } .badge.good { background:#d8f3dc; } .badge.bad, .bad { color:#a5281b; } .badge.bad { background:#fde2dd; }
#shed ul.agents { list-style:none; margin:6px 0 0; padding:0; } #shed ul.agents li { padding:1px 0; font-size:12px; }
#shed .agents .following { background:#fff1b8; border-radius:6px; padding:1px 6px; margin-left:-6px; box-shadow:0 0 0 2px #f2c230; }
.fold { margin-top:6px !important; }
/* activity */
.chips { display:flex; gap:4px; flex-wrap:wrap; } button.chip { all:unset; cursor:pointer; font-size:11px; padding:2px 9px; border-radius:999px; border:1px solid var(--ctl); background:#fff; } button.chip.on { background:var(--ink); color:#fff; }
#shed ul.rows, #shed ul.ev, #shed ul.plain { list-style:none; margin:0; padding:0; }
#shed ul.rows li, #shed ul.ev li { display:flex; gap:8px; align-items:baseline; padding:4px 0; border-bottom:1px solid var(--line); line-height:1.35; } #shed ul.rows li:last-child, #shed ul.ev li:last-child { border:0; }
#shed .i { flex:none; width:1.3em; text-align:center; } #shed .s { flex:1; min-width:0; } #shed .t { flex:none; margin-left:auto; font-size:11px; opacity:.55; font-variant-numeric:tabular-nums; }
#shed .quote { display:block; }
.open-now { background:rgba(255,255,255,.6); border:1px solid var(--line); border-radius:12px; padding:8px 10px; }
.feed li.new { animation:slidein .4s ease-out; background:rgba(255,226,122,.35); } @keyframes slidein { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
/* inspector */
.insp { display:flex; flex-direction:column; gap:8px; } .insp-head { display:flex; align-items:center; gap:6px; } .insp-head h3 { font-size:15px !important; text-transform:none !important; letter-spacing:0 !important; opacity:1 !important; margin:0 !important; word-break:break-all; }
.insp-sec h4 { margin:6px 0 2px; font-size:11px; letter-spacing:.08em; text-transform:uppercase; opacity:.6; }
dl.kv { display:grid; grid-template-columns:auto 1fr; gap:3px 12px; margin:0; } dl.kv dt { opacity:.6; } dl.kv dd { margin:0; min-width:0; word-break:break-word; }
ol.track { display:flex; list-style:none; margin:0; padding:0; gap:3px; } ol.track li { flex:1; text-align:center; font-size:10.5px; padding:3px 0; border-radius:6px; background:rgba(0,0,0,.05); opacity:.6; }
ol.track li.past { background:#cfe8c2; opacity:.85; } ol.track li.now { background:#2e9d5b; color:#fff; font-weight:700; opacity:1; }
.stagebar { display:flex; height:9px; border-radius:5px; overflow:hidden; background:rgba(0,0,0,.06); }
.st-seed { background:#8b6a45; } .st-sprout { background:#a8d88a; } .st-growing { background:#5fa04a; } .st-bud { background:#c9d86b; } .st-bloom { background:#f48fb1; } .st-dormant { background:#bdb9a4; }
#shed ul.ev li.hit { background:#fff1b8; border-radius:6px; }
#shed .task-card { margin:0; }
/* modes */
@media (max-width: 899px) { aside#shed { top:auto; right:0; left:0; bottom:0; width:auto; max-height:42vh; border-radius:16px 16px 0 0; } aside#shed.collapsed { left:auto; right:8px; bottom:8px; border-radius:14px; } }
@media (pointer: coarse) { #shed button.link, #shed button.name, #shed button.row, #shed .tabs button { min-height:44px; } }
body.present aside#shed { font-size:16px; width:390px; } body.present #shed .sub { font-size:14px; } body.present #shed h3 { font-size:13px; } body.present .person .name { font-size:17px; }
body.hc aside#shed { border:2px solid #000; background:#fff; } body.hc #shed .sub, body.hc #shed .t { opacity:1; }
```

- [ ] **Step 5: Remove the old shed rules from `garden/index.html`**

Delete these `<style>` lines/rules (each starts with the selector shown; delete the whole rule):
- `aside#shed {`, `aside#shed.collapsed {`, `aside#shed.collapsed .shed-scroll`, `.shed-head {`, `.shed-scroll {`, `.conn {` (the line with `.conn.demo`/`.conn.live`), `aside h3 {`, `aside ul {` (the line also containing `aside li` / `.sub` / `code`). **Keep** the `.sub`/`code` parts by rewriting that line to `.sub { opacity:.65; font-size:12px; } code { font-size:12px; background:rgba(0,0,0,.06); padding:0 4px; border-radius:4px; }`.
- `#shed ul.agents`, `#shed ul.agents code`, `#shed .following`, `.chips {`/`button.chip`, `.why {`, `.feed li.new`.
- Inside `@media (max-width: 899px)`: the two `aside#shed` lines.
- `body.present aside#shed { … }`: remove only that rule; keep the rest of the present line.
- `body.hc aside#shed, ` → remove `aside#shed` from that selector list (keep `#keys, #status`).
- `body.no-badge #status, body.no-badge .conn.demo` → `body.no-badge #status`.

Keep `button.who, button.link`, `button.icon` and `.dot`. The plan view and other UI still use them.

- [ ] **Step 6: Update `main.ts` to the new shed API (selection is plain state for now; Task 5 connects the 3D side)**

```ts
// imports
import './ui/shed.css';
import type { Pick } from './pick.ts';
import { inspect } from './ui/inspect.ts';
import { repoName } from './boundary.ts'; // Task 6 creates this. Until then use: const repoName = () => (q.get('repo') ?? liveDb().replace(/^sprout-/, '')) || 'our garden';
```

Add the state and a setter next to `setCollapsed`:

```ts
let selected: Pick | null = null;
function setSelected(p: Pick | null) {
  if (p?.kind === 'shed') { setCollapsed(!collapsed); return; }
  selected = p;
  world.setSelected(p); // Task 5 adds this; until then leave this line out
  if (p && collapsed) setCollapsed(false); else refresh();
}
```

Replace the `initShed` call:

```ts
initShed(shed, {
  onFocus: (kind, key) => { if (planOn) setPlan(false); world.focus(kind, key); refresh(); },
  onSelect: (p) => { if (planOn) setPlan(false); setSelected(p); },
  onToggle: () => setCollapsed(!collapsed),
});
```

In `refresh()`, replace the `renderShed` call:

```ts
const repo = repoName(q, s, liveDb());
if (selected && !inspect(selected, s, { repo })) selected = null; // the subject left the garden
renderShed(shed, s, { source, connection, collapsed, following: world.follow, selected, repo });
```

In the keydown handler, add as the first Escape case (before the help/guide Escape lines):

```ts
if (k === 'escape' && selected && helpEl.hidden && guideEl.hidden) { setSelected(null); return; }
```

- [ ] **Step 7: Run tests, typecheck, build**

Run: `cd garden && npm test && npm run build`
Expected: all pass. The build succeeds.

- [ ] **Step 8: Look at it**

```bash
node $SCRATCH/shoot.mjs "http://localhost:5199/?source=fake&step=14&paused=1" $SCRATCH/t4-team.png
node $SCRATCH/shoot.mjs "http://localhost:5199/?source=fake&step=10&paused=1" $SCRATCH/t4-attn.png "document.querySelector('[data-tab=activity]').click()"
```

Read both PNGs. Check: the attention strip is on top (step 10 has bugs/failing tests), the team cards have colour stripes, the activity tab has icons and times, and nothing overflows horizontally. Fix anything that looks wrong before committing.

- [ ] **Step 9: Commit**

```bash
cd /Users/trishathakkar/Projects/mhacks && git add garden/src/ui/shed.ts garden/src/ui/shed.css garden/src/ui/shed.test.ts garden/index.html garden/src/main.ts && git commit -m "garden: shed redesign: needs-attention strip (or 'All quiet'), Team cards (status pill, badges, folded helpers/offline), Activity tab (open-now group, grouped feed with icons and times), inspector view with back/Esc" && git pull --rebase && git push
```

---

## Task 5: Hover + click in the 3D world

**Files:**
- Modify: `garden/src/scene/world.ts` (pointer handling, selection ring, tooltip, `setSelected`, `onSelect`, `pickPos`)
- Modify: `garden/src/scene/actors.ts` (add `botanistPos()`, `forEachPerson(cb)`)
- Modify: `garden/src/scene/pond.ts` (add `spot`, `padSpots()`)
- Modify: `garden/src/main.ts` (wire `world.onSelect` → `setSelected`; uncomment `world.setSelected`)
- Modify: `garden/index.html` (tooltip CSS; guide line "Click anything to inspect it")

**Interfaces:**
- Consumes: `pickAt`, `isClick`, `samePick`, `type Pick`, `type PickScene` (Task 1); `hoverText` (Task 2).
- Produces: `GardenWorld.onSelect: (p: Pick | null) => void`, `GardenWorld.setSelected(p: Pick | null)`, `GardenWorld.pickPos(p): THREE.Vector3 | undefined`, `Actors.botanistPos()`, `Actors.forEachPerson(cb: (pick: Pick, pos: THREE.Vector3) => void)`, `Pond.spot: { x; z; r }`, `Pond.padSpots(): Array<{ id; x; z; size }>`.

- [ ] **Step 1: Actors and Pond accessors**

In `actors.ts`, next to `gardenerPos`:

```ts
  botanistPos(): THREE.Vector3 { return this.botanist.obj.position; }
  /** Every clickable character: gardeners by handle, then the botanist. */
  forEachPerson(cb: (pick: Pick, pos: THREE.Vector3) => void) {
    for (const [handle, g] of this.gardeners) cb({ kind: 'member', key: handle }, g.obj.position);
    cb({ kind: 'botanist' }, this.botanist.obj.position);
  }
```

Add `import type { Pick } from '../pick.ts';` at the top.

In `pond.ts`, add (the group is positioned at the pond centre in `place`, and the pads are stored relative to it):

```ts
  get spot() { return { x: this.group.position.x, z: this.group.position.z, r: this.r }; }
  /** Pads in world coordinates, for picking. */
  padSpots(): Array<{ id: number; x: number; z: number; size: number }> {
    const ox = this.group.position.x, oz = this.group.position.z, out = [];
    for (const [id, p] of this.pads) out.push({ id, x: ox + p.x, z: oz + p.z, size: p.size });
    return out;
  }
```

- [ ] **Step 2: World: replace the pointer block in the constructor**

Replace the whole `if (gl) { let down … pointerleave … }` block (the one that starts `// A click (not a drag) on the 3D shed toggles the shed panel.`) with:

```ts
    // Hover shows a one-line tooltip and a soft ring; a click (not a drag) selects. Hover is resolved once per frame.
    if (gl) {
      gl.domElement.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY }; });
      gl.domElement.addEventListener('pointerup', (e) => {
        const click = isClick(this.down, { x: e.clientX, y: e.clientY }); this.down = undefined;
        if (!click) return;
        const p = this.pickUnder(e.clientX, e.clientY);
        if (p?.kind === 'shed') { this.props.shedClicked(); return; }
        this.onSelect(p);
      });
      gl.domElement.addEventListener('pointermove', (e) => { this.hoverAt = { x: e.clientX, y: e.clientY }; });
      gl.domElement.addEventListener('pointerleave', () => { this.hoverAt = undefined; this.setHover(null, 0, 0); });
    }
```

Add these fields to the class:

```ts
  private down: { x: number; y: number } | undefined;
  private hoverAt: { x: number; y: number } | undefined;
  private hovered: Pick | null = null;
  selected: Pick | null = null;
  /** A click in the garden picked something (or empty ground: null). */
  onSelect: (p: Pick | null) => void = () => {};
  private ray = new THREE.Raycaster(); private ndc = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3); // plant mid-height
  private hit = new THREE.Vector3();
  private selRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.2, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  private hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.08, 48), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, depthWrite: false }));
```

In the constructor, after `this.spotRing` is added:

```ts
    for (const r of [this.selRing, this.hoverRing]) { r.rotation.x = -Math.PI / 2; r.visible = false; this.scene.add(r); }
    this.hoverEl.className = 'tip'; this.hoverEl.setAttribute('aria-hidden', 'true');
```

Add these methods (after `focus`):

```ts
  /** Everything clickable, in pick order. Characters are projected to screen circles; the rest is on the ground. */
  private pickUnder(cx: number, cy: number): Pick | null {
    if (!this.snap || document.body.classList.contains('plan-open')) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const people: PickScene['people'] = [];
    this.actors.forEachPerson((pick, pos) => {
      const v = this.tmpV.copy(pos).setY(pos.y + 0.8).project(this.camera);
      if (v.z > 1) return;
      const depth = this.camera.position.distanceTo(pos);
      people.push({ pick, sx: r.left + ((v.x + 1) / 2) * r.width, sy: r.top + ((1 - v.y) / 2) * r.height, r: Math.max(14, 900 / depth), depth });
    });
    const g = this.ray.ray.intersectPlane(this.groundPlane, this.hit);
    return pickAt({
      screen: { x: cx, y: cy }, ground: g ? { x: g.x, z: g.z } : null,
      task: this.tasks.pick(this.ray), shed: this.props.hitShed(this.ray), arch: this.boundary?.hit(this.ray) ?? false,
    }, {
      people,
      plants: this.layout.plants.map((p) => ({ path: p.path, x: p.x, z: p.z, size: this.field.get(p.path)?.full === false ? 0.6 : p.size })),
      commits: this.pond.padSpots(), pond: this.pond.spot,
      beds: this.layout.beds.map((b) => ({ name: b.name, x: b.x, z: b.z, w: b.w, d: b.d })),
    });
  }

  private setHover(p: Pick | null, cx: number, cy: number) {
    this.hovered = p;
    const text = p && this.snap ? hoverText(p, this.snap) : null;
    if (!p || !text) { this.hoverEl.hidden = true; this.hoverRing.visible = false; this.renderer.domElement.style.cursor = ''; return; }
    this.renderer.domElement.style.cursor = 'pointer';
    if (p.kind === 'task') { // tasks keep their full card on hover
      const m = taskModels(this.snap).find((x) => x.id === p.key);
      if (m) { this.hoverEl.className = ''; this.hoverEl.innerHTML = taskCardHtml(m, this.snap.at); (this.hoverEl.firstElementChild as HTMLElement).classList.add('hover'); }
    } else { this.hoverEl.className = 'tip'; this.hoverEl.textContent = text; }
    this.hoverEl.hidden = false;
    const el = (this.hoverEl.firstElementChild as HTMLElement | null) ?? this.hoverEl;
    const target = this.hoverEl.className === 'tip' ? this.hoverEl : el;
    target.style.left = `${Math.min(innerWidth - 300, cx + 16)}px`; target.style.top = `${Math.max(8, cy - 34)}px`;
    const at = this.pickPos(p);
    this.hoverRing.visible = !!at && !samePick(p, this.selected);
    if (at) { this.hoverRing.position.set(at.x, 0.33, at.z); this.hoverRing.scale.setScalar(this.ringSize(p)); }
  }

  private ringSize(p: Pick) {
    if (p.kind === 'plant') return Math.max(0.6, (this.layout.plants.find((x) => x.path === p.key)?.size ?? 1) * 0.65);
    if (p.kind === 'bed') { const b = this.layout.beds.find((x) => x.name === p.key); return b ? Math.max(b.w, b.d) * 0.6 : 2; }
    if (p.kind === 'pond') return this.pond.spot.r * 1.15;
    return 0.8;
  }

  /** Where a pick is in the world (for rings and the camera). */
  pickPos(p: Pick): THREE.Vector3 | undefined {
    switch (p.kind) {
      case 'plant': return this.plantXZ.get(p.key);
      case 'bed': return this.bedCenter(p.key);
      case 'member': return this.actors.gardenerPos(p.key);
      case 'botanist': return this.actors.botanistPos();
      case 'task': return this.tasks.posOf(p.key);
      case 'pond': { const s = this.pond.spot; return new THREE.Vector3(s.x, 0, s.z); }
      case 'commit': { const c = this.pond.padSpots().find((x) => x.id === p.key); return c ? new THREE.Vector3(c.x, 0, c.z) : undefined; }
      case 'garden': return this.boundary?.archPos();
      case 'shed': return undefined;
    }
  }

  /** The shed inspector opened/closed something: ring it, glide the camera there, give a plant a little wiggle. */
  setSelected(p: Pick | null) {
    const changed = !samePick(p, this.selected) && !(p === null && this.selected === null);
    this.selected = p;
    if (!p || !changed) return;
    const at = this.pickPos(p);
    if (!at) return;
    this.follow = null; this.director = false;
    if (p.kind !== 'garden') this.rig.flyTo(at);
    if (p.kind === 'plant' && !this.calm && !this.reducedMotion) this.wobblePlant(p.key, 0.7);
  }
```

Note that `this.boundary` doesn't exist until Task 7. Until then, write `arch: false` and make `case 'garden'` return `undefined`. Task 7 swaps them in.

Add the imports:

```ts
import { isClick, pickAt, samePick, type Pick, type PickScene } from '../pick.ts';
import { hoverText } from '../ui/inspect.ts';
```

- [ ] **Step 3: World: per-frame hover + ring animation**

In `frame()`, right after `this.tickFences(t, mo);`:

```ts
    if (this.hoverAt) { const h = this.pickUnder(this.hoverAt.x, this.hoverAt.y); if (!samePick(h, this.hovered) || h) this.setHover(h, this.hoverAt.x, this.hoverAt.y); }
    const sp = this.selected ? this.pickPos(this.selected) : undefined, sm2 = this.selRing.material as THREE.MeshBasicMaterial;
    this.selRing.visible = !!sp;
    if (sp) { this.selRing.position.set(sp.x, 0.34, sp.z); this.selRing.scale.setScalar(this.ringSize(this.selected!) * (1 + Math.sin(t * 3) * 0.05 * mo)); sm2.opacity = 0.85; }
    (this.hoverRing.material as THREE.MeshBasicMaterial).opacity = 0.55;
```

(Moving characters keep their ring because `pickPos` reads the live position each frame.)

- [ ] **Step 4: main.ts wiring**

```ts
world.onSelect = (p) => setSelected(p);
```

Uncomment `world.setSelected(p);` inside `setSelected`. Make sure the old `world.onShedClick = () => setCollapsed(!collapsed);` is still there (the shed pick goes through `props.shedClicked()`).

- [ ] **Step 5: CSS + guide line in `index.html`**

Add to `<style>`:

```css
      .tip { position:fixed; z-index:6; pointer-events:none; background:var(--ink); color:#fff; font-size:12.5px; font-weight:600; padding:4px 10px; border-radius:8px; box-shadow:0 4px 14px rgba(0,0,0,.25); white-space:nowrap; } .tip[hidden] { display:none; }
      body.present .tip { font-size:16px; }
```

In the guide card, add an item to its first list: `<li><i>👆</i><span><b>Click anything</b> (a plant, bed, gardener, the botanist, the pond, the sign) to inspect it in the shed. Esc goes back.</span></li>`. Match the existing `<li>` markup in that card when you open the file. In the keys dialog `<dl>`, add `<dt>Click</dt><dd>inspect what's under the pointer (Esc: back)</dd>`.

- [ ] **Step 6: Verify by eye and by clicking**

```bash
cd garden && npm test && npm run build
node $SCRATCH/shoot.mjs "http://localhost:5199/?source=fake&step=14&paused=1&debug=1" $SCRATCH/t5-plant.png "" "440,430"
node $SCRATCH/shoot.mjs "http://localhost:5199/?bench=120&debug=1" $SCRATCH/t5-bed.png "" "300,350"
```

Read both PNGs. Expect the shed in inspector mode (← back + a plant or bed title) and a ring on the object. If the coordinates miss, pick coordinates from the earlier screenshot (the plant in the `src` bed and the `dir0` bed). Also check these by hand in a real browser (`npm run dev`):
- Hover shows the tooltip and pointer cursor.
- A drag-orbit ending on a plant does **not** select.
- Esc goes back.
- Clicking empty meadow clears the selection.
- With the shed collapsed (S), clicking a plant opens it.
- With the plan open (P), nothing is picked.
- Clicking the 3D shed still toggles the panel.

Run `__garden.bench(120)` on `?bench=1000&debug=1` while hovering. avgMs should stay within 10% of the baseline from Task 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/trishathakkar/Projects/mhacks && git add garden/src/scene/world.ts garden/src/scene/actors.ts garden/src/scene/pond.ts garden/src/main.ts garden/index.html && git commit -m "garden: hover anything for a tooltip + ring, click to inspect it in the shed (plants, hedges, beds, gardeners, botanist, task pots, pond, lily pads); camera glides there, plants wiggle; drag never selects" && git pull --rebase && git push
```

---

## Task 6: Pure garden boundary + repo name (`src/boundary.ts`)

**Files:**
- Create: `garden/src/boundary.ts`
- Test: `garden/src/boundary.test.ts`

**Interfaces:**
- Consumes: `GardenLayout`, `layoutPaths` (`layout.ts`); `pondSpot`, `BANK` (`pond.ts`).
- Produces: `interface Rect { minX; maxX; minZ; maxZ }`, `interface GardenFence { rect: Rect; gate: { x: number; z: number; w: number }; pickets: Array<{ x: number; z: number; ry: number }> }`, `gardenFence(l: GardenLayout, frontZ: number): GardenFence`, `repoName(q: URLSearchParams, s: GardenSnapshot, db: string): string`, `signLine(s: GardenSnapshot): string`, `inRect(r, x, z, margin = 0): boolean`, `const PICKET_STEP = 0.55`.

- [ ] **Step 1: Write the failing tests**

```ts
// garden/src/boundary.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GardenSnapshot } from '../../shared/types.ts';
import { layoutGarden, layoutPaths } from './layout.ts';
import { BANK, pondSpot } from './pond.ts';
import { gardenFence, inRect, repoName, signLine } from './boundary.ts';

const files = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `d${i % 5}/f${i}.ts`, bed: `d${i % 5}`, lines: 50 }));
const frontZ = (l: ReturnType<typeof layoutGarden>) => Math.max(4, l.depth / 2) + 3.6;

for (const n of [3, 40, 400]) {
  test(`fence (${n} files) encloses beds, paths, pond, shed and lane, with a gate on the front`, () => {
    const l = layoutGarden(files(n)), fz = frontZ(l), f = gardenFence(l, fz), halfW = Math.max(6, l.width / 2), halfD = Math.max(4, l.depth / 2);
    for (const b of l.beds) for (const [x, z] of [[b.x - b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z + b.d / 2]]) assert.ok(inRect(f.rect, x!, z!, 1), `bed ${b.name}`);
    for (const p of layoutPaths(l)) assert.ok(inRect(f.rect, p.x - p.w / 2, p.z, 0.5) && inRect(f.rect, p.x + p.w / 2, p.z, 0.5), 'path');
    const ps = pondSpot(l);
    assert.ok(inRect(f.rect, ps.x + ps.r * BANK, ps.z + ps.r * BANK, 0.5) && inRect(f.rect, ps.x - ps.r * BANK, ps.z - ps.r * BANK, 0.5), 'pond');
    assert.ok(inRect(f.rect, halfW - 1.5, -halfD - 6.5, 0.5), 'shed');
    assert.ok(inRect(f.rect, -(halfW + 3.5), fz, 1) && inRect(f.rect, halfW + 3.5, fz, 1), 'front lane');
    assert.equal(f.gate.z, f.rect.maxZ);
    assert.ok(f.pickets.length > 20);
    assert.ok(f.pickets.every((p) => !(Math.abs(p.z - f.rect.maxZ) < 0.01 && Math.abs(p.x - f.gate.x) < f.gate.w / 2)), 'no picket in the gate');
    assert.ok(f.pickets.every((p) => Math.abs(p.x - f.rect.minX) < 0.01 || Math.abs(p.x - f.rect.maxX) < 0.01 || Math.abs(p.z - f.rect.minZ) < 0.01 || Math.abs(p.z - f.rect.maxZ) < 0.01), 'pickets on the line');
  });
}

const snap = (o: Partial<GardenSnapshot> = {}): GardenSnapshot => ({ at: 0, members: [], agents: [], plants: [], claims: [], messages: [], testRuns: [], certifications: [], activity: [], ...o });

test('repo name: ?repo, then the latest test run repo, then the db name, then a default', () => {
  const run = (repo: string, at: number) => ({ id: at, handle: 'a', repo, command: '', exitCode: 0, at });
  assert.equal(repoName(new URLSearchParams('repo=Sprout'), snap(), 'sprout-mhacks'), 'Sprout');
  assert.equal(repoName(new URLSearchParams(), snap({ testRuns: [run('/Users/x/old', 1), run('/Users/x/Projects/mhacks/', 2)] }), 'sprout-demo'), 'mhacks');
  assert.equal(repoName(new URLSearchParams(), snap({ testRuns: [run('git@github.com:team/cool-app.git', 1)] }), ''), 'cool-app');
  assert.equal(repoName(new URLSearchParams(), snap(), 'sprout-mhacks'), 'mhacks');
  assert.equal(repoName(new URLSearchParams(), snap(), ''), 'our garden');
  assert.equal(repoName(new URLSearchParams(`repo=${'x'.repeat(60)}`), snap(), '').length, 28);
});

test('sign line counts people online, plants and blooms today', () => {
  const s = snap({ at: 10 * 86_400_000,
    members: [{ handle: 'a', color: '', online: true, paused: false, lastSeen: 0 }, { handle: 'b', color: '', online: false, paused: false, lastSeen: 0 }],
    plants: [{ path: 'a', bed: '', lines: 1, stage: 'bloom', bugs: 0, lastActivity: 0, lastBloomAt: 10 * 86_400_000 - 1000 }, { path: 'b', bed: '', lines: 1, stage: 'seed', bugs: 0, lastActivity: 0 }] });
  assert.equal(signLine(s), '1 gardener · 2 plants · 1 🌸 today');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd garden && npx tsx --test src/boundary.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// garden/src/boundary.ts
// Pure: the white picket fence around the whole garden (with a gate on the front lane) and the name on the arch.
import type { GardenSnapshot } from '../../shared/types.ts';
import { layoutPaths, type GardenLayout } from './layout.ts';
import { BANK, pondSpot } from './pond.ts';

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface GardenFence { rect: Rect; gate: { x: number; z: number; w: number }; pickets: Array<{ x: number; z: number; ry: number }> }

export const PICKET_STEP = 0.55;
const GATE_W = 3.6;
export const inRect = (r: Rect, x: number, z: number, margin = 0) => x >= r.minX + margin && x <= r.maxX - margin && z >= r.minZ + margin && z <= r.maxZ - margin;

/** Encloses beds, paths, the pond, the shed (behind the beds), the bench and well (front-left) and the gardeners' lane. */
export function gardenFence(l: GardenLayout, frontZ: number): GardenFence {
  const halfW = Math.max(6, l.width / 2), halfD = Math.max(4, l.depth / 2), ps = pondSpot(l), pr = ps.r * BANK;
  let minX = -halfW - 7, maxX = Math.max(halfW + 5.5, ps.x + pr + 1.5), minZ = Math.min(-halfD - 8, ps.z - pr - 1.5), maxZ = Math.max(frontZ + 3.2, ps.z + pr + 1.5);
  for (const p of layoutPaths(l)) { minX = Math.min(minX, p.x - p.w / 2 - 1.5); maxX = Math.max(maxX, p.x + p.w / 2 + 1.5); }
  const rect = { minX, maxX, minZ, maxZ }, gate = { x: 0, z: maxZ, w: GATE_W };
  const pickets: GardenFence['pickets'] = [];
  const side = (x0: number, z0: number, x1: number, z1: number, ry: number, front = false) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / PICKET_STEP));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      if (front && Math.abs(x - gate.x) < gate.w / 2) continue;
      pickets.push({ x, z, ry });
    }
  };
  side(minX, minZ, maxX, minZ, 0); side(minX, maxZ, maxX, maxZ, 0, true);
  side(minX, minZ, minX, maxZ, Math.PI / 2); side(maxX, minZ, maxX, maxZ, Math.PI / 2);
  return { rect, gate, pickets };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** The name painted on the arch: ?repo=, else the newest test run's repo folder, else the db name without "sprout-". */
export function repoName(q: URLSearchParams, s: GardenSnapshot, db: string): string {
  const fromParam = q.get('repo')?.trim();
  if (fromParam) return clip(fromParam, 28);
  const run = [...s.testRuns].sort((a, b) => b.at - a.at).find((t) => t.repo.trim());
  if (run) {
    const last = run.repo.trim().replace(/\.git$/, '').split(/[/:\\]/).filter(Boolean).pop();
    if (last) return clip(last, 28);
  }
  const d = db.replace(/^sprout-/, '').trim();
  return d ? clip(d, 28) : 'our garden';
}

/** The smaller line under the name. */
export function signLine(s: GardenSnapshot): string {
  const online = s.members.filter((m) => m.online).length;
  const today = s.plants.filter((p) => p.stage === 'bloom' && p.lastBloomAt !== undefined && s.at - p.lastBloomAt < 86_400_000).length;
  return `${online} gardener${online === 1 ? '' : 's'} · ${s.plants.length} plant${s.plants.length === 1 ? '' : 's'} · ${today} 🌸 today`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd garden && npx tsx --test src/boundary.test.ts && npm test`
Expected: all pass. If the shed-corner or lane assertion fails for 3 files, widen the constants in `gardenFence` (not the test). The test encodes where `props.ts` actually puts the shed (`z = -halfD - 5.2`, depth 2.6) and the lane (`halfW*2+7` wide).

- [ ] **Step 5: Switch `main.ts` to the real `repoName` (if Task 4 used the stub) and commit**

```bash
cd /Users/trishathakkar/Projects/mhacks && git add garden/src/boundary.ts garden/src/boundary.test.ts garden/src/main.ts && git commit -m "garden: pure garden fence (encloses beds, paths, pond, shed, lane; gate on the front) and repo name for the arch (?repo, test run repo, db name)" && git pull --rebase && git push
```

---

## Task 7: Fence, arch and sign in 3D; mown grass inside, wild outside; painted bed signs

**Files:**
- Create: `garden/src/scene/boundary.ts`, `garden/src/scene/signTexture.ts`
- Modify: `garden/src/scene/world.ts` (own a `GardenBoundary`, rebuild it with the layout, `setSign` on update, bed sign planes, bed labels only with `L`, `arch` in picking)
- Modify: `garden/src/scene/props.ts` (`rebuild` takes `fence?: Rect`; lighter meadow inside; trees/rocks/tufts outside; a gate path; a tree ring framing the fence)
- Modify: `garden/src/main.ts` (pass the repo name to the world)
- Modify: `garden/index.html` (`.label.bed.off { display:none !important; }`)

**Interfaces:**
- Consumes: `gardenFence`, `signLine`, `type GardenFence`, `type Rect`, `inRect` (Task 6).
- Produces: `class GardenBoundary { constructor(scene: THREE.Scene); rebuild(f: GardenFence): void; setSign(name: string, line: string): void; hit(ray: THREE.Raycaster): boolean; archPos(): THREE.Vector3 }`, `paintSign(text: string, sub?: string, o?: { w?: number; h?: number }): THREE.CanvasTexture`, `GardenWorld.repo: string`.

- [ ] **Step 1: `signTexture.ts`**

```ts
// garden/src/scene/signTexture.ts
// A painted wooden board as a canvas texture (arch sign, bed signs). Text is clipped to fit; fillText never parses HTML.
import * as THREE from 'three';

export function paintSign(text: string, sub = '', o: { w?: number; h?: number } = {}): THREE.CanvasTexture {
  const w = o.w ?? 1024, h = o.h ?? 256, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const wood = g.createLinearGradient(0, 0, 0, h); wood.addColorStop(0, '#c99a62'); wood.addColorStop(1, '#a8743f');
  g.fillStyle = wood; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, h * 0.12); g.fill();
  g.strokeStyle = 'rgba(80,45,15,.18)'; g.lineWidth = 3;
  for (let y = h * 0.18; y < h; y += h * 0.22) { g.beginPath(); g.moveTo(16, y); g.bezierCurveTo(w * 0.3, y - 6, w * 0.7, y + 6, w - 16, y); g.stroke(); } // grain
  g.strokeStyle = '#6b4423'; g.lineWidth = h * 0.035; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, h * 0.12); g.stroke();
  const fit = (s: string, px: number, weight: number, maxW: number) => {
    let size = px; g.font = `${weight} ${size}px ui-rounded, "Avenir Next", system-ui, sans-serif`;
    while (g.measureText(s).width > maxW && size > 12) { size -= 2; g.font = `${weight} ${size}px ui-rounded, "Avenir Next", system-ui, sans-serif`; }
    return size;
  };
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const main = text.length > 32 ? `${text.slice(0, 31)}…` : text;
  fit(main, sub ? h * 0.42 : h * 0.55, 800, w * 0.88);
  g.fillStyle = 'rgba(60,30,8,.35)'; g.fillText(main, w / 2 + 3, (sub ? h * 0.4 : h / 2) + 4); // painted-in shadow
  g.fillStyle = '#fff8e6'; g.fillText(main, w / 2, sub ? h * 0.4 : h / 2);
  if (sub) { fit(sub, h * 0.17, 600, w * 0.85); g.fillStyle = '#ffeccc'; g.fillText(sub, w / 2, h * 0.76); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
```

- [ ] **Step 2: `scene/boundary.ts`**

```ts
// garden/src/scene/boundary.ts
// The white picket fence around the garden (one instanced mesh + merged rails) and the arch over the gate
// with the repo name painted on a hanging sign.
import * as THREE from 'three';
import type { GardenFence } from '../boundary.ts';
import { geo, mat, mergeByMaterial, mesh } from './materials.ts';
import { PALETTE } from './palette.ts';
import { paintSign } from './signTexture.ts';

const PICKET = new THREE.BoxGeometry(0.12, 0.8, 0.05).translate(0, 0.4, 0);
const PICKET_TIP = new THREE.ConeGeometry(0.085, 0.14, 4).rotateY(Math.PI / 4).translate(0, 0.87, 0);
const PICKET_GEO = (() => { const g = new THREE.BufferGeometry().copy(PICKET); return mergePicket(g); })();
function mergePicket(body: THREE.BufferGeometry) {
  // one geometry for body + pointed tip, so the whole fence is a single instanced draw
  const a = body.toNonIndexed(), b = PICKET_TIP.toNonIndexed();
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal'] as const) {
    const A = a.getAttribute(k).array as Float32Array, B = b.getAttribute(k).array as Float32Array, out = new Float32Array(A.length + B.length);
    out.set(A); out.set(B, A.length); g.setAttribute(k, new THREE.BufferAttribute(out, 3));
  }
  return g;
}

export class GardenBoundary {
  private group = new THREE.Group();
  private arch = new THREE.Group();
  private pickets?: THREE.InstancedMesh;
  private board?: THREE.Mesh;
  private signKey = '';
  private at = new THREE.Vector3();

  constructor(scene: THREE.Scene) { scene.add(this.group); }

  rebuild(f: GardenFence) {
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse((c) => { const m = c as THREE.Mesh; if (m.geometry && m.geometry !== PICKET_GEO && !Object.values(geo).includes(m.geometry as never)) m.geometry.dispose(); }); }
    this.arch = new THREE.Group(); this.board = undefined; this.signKey = '';
    const white = new THREE.MeshStandardMaterial({ color: '#f6f3ea', flatShading: true, roughness: 0.7 });
    const im = new THREE.InstancedMesh(PICKET_GEO, white, f.pickets.length), d = new THREE.Object3D();
    f.pickets.forEach((p, i) => { d.position.set(p.x, 0, p.z); d.rotation.set(0, p.ry, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.castShadow = true; im.receiveShadow = true; this.pickets = im; this.group.add(im);
    // two rails per side (merged), broken at the gate
    const rails = new THREE.Group(), r = f.rect, gx0 = f.gate.x - f.gate.w / 2, gx1 = f.gate.x + f.gate.w / 2;
    const rail = (x0: number, z0: number, x1: number, z1: number) => {
      for (const y of [0.28, 0.62]) { const m = mesh(geo.box, white, 0.06, 0.07, Math.hypot(x1 - x0, z1 - z0), (x0 + x1) / 2, y, (z0 + z1) / 2); m.rotation.y = Math.atan2(x1 - x0, z1 - z0); m.castShadow = true; rails.add(m); }
    };
    rail(r.minX, r.minZ, r.maxX, r.minZ); rail(r.minX, r.minZ, r.minX, r.maxZ); rail(r.maxX, r.minZ, r.maxX, r.maxZ);
    rail(r.minX, r.maxZ, gx0, r.maxZ); rail(gx1, r.maxZ, r.maxX, r.maxZ);
    mergeByMaterial(rails); this.group.add(rails);
    // the arch: two posts, a curved beam of short segments, a hanging board
    const wood = mat(PALETTE.woodDark), H = 3.4, half = f.gate.w / 2 + 0.25;
    for (const sx of [-1, 1]) {
      const post = mesh(geo.box, wood, 0.32, H, 0.32, f.gate.x + sx * half, H / 2, f.gate.z); post.castShadow = true; this.arch.add(post);
      const cap = mesh(geo.box, mat(PALETTE.woodLight), 0.42, 0.12, 0.42, f.gate.x + sx * half, H + 0.06, f.gate.z); this.arch.add(cap);
    }
    for (let i = 0; i < 9; i++) {
      const a0 = (i / 9) * Math.PI, a1 = ((i + 1) / 9) * Math.PI;
      const x0 = f.gate.x - Math.cos(a0) * half, x1 = f.gate.x - Math.cos(a1) * half, y0 = H + Math.sin(a0) * 0.55, y1 = H + Math.sin(a1) * 0.55;
      const seg = mesh(geo.box, wood, Math.hypot(x1 - x0, y1 - y0) + 0.04, 0.22, 0.26, (x0 + x1) / 2, (y0 + y1) / 2, f.gate.z); seg.rotation.z = Math.atan2(y1 - y0, x1 - x0); seg.castShadow = true; this.arch.add(seg);
    }
    for (const sx of [-1, 1]) this.arch.add(mesh(geo.cyl, mat('#5a4a3a'), 0.02, 0.5, 0.02, f.gate.x + sx * 1.5, H - 0.3, f.gate.z + 0.05)); // chains
    mergeByMaterial(this.arch);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 0.95), new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }));
    board.position.set(f.gate.x, H - 0.85, f.gate.z + 0.08); board.castShadow = true; board.userData.keep = true;
    this.board = board; this.arch.add(board); this.group.add(this.arch);
    this.at.set(f.gate.x, 0, f.gate.z);
  }

  /** Repaint the board only when its text changed. */
  setSign(name: string, line: string) {
    const key = `${name}\0${line}`;
    if (!this.board || key === this.signKey) return;
    this.signKey = key;
    const m = this.board.material as THREE.MeshStandardMaterial;
    m.map?.dispose(); m.map = paintSign(name, line); m.needsUpdate = true;
  }

  hit(ray: THREE.Raycaster): boolean { return ray.intersectObject(this.arch, true).length > 0; }
  archPos() { return this.at; }
}
```

Note: `mergeByMaterial` skips meshes with `userData.keep`, so the textured board survives the merge. Check `mergeByMaterial`'s rules (`materials.ts:49`) before relying on it. If `mergeByMaterial` drops the `uv` attribute only for merged meshes, the board is unaffected.

- [ ] **Step 3: World integration**

In `world.ts`:
- Fields: `private boundary!: GardenBoundary; repo = 'our garden'; private fenceRect?: Rect;`
- Constructor (after `this.props = …`): `this.boundary = new GardenBoundary(this.scene);`
- In `syncLayout`, inside `if (key !== this.layoutKey)`, before `this.props.rebuild(...)`:

```ts
      const fence = gardenFence(this.layout, hf.frontZ); this.fenceRect = fence.rect;
      this.boundary.rebuild(fence);
```

  and pass `fence.rect` as the new last argument of `this.props.rebuild(...)`.
- In `onUpdate` after `this.syncFences();`: `this.boundary.setSign(this.repo, signLine(u.snapshot));`
- In `pickUnder`: `arch: this.boundary.hit(this.ray)`. In `pickPos`: `case 'garden': return this.boundary.archPos();`
- `fitBox()`: include the arch: `maxZ = Math.max(maxZ, (this.fenceRect?.maxZ ?? maxZ) + 1)`. Keep the camera framing the beds as before. Check the screenshot. If the arch pushes the beds too small, drop this line and leave the sign visible by orbiting.
- Bed labels only with `L`: after `this.bedLabels.push(...)` in `syncLayout`, toggle the class: `el.classList.toggle('off', !this.showPlantLabels)`. In `setPlantLabels(on)` also run `for (const el of this.bedLabels) el.classList.toggle('off', !on);`. Leave the `generated` hedge labels and the pond label as they are.
- Painted bed signs: in `buildBed`, replace the small signboard with a bigger board plus a textured face:

```ts
    const sx0 = b.x - b.w / 2 + 1.2, sz0 = b.z + b.d / 2 + 0.35;
    g.add(sh(mesh(geo.box, mat(PALETTE.woodDark), 0.1, 0.9, 0.1, sx0 - 0.8, 0.45, sz0)), sh(mesh(geo.box, mat(PALETTE.woodDark), 0.1, 0.9, 0.1, sx0 + 0.8, 0.45, sz0)));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), new THREE.MeshStandardMaterial({ map: paintSign(b.greenhouse ? `${b.name} 🧪` : b.name, '', { w: 512, h: 128 }), roughness: 0.85 }));
    face.position.set(sx0, 0.78, sz0 + 0.06); face.rotation.x = -0.25; face.castShadow = true; face.userData.keep = true; this.signGroup.add(face);
    const sign = new THREE.Vector3(sx0, 0.78, sz0 + 0.1);
```

  Add `private signGroup = new THREE.Group();` and add it to the scene in the constructor. At the start of the `if (key !== this.layoutKey)` block, dispose and clear it: `for (const o of [...this.signGroup.children]) { const m = o as THREE.Mesh; (m.material as THREE.MeshStandardMaterial).map?.dispose(); (m.material as THREE.Material).dispose(); m.geometry.dispose(); } this.signGroup.clear();`. Use `this.signGroup.add(face)` rather than `g.add(face)`, because `bedGroup` is merged.
- Imports: `GardenBoundary`, `paintSign`, `gardenFence`, `signLine`, `type Rect`.

In `main.ts`, set `world.repo = repoName(q, s, liveDb());` inside `refresh()` (cheap; the sign only repaints on change).

- [ ] **Step 4: Props: mown inside, wild outside, a gate path, a framing tree ring**

In `props.ts`, change the signature to `rebuild(halfW, halfD, frontZ, paths = [], keepClear = [], fence?: Rect)`. Import `inRect, type Rect` from `../boundary.ts`, then:
- Meadow colour (in the vertex loop, after the existing `c.copy(inC)…`): `if (fence && inRect(fence, px, pz, -0.5)) c.offsetHSL(0.01, 0.04, 0.035);`. This gives a slightly lighter, fresher mown lawn inside.
- Gate path (after the front-lane `strip`): `if (fence) strip(0, (frontZ + 1.9 + fence.maxZ + 1.2) / 2, 3.0, fence.maxZ + 1.2 - (frontZ + 1.9));`
- A `wild(x, z, m)` helper: `!fence || !inRect(fence, x, z, -m)`, true when the point is at least `m` outside the fence.
  - Trees: `if (!clear(p.x, p.z, 2) || !wild(p.x, p.z, 2)) continue;`
  - Rocks: `if (!clear(...) || !wild(p.x, p.z, 1)) continue;`
  - Tufts: `if (!clear(p.x, p.z) || !wild(p.x, p.z, 0.6)) dm.matrix.makeScale(0, 0, 0);`
  - Wildflowers: `hide = !clear(p.x, p.z, 2) || !wild(p.x, p.z, 1.5)`.
- Framing trees just outside the fence (after the tree loop), skipping the area in front of the gate so the arch stays visible:

```ts
    if (fence) {
      const per = (fence.maxX - fence.minX) * 2 + (fence.maxZ - fence.minZ) * 2;
      for (let i = 0, n = Math.round(per / 5); i < n; i++) {
        let d = (i / n) * per + hash2(i, 41) * 2, x: number, z: number;
        const W = fence.maxX - fence.minX, D = fence.maxZ - fence.minZ, out = 3 + hash2(i, 42) * 4;
        if (d < W) { x = fence.minX + d; z = fence.minZ - out; } else if ((d -= W) < D) { x = fence.maxX + out; z = fence.minZ + d; }
        else if ((d -= D) < W) { x = fence.maxX - d; z = fence.maxZ + out; } else { d -= W; x = fence.minX - out; z = fence.maxZ - d; }
        if (z > fence.maxZ && Math.abs(x) < 9) continue; // keep the view of the arch clear
        if (!clear(x, z, 2)) continue;
        const s = 0.9 + hash2(i, 43) * 0.8, t = new THREE.Group();
        t.add(mesh(geo.cyl, mat(PALETTE.trunk), 0.28 * s, 1.5 * s, 0.28 * s, 0, 0.75 * s, 0));
        t.add(mesh(geo.cone, mat(PALETTE.leaf), 1.5 * s, 2.4 * s, 1.5 * s, 0, 2.3 * s, 0));
        t.add(mesh(geo.cone, mat(PALETTE.leafDark), 1.15 * s, 2.0 * s, 1.15 * s, 0, 3.4 * s, 0));
        t.position.set(x, 0, z); this.world.add(t);
      }
    }
```

- Move the bench/well only if the screenshot shows them on or outside the fence. With `minX = -halfW - 7`, they should sit inside.

- [ ] **Step 5: CSS** — in `index.html` `<style>`: `.label.bed.off { display:none !important; }`

- [ ] **Step 6: Verify**

```bash
cd garden && npm test && npm run build
for u in "?source=fake&step=14&paused=1" "?bench=120" "?bench=1000&debug=1"; do node $SCRATCH/shoot.mjs "http://localhost:5199/$u" "$SCRATCH/t7-$(echo $u | tr -dc a-z0-9).png"; done
```

Read the PNGs. Check:
- The fence fully encloses the garden.
- The arch faces the camera and the repo name reads "mhacks" with `?db=sprout-mhacks` or "demo" for fake.
- The pond, shed and bench sit inside.
- No trees are inside.
- Bed signs are readable at overview distance.
- The bench=1000 view isn't swamped.

Clicking the arch (coordinates from the screenshot) opens the "garden" inspector. Record `drawCalls` with `?bench=120&debug=1`. It should be about +6 over the baseline.

- [ ] **Step 7: Commit**

```bash
cd /Users/trishathakkar/Projects/mhacks && git add garden/src/scene/boundary.ts garden/src/scene/signTexture.ts garden/src/scene/world.ts garden/src/scene/props.ts garden/src/main.ts garden/index.html && git commit -m "garden: white picket fence around the garden with an arch and painted repo-name sign (live counts, click for the whole garden); mown lawn inside, trees and long grass outside; painted bed signs (HTML bed pills only with L)" && git pull --rebase && git push
```

---

## Task 8: Lighting, contact shadows, wind

**Files:**
- Create: `garden/src/scene/contactShadows.ts`, `garden/src/scene/sway.ts`
- Modify: `garden/src/scene/world.ts` (fit the shadow camera to the fence; light colours; contact shadows per frame; sway uniforms)
- Modify: `garden/src/scene/actors.ts` (`forEachBody(cb)`)
- Modify: `garden/src/scene/props.ts` (apply sway to tufts and wildflowers)

**Interfaces:**
- Produces: `class ContactShadows { constructor(scene: THREE.Scene, max?: number); begin(): void; add(x: number, z: number, r: number): void; end(): void; visible: boolean }`, `SWAY: { uTime: { value: number }; uSway: { value: number } }`, `addSway(m: THREE.Material): void`, `Actors.forEachBody(cb: (x: number, z: number, r: number) => void)`.

- [ ] **Step 1: `contactShadows.ts`**

```ts
// garden/src/scene/contactShadows.ts
// Soft dark blobs under characters and pots: one instanced quad with a radial-gradient texture (grounds things cheaply).
import * as THREE from 'three';

function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class ContactShadows {
  private im: THREE.InstancedMesh;
  private n = 0;
  private d = new THREE.Object3D();
  constructor(scene: THREE.Scene, private max = 96) {
    const m = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.7 });
    this.im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), m, max);
    this.im.frustumCulled = false; this.im.renderOrder = 1; this.im.count = 0; scene.add(this.im);
  }
  set visible(v: boolean) { this.im.visible = v; }
  begin() { this.n = 0; }
  add(x: number, z: number, r: number) {
    if (this.n >= this.max) return;
    this.d.position.set(x, 0.035, z); this.d.scale.set(r * 2, 1, r * 2); this.d.updateMatrix();
    this.im.setMatrixAt(this.n++, this.d.matrix);
  }
  end() { this.im.count = this.n; this.im.instanceMatrix.needsUpdate = true; }
}
```

- [ ] **Step 2: `sway.ts`**

```ts
// garden/src/scene/sway.ts
// A gentle wind on instanced grass and wildflowers: a vertex offset that grows with height. Shared uniforms; the
// world sets uTime each frame and uSway to 0 in calm mode / reduced motion.
import * as THREE from 'three';

export const SWAY = { uTime: { value: 0 }, uSway: { value: 1 } };

export function addSway(m: THREE.Material) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = SWAY.uTime; sh.uniforms.uSway = SWAY.uSway;
    sh.vertexShader = 'uniform float uTime;\nuniform float uSway;\n' + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      float hgt = max( 0.0, mvPosition.y );
      mvPosition.x += sin( uTime * 1.6 + mvPosition.x * 0.35 + mvPosition.z * 0.25 ) * 0.09 * hgt * uSway;
      mvPosition.z += cos( uTime * 1.2 + mvPosition.x * 0.3 ) * 0.05 * hgt * uSway;
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  m.customProgramCacheKey = () => 'sway';
}
```

Apply it in `props.ts`: after creating the tufts material and the wildflower material, call `addSway(thatMaterial)`. Plants already sway via their matrices in `PlantField`, so leave them alone.

- [ ] **Step 3: Actors `forEachBody`**

```ts
  /** Ground contact points for soft shadows: gardeners, bots and the botanist (not flying spirits/butterflies). */
  forEachBody(cb: (x: number, z: number, r: number) => void) {
    for (const g of this.gardeners.values()) cb(g.obj.position.x, g.obj.position.z, 0.55);
    for (const b of this.bots.values()) cb(b.obj.position.x, b.obj.position.z, 0.4);
    const p = this.botanist.obj.position; cb(p.x, p.z, 0.55);
  }
```

- [ ] **Step 4: World: lights, shadow fit, contact shadows, sway uniforms**

- Light colours: `sun = new THREE.DirectionalLight(0xffe2b0, 2.7)`; `hemi = new THREE.HemisphereLight(0xd4e9ff, 0x6b7a55, 1.2)`; `baseHemi = 1.2; baseSun = 2.7`. In `onUpdate`, scale the day values the same way: `this.baseHemi = night ? 1.0 : 1.2; this.baseSun = night ? 0.9 : hour > 17.5 ? 2.1 : 2.7;`.
- Add `this.scene.add(this.sun.target)` in the constructor.
- New method, called from `syncLayout` right after `this.boundary.rebuild(fence)`:

```ts
  /** Shadows only where the garden is: a tight shadow frustum around the fence gives crisper, cheaper shadows. */
  private fitShadow(r: Rect) {
    const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2, half = Math.max(r.maxX - r.minX, r.maxZ - r.minZ) / 2 + 3;
    this.sun.target.position.set(cx, 0, cz); this.sun.position.set(cx + 16, 21, cz + 13); // a little lower than before: longer shadows
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.near = 1; sc.far = 80 + half; sc.updateProjectionMatrix();
    this.sun.shadow.mapSize.setScalar(half > 40 ? 4096 : 2048); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null as never;
  }
```

  Remove the fixed `sc.left = sc.bottom = -35 …` line from the constructor (keep the bias lines).
- `private contact = new ContactShadows(this.scene);` and in the constructor `this.contact.visible = this.quality !== 'low';`.
- In `frame()`, after `this.actors.tick(dt)`:

```ts
    if (this.quality !== 'low') {
      this.contact.begin();
      this.actors.forEachBody((x, z, r) => this.contact.add(x, z, r));
      for (const tp of this.tasks.positions()) this.contact.add(tp.x, tp.z, 0.5);
      this.contact.end();
    }
    SWAY.uTime.value = t; SWAY.uSway.value = this.calm || this.reducedMotion ? 0 : 1;
```

  `TaskPlants.positions()` is a new tiny accessor in `taskPlants.ts`: `positions() { return [...this.items.values()].map((t) => t.g.position); }`. It allocates once per frame for a handful of items. That's fine, but if you'd rather avoid it, iterate with a callback `forEachPos(cb)` instead.

- [ ] **Step 5: Verify**

```bash
cd garden && npm test && npm run build
node $SCRATCH/shoot.mjs "http://localhost:5199/?source=fake&step=14&paused=1" $SCRATCH/t8-a.png
node $SCRATCH/shoot.mjs "http://localhost:5199/?bench=120&debug=1" $SCRATCH/t8-b.png "__garden.bench(120)"
```

Read the PNGs. Check:
- Shadows are crisper and longer.
- Characters have soft blobs under them.
- Nothing is shadow-acned (moire on the meadow means the bias needs a nudge: `normalBias 0.04`).
- The scene isn't darker overall than before. Compare against `now.png` from the brainstorm and adjust `toneMappingExposure` within 0.9 to 1.0 if needed.

avgMs is within 10% of the baseline.

- [ ] **Step 6: Commit**

```bash
cd /Users/trishathakkar/Projects/mhacks && git add garden/src/scene && git commit -m "garden: lighting pass: warmer lower sun with shadows fitted to the fence (crisper), cooler shade, soft contact shadows under gardeners/bots/botanist/task pots, wind in the grass and wildflowers (off in calm mode)" && git pull --rebase && git push
```

---

## Task 9: Post-processing (AO + gentle bloom) with fallback

**Files:**
- Create: `garden/src/scene/post.ts`
- Modify: `garden/src/scene/world.ts` (use `Post` in `frame()` and `resize()`)

**Interfaces:**
- Produces: `class Post { readonly ok: boolean; constructor(r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, o: { ao: boolean; bloom: boolean }); setSize(w: number, h: number): void; render(): void }`

- [ ] **Step 1: Implement**

```ts
// garden/src/scene/post.ts
// Optional post-processing: ambient occlusion (things sit in the ground) and a gentle bloom (only over-bright
// highlights: the botanist's light shaft, fireflies). Any failure falls back to a plain render, for good.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class Post {
  ok = false;
  private composer?: EffectComposer;
  private ao?: GTAOPass;
  constructor(private r: THREE.WebGLRenderer, private scene: THREE.Scene, private cam: THREE.PerspectiveCamera, o: { ao: boolean; bloom: boolean }) {
    try {
      const size = r.getSize(new THREE.Vector2());
      const c = new EffectComposer(r);
      c.addPass(new RenderPass(scene, cam));
      if (o.ao) {
        this.ao = new GTAOPass(scene, cam, size.x, size.y);
        this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1, samples: 12 });
        this.ao.blendIntensity = 0.85;
        c.addPass(this.ao);
      }
      if (o.bloom) c.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.5, 1.0));
      c.addPass(new OutputPass());
      this.composer = c; this.ok = true;
    } catch (e) { console.warn('post-processing unavailable, rendering plain:', e); }
  }
  setSize(w: number, h: number) { if (this.ok) { this.composer!.setPixelRatio(this.r.getPixelRatio()); this.composer!.setSize(w, h); } }
  render() {
    if (this.ok) { try { this.composer!.render(); return; } catch (e) { console.warn('post-processing failed, rendering plain from now on:', e); this.ok = false; } }
    this.r.render(this.scene, this.cam);
  }
}
```

Check the `updateGtaoMaterial` parameter names against `node_modules/three/examples/jsm/postprocessing/GTAOPass.js` (r170) before running. Remove any key it doesn't accept.

- [ ] **Step 2: World integration**

- Field: `private post?: Post;`
- Constructor, after the renderer is created and `this.resize()` has run: `if (gl && this.quality !== 'low') this.post = new Post(gl, this.scene, this.camera, { ao: q.get('ao') !== '0', bloom: q.get('bloom') !== '0' });`. Use `const q = new URLSearchParams(location.search)`.
- `resize()`: after `this.renderer.setSize(w, h)`, add `this.post?.setSize(w, h);`.
- `frame()`: replace `this.renderer.render(this.scene, this.camera)` with `(this.post ?? this.renderer).render(...)`. Concretely: `if (render && this.available) { if (this.post) this.post.render(); else this.renderer.render(this.scene, this.camera); }`.
- `benchFrames` already goes through `frame()`.

- [ ] **Step 3: Measure and decide**

```bash
cd garden && npm run build
for u in "?bench=120&debug=1" "?bench=120&debug=1&ao=0" "?bench=120&debug=1&quality=low"; do node $SCRATCH/shoot.mjs "http://localhost:5199/$u" "$SCRATCH/t9-$(echo $u | tr -dc a-z0-9).png" "__garden.bench(120)"; done
```

Compare avgMs. **If AO adds more than 2 ms per frame** over `ao=0`, change the default to AO off unless `?ao=1` or `present=1`. The projector machine is the one that matters. Note the numbers in the commit message. Read the PNGs: AO should darken creases (bed borders, under pots) without a dirty halo. If there's a halo, lower `radius` to 0.4 or `blendIntensity` to 0.6. Swiftshader timings are slow in absolute terms; compare ratios only. Also check the production bundle: `ls -la dist/assets/*.js | sort -k5 -n | tail -3` and `gzip -c dist/assets/three-*.js | wc -c`. Expect +40 to 60 KB gzip at most.

- [ ] **Step 4: Commit**

```bash
cd /Users/trishathakkar/Projects/mhacks && git add garden/src/scene/post.ts garden/src/scene/world.ts && git commit -m "garden: post-processing: ambient occlusion grounds beds/pots/characters, gentle bloom on over-bright highlights; ?ao=0 / ?bloom=0 / ?quality=low turn it off; falls back to a plain render on any error (bench: <numbers>)" && git pull --rebase && git push
```

---

## Task 10: Polish: one top bar, idle orbit in present mode

**Files:**
- Modify: `garden/index.html` (wrap `#keys` and `#banner` in `#topbar`; CSS)
- Modify: `garden/src/main.ts` (idle orbit)

- [ ] **Step 1: Top bar markup + CSS**

In `index.html` body, replace the separate `<div id="keys" …>…</div>` and `<div id="banner" role="status" hidden></div>` with:

```html
    <div id="topbar"><div id="keys" aria-label="Keyboard shortcuts">…unchanged contents…</div><div id="banner" role="status" hidden></div></div>
```

CSS: change the `#keys {` rule to drop `position:fixed; left:12px; top:12px;`. Change the `#banner {` rule to drop `position:fixed; top:64px; left:50%; transform:translateX(-50%); z-index:9;`. Add:

```css
      #topbar { position:fixed; left:12px; top:12px; z-index:9; display:flex; gap:8px; align-items:center; flex-wrap:wrap; max-width:calc(100vw - 370px); }
      #topbar #banner { padding:4px 12px; } body.hide-ui #topbar { display:none; }
      @media (max-width: 899px) { #topbar { max-width:calc(100vw - 24px); } }
```

Make sure `body.present #keys { display:none; }` still hides the keys. In present mode the banner then sits alone at top-left.

- [ ] **Step 2: Idle auto-orbit (present mode only)**

In `main.ts`, after the `?present=1` block:

```ts
// Projector loop: after a minute with no input the camera slowly circles; any input stops it.
if (q.get('present') === '1') {
  let lastInput = performance.now();
  for (const ev of ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const) addEventListener(ev, () => { lastInput = performance.now(); world.controls.autoRotate = false; }, { passive: true });
  setInterval(() => {
    const idle = performance.now() - lastInput > 60_000 && !world.reducedMotion && !world.calm && !world.follow;
    world.controls.autoRotate = idle; world.controls.autoRotateSpeed = 0.35;
  }, 1000);
}
```

Check that `world.controls.update()` runs every frame (it does in `frame()`), so autoRotate takes effect.

- [ ] **Step 3: Verify**

```bash
cd garden && npm test && npm run build
node $SCRATCH/shoot.mjs "http://localhost:5199/?bench=120" $SCRATCH/t10.png
node $SCRATCH/shoot.mjs "http://localhost:5199/?source=fake&present=1" $SCRATCH/t10p.png
```

Read the PNGs. Check: one slim bar at top-left (keys plus "Showing demo data · Retry live"), nothing overlapping the shed. In a real browser, confirm present mode starts circling after 60 seconds idle and stops on any key.

- [ ] **Step 4: Commit**

```bash
cd /Users/trishathakkar/Projects/mhacks && git add garden/index.html garden/src/main.ts && git commit -m "garden: one slim top bar (keys + connection banner); present mode slowly circles the garden after a minute idle" && git pull --rebase && git push
```

---

## Task 11: Final verification, docs, status

**Files:**
- Modify: `garden/README.md` (new interactions, `?repo=`, `?ao=0`, `?bloom=0`)
- Modify: `status/P4.md` (milestone line)
- Optionally refresh: `garden/screenshots/*.jpg` (only if they're used for Devpost; regenerate with the `shot=` URLs)

- [ ] **Step 1: Full gates**

Run: `cd garden && npm test && npm run build`
Expected: everything passes (106 baseline plus the new tests). Report the exact count.

- [ ] **Step 2: Screenshot tour (read every one)**

```bash
for u in "?source=fake&step=14&paused=1" "?source=fake&step=10&paused=1" "?bench=120" "?bench=1000&debug=1" "?source=fake&present=1" "?source=fake&quality=low" "?nogl=1"; do node $SCRATCH/shoot.mjs "http://localhost:5199/$u" "$SCRATCH/final-$(echo $u | tr -dc a-z0-9).png"; done
```

Also at a phone size: add a `--viewport` variant to `shoot.mjs` (375×812) for `?source=fake`. The shed must be a bottom sheet with no horizontal scroll.

- [ ] **Step 3: README + status**

Add to `garden/README.md` under the existing usage/keys section: click to inspect (Esc back), the hover tooltip, `?repo=<name>` for the arch sign, `?ao=0` / `?bloom=0` to turn effects off, and the present-mode idle orbit. Append to `status/P4.md` milestones:

```markdown
- [x] **Visual polish (Oct 4):** click anything to inspect it in the shed (pure `pick.ts`, `ui/inspect.ts`), shed redesign (attention strip, Team / Activity tabs, inspector), picket fence + repo-name arch (`boundary.ts`), contact shadows, fitted shadows, wind, AO + bloom (`scene/post.ts`, `?ao=0`), one top bar, present-mode idle orbit. Spec/plan: `docs/superpowers/{specs,plans}/2026-10-04-garden-visual-polish*`.
```

- [ ] **Step 4: Commit and push**

```bash
cd /Users/trishathakkar/Projects/mhacks && git add garden/README.md status/P4.md && git commit -m "garden: README + status for the visual polish pass" && git pull --rebase && git push
```
