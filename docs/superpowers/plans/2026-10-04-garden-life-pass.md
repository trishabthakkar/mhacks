# Garden Life Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every pickable thing give the same hover cues (plants and task pots too). Keep every teammate's Claude visible: awake when working, asleep when idle. Let idle gardeners roam the whole garden, light the garden at night, and make the task names the Claudes write read well.

**Architecture:** Each behaviour is a small pure, unit-tested function, so scene classes stay thin:

- `pickColumn` and the `plant` input in `pick.ts`
- `botFor` in `bots.ts`
- `roamSpot` in `wander.ts`
- `lampSpots` / `lampLevel` in `lamps.ts`
- `tidy` / `clipWords` in `ui/fmt.ts`
- `tidyTitle` in `mcp/src/tidy.ts`

The scene classes (`world.ts`, `actors.ts`, `plantField.ts`, and the new `scene/lamps.ts`) wire these in.

**Tech Stack:** TypeScript ESM, Node 22, three r170, Vite 6, node:test through tsx.

**Spec:** `docs/superpowers/specs/2026-10-04-garden-life-pass-design.md`

## Global Constraints

- Edit only `garden/**` (except `garden/src/module_bindings`), `mcp/src/tools.ts`, the new `mcp/src/tidy.ts` and `mcp/src/tidy.test.ts`, the existing `mcp/src/tools.test.ts`, `status/P4.md` and docs. Never `shared/`, `CONTRACT.md` or companion.
- Gates per task: `cd garden && npm test` (runs tsc and the tests) and `npm run build`. For MCP tasks, also `cd mcp && npm test`.
- Commits: `git pull --rebase` before every push. No Co-Authored-By trailer. Each task is its own commit and leaves the demo working.
- Calm mode or reduced motion (`mo < 0.5`): no breathing or rising z's, no roaming.
- At most 4 real `PointLight`s; at `quality=low`, none.
- Lamps fade on from 18.5→20 and off from 5.5→6.5. `?hour=` overrides the clock.
- MCP `tidyTitle` never rejects; the length, secret and empty checks run on the tidied text.

## Review Focus

1. A member with several Claude sessions, one working and older ones dormant: exactly one bot, which is awake. Covered by the `botFor` test "working beats dormant and newer idle".
2. A plant behind a taller plant along the ray: the front one is picked, not the one whose base is nearest the ground point. Covered by the `pickColumn` "nearest along the ray" test.
3. A subagent whose parent session isn't the chosen bot's session: the spirit still flies home to its member's bot, not off into nothing. Covered by `botHandleOf` returning the handle for any of that member's sessions.
4. A task title made only of quotes or whitespace (`"  "`): after tidying it is empty and is rejected by the existing empty check, without crashing. Covered by a `tidyTitle` test and a `claim_files` test.
5. Night with a big garden (bench120): the lamp count stays bounded, and none sits in the gate gap. Covered by a `lampSpots` test on a large fence.

---

### Task 1: Uniform picking and highlighting (§1)

**Files:**
- Modify: `garden/src/pick.ts`, `garden/src/pick.test.ts`
- Modify: `garden/src/ui/inspect.ts` (task `hoverText`), `garden/src/ui/inspect.test.ts`
- Modify: `garden/src/scene/plantField.ts` (export `plantHeight`, add `setHighlight`), `garden/src/scene/plantField.test.ts`
- Modify: `garden/src/scene/world.ts` (`pickUnder`, `setHover`, `pickPos`, rings, highlight per frame)

**Interfaces:**
- Produces:
  - `pickColumn(o: V3, d: V3, cols: Column[]): string | undefined`, with `Column = {path, x, z, r, y0, y1}` and `V3 = {x, y, z}`
  - `PickInput.plant?: string`
  - `plantHeight(stage: PlantStage, size: number, full: boolean): number`
  - `PlantField.setHighlight(path: string | null, level: number): void`

- [ ] **Step 1: Failing tests**

`pick.test.ts`:

```ts
test('pickColumn: nearest column along the ray wins (a tall plant in front of a short one)', () => {
  const cols = [{ path: 'back', x: 0, z: -2, r: 0.4, y0: 0.2, y1: 0.8 }, { path: 'front', x: 0, z: 0, r: 0.4, y0: 0.2, y1: 2 }];
  // camera in front (z=+10), looking at the back plant's base: the ray passes through the tall front plant first
  const o = { x: 0, y: 3, z: 10 }, tgt = { x: 0, y: 0.5, z: -2 };
  const d = { x: tgt.x - o.x, y: tgt.y - o.y, z: tgt.z - o.z };
  assert.equal(pickColumn(o, d, cols), 'front');
});
test('pickColumn: a ray over bare soil picks nothing; one above the top misses', () => {
  const cols = [{ path: 'a', x: 0, z: 0, r: 0.4, y0: 0.2, y1: 1 }];
  assert.equal(pickColumn({ x: 3, y: 5, z: 3 }, { x: 0, y: -1, z: 0 }, cols), undefined);
  assert.equal(pickColumn({ x: -5, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, cols), undefined);
  assert.equal(pickColumn({ x: -5, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 }, cols), 'a');
});
test('pickAt: a plant column beats pond and bed, loses to people and task pots', () => {
  const sc = { people: [], plants: [], commits: [], beds: [{ name: 'src', x: 0, z: 0, w: 10, d: 10 }] };
  const base = { screen: { x: 0, y: 0 }, ground: { x: 0, z: 0 }, shed: false, arch: false };
  assert.deepEqual(pickAt({ ...base, plant: 'src/a.ts' }, sc), { kind: 'plant', key: 'src/a.ts' });
  assert.deepEqual(pickAt({ ...base, plant: 'src/a.ts', task: 3 }, sc), { kind: 'task', key: 3 });
  assert.deepEqual(pickAt(base, sc), { kind: 'bed', key: 'src' });
});
```

`inspect.test.ts`: the task hover text is one line with handle and progress. Use the file's existing snapshot helper and add a task with two items, one completed.

```ts
test('hoverText: a task pot is one line: title · handle · progress', () => {
  const s = snapWithTask(); // task id 1, handle trisha, title 'Add login form', items: 1 completed of 2
  assert.equal(hoverText({ kind: 'task', key: 1 }, s), 'Add login form · trisha · 1/2 done');
});
```

`plantField.test.ts`:

```ts
test('setHighlight brightens one plant and restores it when moved away', () => {
  const f = field();
  plant(f, 'a.ts', 'growing'); plant(f, 'b.ts', 'growing');
  const before = f.colorOf(f.get('a.ts')!.parts[1]!).getHex();
  f.setHighlight('a.ts', 0.4);
  assert.notEqual(f.colorOf(f.get('a.ts')!.parts[1]!).getHex(), before);
  f.setHighlight('b.ts', 0.4);
  assert.equal(f.colorOf(f.get('a.ts')!.parts[1]!).getHex(), before);
  f.setHighlight(null, 0);
});
test('plantHeight grows with stage and size', () => {
  assert.ok(plantHeight('bloom', 1, true) > plantHeight('sprout', 1, true));
  assert.ok(plantHeight('growing', 1.5, true) > plantHeight('growing', 1, true));
  assert.ok(plantHeight('seed', 1, false) >= 0.3);
});
```

- [ ] **Step 2: Run** `cd garden && npx tsx --test src/pick.test.ts src/ui/inspect.test.ts src/scene/plantField.test.ts`. Expected: FAIL (`pickColumn`, `setHighlight`, `plantHeight` not exported; the task hover text differs).

- [ ] **Step 3: Implement**

`pick.ts`: add `plant?: string` to `PickInput`. In `pickAt`, after the task check:

```ts
if (inp.plant !== undefined) return { kind: 'plant', key: inp.plant };
```

Keep the ground-distance plant search as a fallback only when `inp.plant === undefined && !inp.columns`. Simpler: the world always passes columns, so delete the plant search and the `plants` field of `PickScene`, and update the existing tests that used `plants` to pass `plant` instead. Then add:

```ts
export interface Column { path: string; x: number; z: number; r: number; y0: number; y1: number }
type V3 = { x: number; y: number; z: number };
/** The plant column the ray enters first (vertical cylinders). */
export function pickColumn(o: V3, d: V3, cols: Column[]): string | undefined {
  let best: string | undefined, bt = Infinity;
  const a = d.x * d.x + d.z * d.z;
  for (const c of cols) {
    const fx = o.x - c.x, fz = o.z - c.z;
    let t0: number, t1: number;
    if (a < 1e-9) { if (fx * fx + fz * fz > c.r * c.r) continue; t0 = -Infinity; t1 = Infinity; }
    else {
      const b = 2 * (fx * d.x + fz * d.z), cc = fx * fx + fz * fz - c.r * c.r, disc = b * b - 4 * a * cc;
      if (disc < 0) continue;
      const s = Math.sqrt(disc); t0 = (-b - s) / (2 * a); t1 = (-b + s) / (2 * a);
    }
    if (Math.abs(d.y) > 1e-9) { // clip to the y-slab
      let ya = (c.y0 - o.y) / d.y, yb = (c.y1 - o.y) / d.y; if (ya > yb) [ya, yb] = [yb, ya];
      t0 = Math.max(t0, ya); t1 = Math.min(t1, yb);
    } else if (o.y < c.y0 || o.y > c.y1) continue;
    if (t1 < Math.max(t0, 0)) continue;
    const t = Math.max(t0, 0);
    if (t < bt) { bt = t; best = c.path; }
  }
  return best;
}
```

`inspect.ts` task hover:

```ts
case 'task': {
  const t = (s.tasks ?? []).find((x) => x.id === p.key); if (!t) return null;
  const items = (s.taskItems ?? []).filter((i) => i.taskId === t.id);
  const tail = items.length ? `${items.filter((i) => i.state === 'completed').length}/${items.length} done` : t.status.replace(/_/g, ' ');
  return `${clip(t.title, 40)} · ${t.handle} · ${tail}`;
}
```

`plantField.ts`:

```ts
/** Rough height of a plant above its soil, for picking. */
export function plantHeight(stage: PlantStage, size: number, full: boolean): number {
  return full ? 0.3 + STEM_H[stage] * size * 1.1 : 0.35;
}
private hl: { path: string; key: string; saved: number[] } | null = null;
/** Brighten one plant's parts (hover/selection); the previous one gets its colours back. */
setHighlight(path: string | null, level: number) {
  const cur = this.hl;
  if (cur && (cur.path !== path || level === 0 || this.plants.get(cur.path)?.key !== cur.key)) {
    const inst = this.plants.get(cur.path);
    if (inst && inst.key === cur.key) inst.parts.forEach((p, i) => { this.meshes[p.mesh]!.setColorAt(p.slot, this.col.fromArray(cur.saved, i * 3)); this.dirtyColor[p.mesh] = true; });
    this.hl = null;
  }
  const inst = path ? this.plants.get(path) : undefined;
  if (!inst || level <= 0 || this.hl) return;
  const saved: number[] = [];
  inst.parts.forEach((p) => {
    const c = this.colorOf(p); saved.push(c.r, c.g, c.b);
    this.meshes[p.mesh]!.setColorAt(p.slot, c.lerp(C.white, level)); this.dirtyColor[p.mesh] = true;
  });
  this.hl = { path: inst.path, key: inst.key, saved };
}
```

Note: `this.hl` is set after restoring, so calling again with the same path and level is a no-op. A level change on the same path is ignored until the next move. Ruling: the selection is applied with level 0.5 when there is no hover over a different plant. The world calls `setHighlight(hoverPlant ?? selectedPlant, hoverPlant ? 0.35 : 0.5)` each frame. Changing the level on the same path re-applies by restoring first, so handle that: treat `level !== cur.level` as a change too (store `level` in `hl`).

`world.ts`:

- In `pickUnder`, build columns from `this.layout.plants`:

```ts
const cols = this.layout.plants.map((p) => {
  const f = this.field.get(p.path), stones = bedStyleOf(p.bed).kind === 'stones', y0 = stones ? 0.15 : 0.35;
  return { path: p.path, x: p.x, z: p.z, r: Math.max(0.45, p.size * 0.42), y0, y1: y0 + plantHeight(f?.stage ?? 'seed', p.size, f?.full !== false) };
});
const plant = pickColumn(this.ray.ray.origin, this.ray.ray.direction, cols);
```

  Pass `plant` in `PickInput` and drop `plants` from the scene.
- Rings: both get `material.depthTest = false` and `renderOrder = 10`. Plant rings sit at y 0.47.
- `setHover`: remove the task card branch; everything uses `.tip` with `textContent`. Remove the `taskModels` and `taskCardHtml` imports if they become unused.
- Each frame, in `frame()` next to the selRing update:

```ts
const hp = this.hovered?.kind === 'plant' ? this.hovered.key : null, sp2 = this.selected?.kind === 'plant' ? this.selected.key : null;
this.field.setHighlight(hp ?? sp2, hp ? 0.35 : 0.5);
```

- [ ] **Step 4: Run** the three test files. Expected: PASS. Then `cd garden && npm test && npm run build`. Expected: all pass, build OK.
- [ ] **Step 5: Visual check:** a headless screenshot with a synthetic hover is not practical. Instead, `__garden` in dev: open `?source=fake&step=14&paused=1` and hover a plant. A browser check is optional; the unit tests carry the logic.
- [ ] **Step 6: Commit** `garden: every plant picks by its real shape and glows on hover/selection; task pots hover like beds (one line + ring, full card in the inspector)`.

### Task 2: Bots always visible, asleep when idle (§2)

**Files:**
- Create: `garden/src/bots.ts`, `garden/src/bots.test.ts`
- Modify: `garden/src/scene/actors.ts`, `garden/src/ui/inspect.ts` (member hover mentions the bot), `garden/src/ui/inspect.test.ts`

**Interfaces:**
- Produces:
  - `botFor(s: GardenSnapshot, handle: string): { agent?: AgentView; asleep: boolean }`
  - `botHandleOf(s: GardenSnapshot, sessionId: string): string | undefined`
  - `botLine(s: GardenSnapshot, handle: string): string`, e.g. `"Claude asleep · last active 2h ago"`, `"Claude working on routes.ts"`, `"Claude asleep · no session yet"`
- Consumes: `memberStatus` from `ui/inspect.ts` (offline/paused).

- [ ] **Step 1: Failing tests** (`bots.test.ts`):

```ts
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { botFor, botHandleOf, botLine } from './bots.ts';
const ag = (o: Partial<AgentView>): AgentView => ({ sessionId: 's', handle: 'trisha', kind: 'claude', status: 'idle', currentAction: '', lastSeen: 0, ...o });
const snap = (agents: AgentView[], online = true) => ({ at: 10_000_000, members: [{ handle: 'trisha', color: '#f00', online, paused: false }], agents, plants: [], claims: [], messages: [], testRuns: [], certifications: [], activity: [] }) as unknown as GardenSnapshot;

test('working beats dormant and newer idle', () => {
  const s = snap([ag({ sessionId: 'a', status: 'dormant', lastSeen: 9 }), ag({ sessionId: 'b', status: 'working', lastSeen: 1 }), ag({ sessionId: 'c', status: 'idle', lastSeen: 8 })]);
  assert.deepEqual([botFor(s, 'trisha').agent?.sessionId, botFor(s, 'trisha').asleep], ['b', false]);
});
test('nothing awake: latest dormant, asleep', () => {
  const s = snap([ag({ sessionId: 'a', status: 'dormant', lastSeen: 1 }), ag({ sessionId: 'b', status: 'dormant', lastSeen: 5 })]);
  assert.deepEqual([botFor(s, 'trisha').agent?.sessionId, botFor(s, 'trisha').asleep], ['b', true]);
});
test('no agents: no session, asleep; idle is asleep; offline is asleep even if working', () => {
  assert.deepEqual(botFor(snap([]), 'trisha'), { agent: undefined, asleep: true });
  assert.equal(botFor(snap([ag({ status: 'idle' })]), 'trisha').asleep, true);
  assert.equal(botFor(snap([ag({ status: 'working' })], false), 'trisha').asleep, true);
});
test('subagents are ignored; any session maps to its handle', () => {
  const s = snap([ag({ sessionId: 'x', kind: 'subagent', status: 'working' }), ag({ sessionId: 'old', status: 'dormant' })]);
  assert.equal(botFor(s, 'trisha').agent?.sessionId, 'old');
  assert.equal(botHandleOf(s, 'old'), 'trisha'); assert.equal(botHandleOf(s, 'nope'), undefined);
});
test('botLine', () => {
  assert.equal(botLine(snap([]), 'trisha'), 'Claude asleep · no session yet');
  assert.equal(botLine(snap([ag({ status: 'dormant', lastSeen: 10_000_000 - 2 * 3_600_000 })]), 'trisha'), 'Claude asleep · last active 2h ago');
  assert.equal(botLine(snap([ag({ status: 'working', currentPath: 'src/api/routes.ts', lastSeen: 9_999_000 })]), 'trisha'), 'Claude working on routes.ts');
});
```

- [ ] **Step 2: Run** `npx tsx --test src/bots.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `bots.ts`:

```ts
// Pure: which of a member's Claude sessions the garden shows as their bot, and whether it is asleep.
import type { AgentView, GardenSnapshot } from '../../shared/types.ts';
import { memberStatus } from './ui/inspect.ts';
import { ago, base } from './ui/fmt.ts';
const RANK: Record<string, number> = { working: 5, waiting: 4, blocked: 3, needs_review: 2, idle: 1, dormant: 0 };
export function botFor(s: GardenSnapshot, handle: string): { agent?: AgentView; asleep: boolean } {
  let agent: AgentView | undefined;
  for (const a of s.agents) {
    if (a.handle !== handle || a.kind !== 'claude') continue;
    const r = RANK[a.status] ?? 0, br = agent ? RANK[agent.status] ?? 0 : -1;
    if (!agent || r > br || (r === br && a.lastSeen > agent.lastSeen)) agent = a;
  }
  const ms = memberStatus(s, handle);
  return { agent, asleep: !agent || agent.status === 'idle' || agent.status === 'dormant' || ms === 'offline' || ms === 'paused' };
}
export const botHandleOf = (s: GardenSnapshot, sessionId: string) => s.agents.find((a) => a.sessionId === sessionId)?.handle;
export function botLine(s: GardenSnapshot, handle: string): string {
  const { agent, asleep } = botFor(s, handle);
  if (!agent) return 'Claude asleep · no session yet';
  if (asleep) return `Claude asleep · last active ${ago(s.at - agent.lastSeen)}`;
  const st = agent.status === 'needs_review' ? 'waiting for review' : agent.status === 'waiting' ? 'waiting for you' : agent.status;
  return `Claude ${st}${agent.currentPath ? ` on ${base(agent.currentPath)}` : ''}`;
}
```

  (If `memberStatus` importing from `ui/inspect.ts` creates a cycle with `inspect.ts` importing `bots.ts`, move `memberStatus` into `bots.ts`… no: keep `memberStatus` where it is and have `inspect.ts` import `botLine` lazily. Ruling at execution: if tsx reports a cycle problem, inline the offline/paused check in `bots.ts`.)

  `inspect.ts` member hover becomes `` `${p.key} · ${memberStatus(s, p.key)} · ${botLine(s, p.key)}` `` (update the existing member hover test).

  `actors.ts`:
  - `bots` is keyed by **handle**, over all `snap.members` (online or not). Create with `makeBot`; each entry stores `agent?: AgentView`, `asleep: boolean`, plus `eyes: THREE.Mesh[]` and `zs: THREE.Sprite[]` (3 `iconMat('z')` sprites, scale 0.22, hidden).
  - `sync`: `for (const [h, b] of this.bots) { const f = botFor(snap, h); b.agent = f.agent; b.asleep = f.asleep; }`.
  - `makeBot` returns the two eye meshes as `rig.eyes`.
  - `agentPos(sessionId)`: `const h = botHandleOf(this.snap, sessionId); return (h ? this.bots.get(h)?.obj.position : undefined) ?? this.bees.get(sessionId)?.obj.position;`.
  - Spirit start and return: `this.bots.get(botHandleOf(this.snap, parent) ?? '')`.
  - Line 379 and line 530: `this.bots.get(handle)`.
  - `claudeAgent(handle)` returns `botFor(this.snap, handle).agent`. A dormant pick is fine: the gardener logic checks the status.
  - tick, for each bot: `a = b.agent`. If `b.asleep`: target `home(h) + OFF_BOT_HOME`; body y 0.18; `b.obj.rotation.x = 0.25` once stopped; eyes `scale.y = 0.25 * 0.03`; tip emissive 0; icon hidden. The z sprites (asleep and stopped) have phase `ph = (t / 2.5 + i / 3) % 1`, `position.set(0.15 + ph * 0.25, 0.75 + ph * 0.7, 0)` and `material.opacity = 1 - ph`. With `mo < 0.5`, use a static `ph = i / 3`. The z's share one material per bot? No: opacity must differ per sprite, so each z gets its own `SpriteMaterial` cloned from `iconMat('z')`; dispose them on removal. Breathing: `b.body.scale.y = 1 + 0.03 * Math.sin(t * 1.4) * mo`.
  - Otherwise, the existing awake behaviour with `a!`. Reset rotation.x, eyes and z's.
  - `forEachBody` is unchanged. `forEachPerson` also emits bots as `{kind:'member', key: handle}` after the gardeners, so a bot hover picks its member.
- [ ] **Step 4: Run** `cd garden && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Visual check:** screenshot `?source=fake&step=0&paused=1` (no sessions yet). Every member's bot is visible, sleeping by their home.
- [ ] **Step 6: Commit** `garden: every teammate's Claude is always in the garden: one bot per person, asleep (z z z, eyes shut) when idle, ended or offline, awake beside its gardener when working`.

### Task 3: Gardeners roam the whole garden (§3)

**Files:**
- Modify: `garden/src/scene/wander.ts`, `garden/src/scene/wander.test.ts`, `garden/src/scene/actors.ts` (`WorldLookup.roamSpots`), `garden/src/scene/world.ts`

**Interfaces:**
- Produces:
  - `roamSpot(t: number, seed: number, spots: Spot[]): Spot | undefined`, with `Spot = { x: number; z: number; fx: number; fz: number }` (`fx, fz` = the point to face)
  - `WorldLookup.roamSpots: Spot[]`

- [ ] **Step 1: Failing tests** (`wander.test.ts`):

```ts
const spots = Array.from({ length: 6 }, (_, i) => ({ x: i * 3, z: 0, fx: i * 3, fz: -1 }));
test('roamSpot: deterministic, never the same spot twice in a row, holds 6–12 s', () => {
  assert.deepEqual(roamSpot(42, 7, spots), roamSpot(42, 7, spots));
  let prev = roamSpot(0, 7, spots), changes = 0, lastChange = 0, minHold = Infinity, maxHold = 0;
  for (let t = 0.25; t < 600; t += 0.25) {
    const s = roamSpot(t, 7, spots);
    if (s !== prev) { assert.notDeepEqual(s, prev); if (changes) { minHold = Math.min(minHold, t - lastChange); maxHold = Math.max(maxHold, t - lastChange); } changes++; lastChange = t; prev = s; }
  }
  assert.ok(changes > 30 && minHold >= 5.75 && maxHold <= 12.25, `${changes} ${minHold} ${maxHold}`);
});
test('roamSpot: different seeds mostly stand at different spots; empty list gives undefined', () => {
  let same = 0; for (let t = 0; t < 300; t += 1) if (roamSpot(t, 1, spots) === roamSpot(t, 2, spots)) same++;
  assert.ok(same < 120, String(same));
  assert.equal(roamSpot(5, 1, []), undefined);
});
```

- [ ] **Step 2: Run** `npx tsx --test src/scene/wander.test.ts`. Expected: FAIL (no export).
- [ ] **Step 3: Implement**:

```ts
export interface Spot { x: number; z: number; fx: number; fz: number }
/** Where an idle gardener is visiting at time t: a walk between places in the garden, holding 6–12 s at each. */
export function roamSpot(t: number, seed: number, spots: Spot[]): Spot | undefined {
  const n = spots.length; if (!n) return undefined;
  // walk the schedule from a fixed origin: hold k lasts 6 + 6*hash(k, seed) seconds
  let k = 0, at = -seed * 3.1 % 12;
  while (true) { const hold = 6 + 6 * hash2(k, seed); if (at + hold > t) break; at += hold; k++; if (k > 100000) break; }
  // index: seed offset, then step 1..n-1 each hold so the next spot is never the same one
  let i = seed % n;
  for (let j = 1; j <= k; j++) i = (i + 1 + Math.floor(hash2(j, seed + 31) * Math.max(1, n - 1))) % n;
  return spots[i];
}
```

  Note: the loop is O(t/9) per call per gardener per frame; at t = 1 hour that's ~400 iterations × 4 gardeners, which is fine. Ruling: cache in Actors per handle (`{k, until, spot}`) to skip the loop when `t < until`. That's an optimisation only, implemented in actors.

  `world.ts`: `roamSpots: Spot[] = []`, rebuilt in `syncLayout` after the fence:
  - each bed: `{x: b.x, z: b.z + b.d/2 + 0.9, fx: b.x, fz: b.z}`
  - pond: the rim point toward the centre `(ps.x - dx*(ps.r+0.8), ...)`, facing the pond centre
  - the arch: `{x: gate.x, z: fence.rect.maxZ - 1.5, fx: gate.x, fz: fence.rect.maxZ}` (check `GardenFence.gate` fields; use its centre)
  - the shed: the door point from `props.shed.position` + (0, 0, 1.6), facing the shed

  Task pots are added in `onUpdate` via `this.tasks.forEachPos` (front +0.9) into a separate list; `get roamSpots()` returns both concatenated (cached array, rebuilt only on change).

  `actors.ts` gardener tick: replace the idle branch:

```ts
} else if (agent?.status !== 'waiting') {
  const r = mo >= 0.5 ? this.roam(h, t, seed) : undefined;
  if (r) { target = this.tgt.set(r.x, 0, r.z); if (!g.m.moving) roamLook = this.tgt2.set(r.fx, 0, r.fz); }
  else { const o = idleSpot(wt, seed); target = this.tgt.copy(this.home(h)).add(this.tgt2.set(o.x, 0, o.z)); }
}
```

  `roamLook` feeds the existing `look` chain (after the meet and waiting checks). `private roam(h, t, seed)` caches per handle and calls `roamSpot(t, seed, this.world.roamSpots)`.
- [ ] **Step 4: Run** `cd garden && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Visual check:** screenshot `?source=fake&step=3` after ~20 s of play (not paused). Idle gardeners are away from home lanes.
- [ ] **Step 6: Commit** `garden: idle gardeners wander the whole garden (each bed, the pond, task pots, the arch, the shed), pausing to look; calm mode keeps them home`.

### Task 4: Garden lights at night (§4)

**Files:**
- Create: `garden/src/lamps.ts`, `garden/src/lamps.test.ts`, `garden/src/scene/lamps.ts`
- Modify: `garden/src/scene/world.ts` (`?hour=`, build and update lamps), `garden/README.md` (`?hour=`)

**Interfaces:**
- Produces:
  - `Lamp = { x: number; z: number; kind: 'post' | 'arch' | 'path' | 'shed'; real: boolean }`
  - `lampSpots(fence: GardenFence, paths: Array<{x:number;z:number;w:number;d:number}>, shed: {x:number;z:number}): Lamp[]`
  - `lampLevel(hour: number): number`
  - `class GardenLamps { constructor(scene, quality); rebuild(lamps: Lamp[]); setLevel(l: number) }`

- [ ] **Step 1: Failing tests** (`lamps.test.ts`). Build fences with `gardenFence` from a `layoutGarden` of some plants, as `boundary.test.ts` does (copy its helper).

```ts
test('lampLevel: off by day, on at night, ramps at dusk and dawn', () => {
  assert.equal(lampLevel(12), 0); assert.equal(lampLevel(23), 1); assert.equal(lampLevel(2), 1);
  assert.ok(lampLevel(19.25) > 0.3 && lampLevel(19.25) < 0.7); assert.ok(lampLevel(6) > 0 && lampLevel(6) < 1); assert.equal(lampLevel(7), 0);
});
test('lampSpots: none in the gate gap, at most 4 real, arch pair and shed lamp present', () => {
  const f = fenceFor(40); // 40 plants
  const L = lampSpots(f, [{ x: 0, z: 0, w: 20, d: 1.2 }], { x: f.rect.maxX - 3, z: f.rect.minZ + 3 });
  const g = f.gate;
  assert.ok(!L.some((l) => l.kind === 'post' && Math.abs(l.z - f.rect.maxZ) < 0.3 && Math.abs(l.x - g.x) < g.w / 2 + 0.3));
  assert.ok(L.filter((l) => l.real).length <= 4);
  assert.equal(L.filter((l) => l.kind === 'arch').length, 2); assert.equal(L.filter((l) => l.kind === 'shed').length, 1);
  assert.ok(L.filter((l) => l.kind === 'path').length >= 4);
});
test('lampSpots: a big garden stays bounded', () => {
  const f = fenceFor(400);
  assert.ok(lampSpots(f, [], { x: 0, z: 0 }).length < 120);
});
```

  (Read `boundary.ts` for the exact `GardenFence.gate` shape first; adapt the field names in the test and implementation to it.)

- [ ] **Step 2: Run** `npx tsx --test src/lamps.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `lamps.ts`:
  - `lampLevel`: `smooth(18.5, 20, h)` for the evening and `1 - smooth(5.5, 6.5, h)` for the morning; return `h >= 12 ? eve : morn`.
  - `lampSpots`:
    - Walk the fence perimeter every 6 m (corners included) and skip points within `gate.w/2 + 0.3` of the gate centre on the front side.
    - Two arch lamps at `gate.x ± (gate.w/2 + 0.2)`, `rect.maxZ`.
    - Path lights: for each strip, along its long axis every 4 m, alternating ±(short/2 + 0.25), skipping points outside the rect.
    - The shed lamp at `shed + (0.9, 0, 1.3)`.
    - `real` = arch ×2, shed, and the post nearest `(rect.minX, rect.minZ)`.
    - Cap path lamps at 60 by widening the step if needed.

  `scene/lamps.ts`:
  - Two InstancedMeshes: a post (`geo.cyl`, wood dark, height 1.3 for post/arch/shed, 0.5 for path) and a bulb (`geo.sphere`, `MeshStandardMaterial({color:'#fff1c9', emissive:'#ffcf7a'})`).
  - Ground glow: one InstancedMesh of a plane with a radial canvas texture, additive, depthWrite false, at y 0.03, radius 1.6.
  - Up to 4 `PointLight('#ffcf7a', 0, 9, 2)` placed at the real lamps (none at quality low).
  - `setLevel(l)`: `group.visible = l > 0.01`; bulb `emissiveIntensity = 2.2 * l`; glow opacity `0.55 * l`; lights `intensity = 6 * l`.
  - `rebuild` disposes the old instance meshes and glow geometry.

  `world.ts`:
  - `const qh = Number(new URLSearchParams(location.search).get('hour'))`; `hourOverride = Number.isFinite(qh) && params.has('hour') ? qh : undefined` (clamped 0–24). Use `hour = this.hourOverride ?? (clock)` in `onUpdate`.
  - Build lamps in `syncLayout` after the fence (paths = `layoutPaths(this.layout)`, shed = `this.props.shed.position`).
  - `this.lamps.setLevel(lampLevel(hour))` in `onUpdate`.
- [ ] **Step 4: Run** `cd garden && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Visual and perf checks:**
  - Screenshots at `?source=fake&step=14&paused=1&hour=21` and `&hour=13`: lamps glow at night and are hidden by day.
  - `__garden.bench` at `?bench=120&hour=21` vs `&hour=13`: ≤ 1.5 ms difference, else reduce real lights to 2.
- [ ] **Step 6: Commit** `garden: lanterns along the fence, arch and paths and a lamp by the shed glow at night (fade in at dusk); ?hour= previews any time of day`.

### Task 5: Better writing (§5)

**Files:**
- Create: `mcp/src/tidy.ts`, `mcp/src/tidy.test.ts`
- Modify: `mcp/src/tools.ts` (descriptions; apply `tidyTitle`), `mcp/src/tools.test.ts`
- Modify: `garden/src/ui/fmt.ts` (+ `fmt.test.ts`, new), `garden/src/ui/taskCard.ts`, `garden/src/ui/plan.ts`, `garden/src/ui/inspect.ts`, `garden/src/scene/actors.ts` (gardener label), `garden/src/ui/sentences.ts` (bee → helper), `status/P4.md`

**Interfaces:**
- Produces:
  - `tidyTitle(s: string): string` (mcp)
  - `tidy(s: string): string` and `clipWords(s: string, n: number): string` (garden fmt)

- [ ] **Step 1: Failing tests**

`mcp/src/tidy.test.ts`, with the same cases mirrored in `garden/src/ui/fmt.test.ts` for `tidy`:

```ts
test('tidyTitle', () => {
  assert.equal(tidyTitle('  add   retry to upload client. '), 'Add retry to upload client');
  assert.equal(tidyTitle('"Fix login"'), 'Fix login');
  assert.equal(tidyTitle('`useAuth` hook cleanup'), 'useAuth hook cleanup');
  assert.equal(tidyTitle('src/api cleanup'), 'src/api cleanup');
  assert.equal(tidyTitle('why does it fail?'), 'Why does it fail?');
  assert.equal(tidyTitle('wait for it…'), 'Wait for it…');
  assert.equal(tidyTitle(' "  " '), '');
});
```

`garden fmt.test.ts`:

```ts
test('clipWords cuts at a word boundary with an ellipsis', () => {
  assert.equal(clipWords('Add retry to the upload client', 18), 'Add retry to the…');
  assert.equal(clipWords('short', 18), 'short');
  assert.equal(clipWords('Supercalifragilisticexpialidocious', 10), 'Supercali…');
});
```

`mcp tools.test.ts`:

```ts
test('claim_files: the task name is tidied before saving; blank after tidy is rejected', async () => {
  const { h, db } = setup();
  const r = await h.claim_files('trisha', { paths: ['src/x.ts'], task: '  add retry to upload client. ' });
  assert.match(r.text, /for "Add retry to upload client"/);
  assert.equal(db.tasks()[0]!.title, 'Add retry to upload client');
  const bad = await h.claim_files('trisha', { paths: ['src/y.ts'], task: ' "" ' });
  assert.equal(bad.isError, true);
});
test('set_checklist: items are tidied', async () => {
  const { h, db } = setup();
  await h.claim_files('trisha', { paths: ['src/x.ts'], task: 'T' });
  await h.set_checklist('trisha', { items: [{ text: 'write the tests.', state: 'pending' }] });
  assert.equal(db.taskItems(db.tasks()[0]!.id)[0]!.text, 'Write the tests');
});
```

- [ ] **Step 2: Run** `cd mcp && npm test` and `cd garden && npx tsx --test src/ui/fmt.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** (identical body in both files):

```ts
const CODEISH = /^[^\s]*([/._(]|[a-z][A-Z])/;
/** Tidy an agent-written title: one line, no wrapping quotes, no trailing period, a capital first letter unless it starts with code. */
export function tidyTitle(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) { const m = /^(["'`])(.*)\1$/.exec(t); if (!m) break; t = m[2]!.trim(); }
  t = t.replace(/^`([^`]+)`/, '$1');
  t = t.replace(/(?<!\.)\.$/, '').trim();
  if (t && !CODEISH.test(t)) t = t[0]!.toUpperCase() + t.slice(1);
  return t;
}
```

  Garden `fmt.ts`: `export const tidy = …` (the same body) and:

```ts
export function clipWords(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1), sp = cut.lastIndexOf(' ');
  return `${(sp >= n * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}
```

  MCP `tools.ts`:
  - `claim_files`: `const title = tidyTitle(task ?? '')`.
  - `set_checklist`: `text: tidyTitle(i.text ?? '').slice(0, MAX_TASK_TITLE)`.
  - Replace the descriptions:
    - `claim_files`: `'…and NAME THE TASK you are doing; it becomes the plant your teammates see. Write it like a good commit subject: start with a verb, sentence case, name the feature not the file, under 60 characters, no trailing period. Good: "Add retry to the upload client", "Fix login redirect loop". Bad: "working on src/api/upload.ts", "Fixing stuff."'` plus the existing fence sentences.
    - `task` describe: `` `What you are doing, like a commit subject (verb first, ≤60 chars), e.g. "Add retry to the upload client"` ``.
    - `set_checklist`: add `'Each item is one concrete step, verb first, under 50 characters, e.g. "Write tests for retry backoff".'`.

  Garden display:
  - `taskCard.ts`: titles go through `tidy`, items through `clipWords(tidy(text), 60)`, and `blockedReason` through `tidy`.
  - `plan.ts`: titles through `tidy`.
  - `inspect.ts` task hover: `clipWords(tidy(t.title), 40)`.
  - `actors.ts` gardener label: `clipWords(tidy(cur.title), 22)`.
  - `sentences.ts`: `a bee set off from X's bot` becomes `a helper set off from X's Claude`; `X's bee came back` becomes `X's helper finished`; `X's bot arrived in the garden` becomes `X's Claude woke up`; `X's bot went home` becomes `X's Claude went to sleep`; `X's bot hit a snag` becomes `X's Claude hit a snag`. Update `sentences.test.ts`.
  - `status/P4.md`: note for Manahil: "Trisha OK'd: tools.ts claim_files/set_checklist descriptions + tidyTitle (mcp/src/tidy.ts), tests in tools.test.ts".
- [ ] **Step 4: Run** `cd mcp && npm test`; `cd garden && npm test && npm run build`. Expected: all PASS.
- [ ] **Step 5: Commit** `mcp+garden: task names and checklist steps read like commit subjects (clearer tool guidance, tidied on save and on display, clipped at word boundaries); plainer activity sentences`.

### Task 6: Docs, status, final review

- [ ] `garden/README.md`: mention plant hover, sleeping bots, roaming, lamps and `?hour=`. Add a `status/P4.md` section "Life pass (Sun Oct 4)".
- [ ] Final whole-branch review (opus, code-reviewer); fix Critical and Important with RED→GREEN; commit; pull --rebase; push.
