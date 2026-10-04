# Task Garden Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Each teammate runs only the tasks assigned to them** (see "Who runs what").

**Goal:** Make tasks the main thing in the garden: agent-named task plants with live checklists and roadblocks, subagent spirits, a hover card, and a readable `P` board.

**Architecture:**
- **New data.** SpacetimeDB gets `task` and `taskItem` tables plus two reducers (`startTask`, `setTaskItems`). Existing reducers move a task's status automatically.
- **Sources.** The MCP server names tasks (`claim_files(paths, task)`) and edits checklists (`set_checklist`). The companion forwards Claude's own to-do list.
- **Display.** The garden builds one pure `TaskModel[]` from each snapshot (`garden/src/tasks.ts`). The board, the hover card, the 3D task plants and the spirits all render from it.

**Tech Stack:** TypeScript (Node 22, ESM), SpacetimeDB 2.10 TS module + generated client, MCP TS SDK v2, Three.js + Vite, node:test via tsx, `spacetimedb/scripts/smoke.sh` for the module.

**Spec:** `docs/superpowers/specs/2026-10-03-task-garden-design.md`

## Global Constraints

- Task titles and checklist items are short agent-written summaries. Never send prompt text. Titles ≤ 80 chars, items ≤ 80 chars, ≤ 20 items, ≤ 50 paths per task.
- Task statuses: exactly `active` / `blocked` / `needs_review` / `done`. Item states: exactly `pending` / `in_progress` / `completed`.
- A member's **current task** = their most recently updated task whose status isn't `done`.
- Untrusted-message wrapper text is unchanged (CONTRACT.md).
- **Never publish to `sprout-mhacks` or `sprout-demo` with `--delete-data`.** Adding tables and reducers is a non-breaking migration; publish normally.
- Each person edits only the files their task lists. Run `git pull --rebase` before every commit, and commit small. **No `Co-Authored-By` trailers** (team preference).
- Garden tests: `cd garden && npm test`. MCP: `cd mcp && npm test`. Companion: `cd companion && npm test`. Module: `bash spacetimedb/scripts/smoke.sh` (local `spacetime start` required).

## Review Focus

1. **Agent-written text reaches HTML** (task title, checklist item, blocked reason). Every renderer must escape it. A title like `<img src=x onerror=alert(1)>` must show as text on the projector. Tests: Task 6 (`taskCard.test.ts`, `board.test.ts`).
2. **Publishing the new module to the real database must keep all existing rows.** It must not wipe data or fail the migration. Check in Task 2, step 7.
3. **A member with no task, and a task whose owner was removed.** The board shows the member's column with "No task yet", and orphan tasks still render under an "Other" column without crashing. Test: Task 6 (`board.test.ts`).
4. **An older agent calls `claim_files` without `task`.** It gets a clear tool error naming the missing field, not a crash. Test: Task 3.
5. **A huge checklist or long title** (20 items, 80-char title). The card shows at most 8 items plus "+N more" and clips the title in signposts. Tests: Task 6 (`taskCard.test.ts`) and Task 7 (signpost clipping).

## Who runs what

| Person | Tasks | Starts when |
|---|---|---|
| **Seno (P1)** | 1, then 2 | now. **Push Task 1 first (~20 min): it unblocks everyone** |
| **Manahil (P2)** | 3, 6, then 9 | Task 3 and Task 6 as soon as Task 1 is pushed (both start on fake data) |
| **Shriya (P3)** | 4 | step 1 now; the rest after Task 2 regenerates bindings |
| **Trisha (P4)** | 5, 7, 8 | Task 5 after Task 1; Task 7's hover step after Task 6 pushes `taskCard.ts`; Task 8 after Task 7 |

Prompt each person pastes into their own Claude Code:
> Read `docs/superpowers/plans/2026-10-03-task-garden.md` and its spec. Use superpowers:executing-plans to implement **only Tasks <N, M>** (I am <P#>). Pull before each commit, never add Co-Authored-By, push after each task, and update `status/P#.md` when done.

Ruling: no end-to-end additions to `scripts/e2e.ts` in this plan. Coverage comes from smoke.sh (module rules), MCP live tests and the two-laptop rehearsal. If `e2e.sh` breaks because of the new tables, Trisha (integrator) fixes it.

---

### Task 1: Contract, shared types, constants, fake data (P1 · Seno)

**Files:**
- Modify: `shared/constants.ts` (append)
- Modify: `shared/types.ts` (add types and optional snapshot fields)
- Modify: `shared/fake-data.ts` (tasks in the fake story)
- Modify: `shared/fake-data.test.ts` (new test)
- Modify: `CONTRACT.md` (tables, reducers, activity kinds)

**Interfaces:**
- Produces: `TASK_STATUSES`, `TASK_ITEM_STATES`, `MAX_TASK_TITLE` (80), `MAX_TASK_ITEMS` (20), `MAX_TASK_PATHS` (50), activity kinds `task_started` and `task_done`. Types `TaskStatus`, `TaskItemState`, `TaskView`, `TaskItemView`, and `GardenSnapshot.tasks?: TaskView[]`, `GardenSnapshot.taskItems?: TaskItemView[]`.

- [ ] **Step 1: Write the failing test** (append to `shared/fake-data.test.ts`)

```ts
test('fake story has tasks: trisha refactors then blooms, alex is blocked then unblocked', () => {
  const snaps = makeFakeSnapshots(FAKE_STEPS + 1);
  const at = (step: number) => snaps[step]!;
  const trisha = (s: (typeof snaps)[number]) => s.tasks!.find((t) => t.handle === 'trisha')!;
  assert.equal(at(1).tasks!.length, 0);
  assert.equal(trisha(at(2)).title, 'Refactor the API routes');
  assert.equal(trisha(at(2)).status, 'active');
  assert.equal(at(2).taskItems!.filter((i) => i.taskId === trisha(at(2)).id).length, 3);
  const alex = at(6).tasks!.find((t) => t.handle === 'alex')!;
  assert.equal(alex.status, 'blocked');
  assert.match(alex.blockedReason!, /^fenced by trisha/);
  assert.equal(at(9).tasks!.find((t) => t.handle === 'alex')!.status, 'active');
  assert.match(trisha(at(11)).blockedReason!, /^Botanist refused/);
  assert.equal(trisha(at(FAKE_STEPS)).status, 'done');
  assert.equal(trisha(at(FAKE_STEPS)).blockedReason, undefined);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --experimental-strip-types --test shared/fake-data.test.ts`
Expected: FAIL (`Cannot read properties of undefined (reading 'length')`, since `tasks` doesn't exist yet).

- [ ] **Step 3: Constants** (append to `shared/constants.ts`, and add the two kinds to `ACTIVITY_KINDS` right after `'certify_refused'`)

```ts
export const TASK_STATUSES = ['active', 'blocked', 'needs_review', 'done'] as const;
export const TASK_ITEM_STATES = ['pending', 'in_progress', 'completed'] as const;
export const MAX_TASK_TITLE = 80;
export const MAX_TASK_ITEMS = 20;
export const MAX_TASK_PATHS = 50;
```

```ts
  'certify_bloom', 'certify_refused', 'task_started', 'task_done',
```

- [ ] **Step 4: Types** (`shared/types.ts`: extend the import, add types, add the two optional snapshot fields after `handoffs?`)

```ts
import type {
  ACTIVITY_KINDS, AGENT_STATUSES, HANDOFF_STATUSES, MESSAGE_KINDS, MESSAGE_STATUSES, PLANT_STAGES,
  TASK_ITEM_STATES, TASK_STATUSES,
} from './constants.ts';
```

```ts
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskItemState = (typeof TASK_ITEM_STATES)[number];

/** A task an agent named (claim_files) or started from its to-do list. Times in ms. */
export interface TaskView {
  id: number; handle: string; title: string; status: TaskStatus; bed: string; paths: string[];
  blockedReason?: string; createdAt: number; updatedAt: number; doneAt?: number;
}
export interface TaskItemView { id: number; taskId: number; ord: number; text: string; state: TaskItemState }
```

```ts
  /** Optional: absent in snapshots from before tasks existed. */
  tasks?: TaskView[];
  taskItems?: TaskItemView[];
```

- [ ] **Step 5: Fake story.** In `shared/fake-data.ts`, add `tasks: [], taskItems: []` to the object `initialState()` returns, and add these helpers below `member`:

```ts
const task = (s: State, h: string) => s.tasks!.find((t) => t.handle === h)!;
const items = (s: State, h: string) => s.taskItems!.filter((i) => i.taskId === task(s, h).id).sort((a, b) => a.ord - b.ord);
const setItem = (s: State, h: string, ord: number, state: 'pending' | 'in_progress' | 'completed', at: number) => {
  items(s, h)[ord]!.state = state; task(s, h).updatedAt = at;
};
```

Then add these lines at the **end** of the listed SCRIPT steps:

```ts
  // step 1 (trisha fences src/api/): her task appears with a 3-item checklist
    const t = { id: s.nextId++, handle: 'trisha', title: 'Refactor the API routes', status: 'active' as const, bed: 'src', paths: ['src/api/'], createdAt: at, updatedAt: at };
    s.tasks!.push(t);
    ['Read routes.ts', 'Split the handlers', 'Run the tests'].forEach((text, ord) =>
      s.taskItems!.push({ id: s.nextId++, taskId: t.id, ord, text, state: ord === 0 ? 'in_progress' : 'pending' }));
  // step 2 (edit): first item done, second in progress, file joins the task
    setItem(s, 'trisha', 0, 'completed', at); setItem(s, 'trisha', 1, 'in_progress', at);
    task(s, 'trisha').paths.push('src/api/routes.ts');
  // step 5 (alex blocked): alex's task, blocked by the fence
    s.tasks!.push({ id: s.nextId++, handle: 'alex', title: 'Add auth checks', status: 'blocked', bed: 'src', paths: ['src/api/auth.ts'], blockedReason: 'fenced by trisha until 3:00pm', createdAt: at, updatedAt: at });
  // step 8 (acked): alex works elsewhere, unblocked
    { const a = task(s, 'alex'); a.status = 'active'; delete a.blockedReason; a.updatedAt = at; }
  // step 10 (botanist refuses): roadblock on trisha's task, tests step starts
    { const t = task(s, 'trisha'); t.blockedReason = 'Botanist refused: no passing test run seen after your last edit'; }
    setItem(s, 'trisha', 1, 'completed', at); setItem(s, 'trisha', 2, 'in_progress', at);
  // step 11 (tests pass)
    setItem(s, 'trisha', 2, 'completed', at);
  // step 13 (bloom): task done
    { const t = task(s, 'trisha'); t.status = 'done'; t.doneAt = at; delete t.blockedReason; t.updatedAt = at; }
```

(Step numbers are the `// N:` comments in SCRIPT. Each block goes inside that step's arrow function, after its existing statements.)

- [ ] **Step 6: Run tests**

Run: `npm test` (repo root, runs `shared/*.test.ts`)
Expected: all pass, including the new test.

- [ ] **Step 7: CONTRACT.md.** Add two rows to the Tables table, after `certification`:

```md
| `task` | id, handle, title (≤80), status (`active`/`blocked`/`needs_review`/`done`), bed, paths string[] (≤50), blockedReason?, createdAt, updatedAt, doneAt? |
| `taskItem` | id, taskId, ord, text (≤80), state (`pending`/`in_progress`/`completed`) |
```

Add to the reducer list (Generated casing section): `startTask({ handle, title, paths })` and `setTaskItems({ handle, items: { text, state }[] })`. Add `task_started, task_done` to the Activity kinds line. Add one paragraph under Rules:

```md
### Tasks
A member's current task is their most recently updated task that isn't `done`. `startTask` reuses a not-done task with the same title (case-insensitive). Transitions the module makes: edit/create/file_change adds the path to the current task (and un-blocks a fence block); block-mode `blocked_edit` (detail starts `fenced by`) → `blocked`; `reportStatus` working/blocked/needs_review → active/blocked/needs_review; `submitEvidence` bloom on a task path (claim-style match, or the current task if none match) → `done`; a refusal sets `blockedReason` = `Botanist refused: …`. `blockedReason` clears when the status changes to active or done.
```

- [ ] **Step 8: Commit and push** (pull first)

```bash
git pull --rebase && git add shared/ CONTRACT.md && git commit -m "contract: task + taskItem (types, constants, fake story)" && git push
```

---

### Task 2: Module tables, reducers, transitions, smoke, publish, bindings (P1 · Seno)

**Files:**
- Modify: `spacetimedb/src/schema.ts` (two tables, `TaskItemIn`, schema registration)
- Modify: `spacetimedb/src/rules.ts` (`LIM.taskTitle`, `LIM.blocked`)
- Modify: `spacetimedb/src/index.ts` (helpers, 2 reducers, hooks in `ingestActivity`, `reportStatus`, `submitEvidence`, `removeMember`)
- Modify: `spacetimedb/scripts/smoke.sh` (task section)
- Generated: `garden|companion|mcp/src/module_bindings` (via `npm run gen`)

**Interfaces:**
- Consumes: Task 1 constants.
- Produces (generated client): `conn.db.task`, `conn.db.taskItem`, `conn.reducers.startTask({ handle, title, paths })`, `conn.reducers.setTaskItems({ handle, items })`. SQL tables `task`, `task_item`.

- [ ] **Step 1: Write the failing smoke checks** (in `smoke.sh`, insert before `if [ "$SLOW" = 1 ]`)

```bash
echo "-- tasks"
call join_member '"tk"' '""'
call seed_repo '[{"path":"tk/a.ts","lines":10},{"path":"tk/b.ts","lines":10}]'
reject "title too long" "longer than 80" start_task '"tk"' "\"$(printf 'x%.0s' $(seq 1 81))\"" '[]'
call start_task '"tk"' '"Build the thing"' '["tk/"]'
eq  "startTask inserts active"        "SELECT status FROM task WHERE handle = 'tk'" active
eq  "bed from first path"             "SELECT bed FROM task WHERE handle = 'tk'" tk
call start_task '"tk"' '"build the THING"' '["tk/a.ts"]'
eq  "same title (any case) reuses"    "SELECT COUNT(*) AS n FROM task WHERE handle = 'tk'" 1
has "paths merged"                    "SELECT paths FROM task WHERE handle = 'tk'" "tk/a.ts"
call set_task_items '"tk"' '[{"text":"Read","state":"completed"},{"text":"Write","state":"in_progress"},{"text":"Test","state":"bogus"}]'
eq  "items inserted"                  "SELECT COUNT(*) AS n FROM task_item" 3
has "unknown state → pending"         "SELECT state FROM task_item WHERE text = 'Test'" pending
call set_task_items '"tk"' '[{"text":"Only","state":"pending"}]'
eq  "items replaced, not appended"    "SELECT COUNT(*) AS n FROM task_item" 1
call ingest_activity '"tk"' "$(some '"s-tk"')" '"blocked_edit"' "$(some '"tk/b.ts"')" "$NONE" "$(some '"fenced by alex until 7:00pm"')" "$NONE"
eq  "block-mode blocked_edit → blocked" "SELECT status FROM task WHERE handle = 'tk'" blocked
has "blocked reason kept"             "SELECT blocked_reason FROM task WHERE handle = 'tk'" "fenced by alex"
call ingest_activity '"tk"' "$(some '"s-tk"')" '"edit"' "$(some '"tk/b.ts"')" "$(some 12)" "$NONE" "$NONE"
eq  "edit lifts a fence block"        "SELECT status FROM task WHERE handle = 'tk'" active
call ingest_activity '"tk"' "$(some '"s-tk"')" '"blocked_edit"' "$(some '"tk/b.ts"')" "$NONE" "$(some '"warned"')" "$NONE"
eq  "warn-mode blocked_edit keeps status" "SELECT status FROM task WHERE handle = 'tk'" active
call report_status '"tk"' "$NONE" '"needs_review"'
eq  "reportStatus moves the task"     "SELECT status FROM task WHERE handle = 'tk'" needs_review
call submit_evidence '"tk"' '"tk/b.ts"' '"t"'
has "refusal becomes a roadblock"     "SELECT blocked_reason FROM task WHERE handle = 'tk'" "Botanist refused"
call record_diff '"tk"' '["tk/b.ts"]' "$NONE"
call record_test_run '"tk"' '"tk/repo"' '"npm test"' 0
call submit_evidence '"tk"' '"tk/b.ts"' '"t"'
eq  "bloom on a dir-claimed file → done" "SELECT status FROM task WHERE handle = 'tk'" done
has "task_done logged"                "SELECT detail FROM activity WHERE kind = 'task_done'" "Build the thing"
call set_task_items '"tk"' '[{"text":"Plan it","state":"in_progress"}]'
eq  "items with no current task create one" "SELECT COUNT(*) AS n FROM task WHERE handle = 'tk'" 2
has "new task titled by in-progress item"   "SELECT title FROM task WHERE status = 'active'" "Plan it"
call remove_member '"tk"'
eq  "removeMember drops tasks"        "SELECT COUNT(*) AS n FROM task WHERE handle = 'tk'" 0
eq  "removeMember drops items"        "SELECT COUNT(*) AS n FROM task_item" 0
```

- [ ] **Step 2: Run smoke to make sure it fails**

Run: `spacetime start --listen-addr 127.0.0.1:3000` (separate terminal), then `bash spacetimedb/scripts/smoke.sh`
Expected: FAIL lines starting at `title too long` (`no such reducer start_task`).

- [ ] **Step 3: Schema** (`schema.ts`: add after `config`, add `TaskItemIn` after `SeedFile`, and register `task, taskItem` in `schema({...})` after `config`)

```ts
export const task = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    handle: t.string(),
    title: t.string(),
    status: t.string(), // TASK_STATUSES
    bed: t.string(),
    paths: t.array(t.string()),
    blockedReason: t.option(t.string()),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    doneAt: t.option(t.timestamp()),
  }
);

export const taskItem = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    taskId: t.u64(),
    ord: t.u32(),
    text: t.string(),
    state: t.string(), // TASK_ITEM_STATES
  }
);
```

```ts
export const TaskItemIn = t.object('TaskItemIn', { text: t.string(), state: t.string() });
```

In `rules.ts` `LIM`, add `taskTitle: 80, blocked: 120`.

- [ ] **Step 4: Reducers and helpers** (`index.ts`: import `TaskItemIn` from schema, plus `MAX_TASK_ITEMS, MAX_TASK_PATHS, TASK_ITEM_STATES` from constants; add after `removeClaims`)

```ts
type TaskRow = NonNullable<ReturnType<typeof findTask>>;
function findTask(ctx: Ctx, id: bigint) { return ctx.db.task.id.find(id); }

/** The member's most recently updated task that isn't done. */
function currentTask(ctx: Ctx, handle: string): TaskRow | undefined {
  let best: TaskRow | undefined;
  for (const x of ctx.db.task.iter()) {
    if (x.handle !== handle || x.status === 'done') continue;
    if (!best || x.updatedAt.microsSinceUnixEpoch > best.updatedAt.microsSinceUnixEpoch) best = x;
  }
  return best;
}

/** Update a task (always touches updatedAt). A status change to active/done clears blockedReason unless the patch sets one. */
function patchTask(ctx: Ctx, x: TaskRow, patch: Partial<TaskRow>): TaskRow {
  const next = { ...x, ...patch, updatedAt: ctx.timestamp };
  const changed = patch.status !== undefined && patch.status !== x.status;
  if (changed && (patch.status === 'active' || patch.status === 'done') && !('blockedReason' in patch)) next.blockedReason = undefined;
  ctx.db.task.id.update(next);
  return next;
}

const mergePaths = (a: string[], b: string[]) => [...new Set([...a, ...b])].slice(0, MAX_TASK_PATHS);

function insertTask(ctx: Ctx, handle: string, title: string, paths: string[]): TaskRow {
  const row = ctx.db.task.insert({
    id: 0n, handle, title, status: 'active', bed: paths.length ? bedOf(paths[0]!) : '(root)', paths,
    blockedReason: undefined, createdAt: ctx.timestamp, updatedAt: ctx.timestamp, doneAt: undefined,
  });
  log(ctx, handle, 'task_started', { path: paths[0], detail: title });
  return row;
}
```

Add the reducers (after `submitReview`):

```ts
// ---------------- tasks ----------------

export const startTask = spacetimedb.reducer(
  { handle: t.string(), title: t.string(), paths: t.array(t.string()) },
  (ctx, a) => {
    const handle = reqHandle(a.handle);
    const title = reqText(a.title, 'task title', LIM.taskTitle);
    if (a.paths.length > MAX_TASK_PATHS) throw new SenderError(`a task takes at most ${MAX_TASK_PATHS} paths`);
    const paths = [...new Set(a.paths.map(reqPath))];
    if (!touchMember(ctx, handle)) return;
    const key = title.toLowerCase();
    const same = [...ctx.db.task.iter()].find((x) => x.handle === handle && x.status !== 'done' && x.title.toLowerCase() === key);
    if (same) { patchTask(ctx, same, { status: 'active', paths: mergePaths(same.paths, paths), bed: same.paths.length ? same.bed : (paths[0] ? bedOf(paths[0]) : same.bed) }); return; }
    insertTask(ctx, handle, title, paths);
  }
);

export const setTaskItems = spacetimedb.reducer({ handle: t.string(), items: t.array(TaskItemIn) }, (ctx, a) => {
  const handle = reqHandle(a.handle);
  if (a.items.length > MAX_TASK_ITEMS) throw new SenderError(`a checklist takes at most ${MAX_TASK_ITEMS} items`);
  const items = a.items
    .map((i) => ({ text: cap(i.text.trim(), LIM.taskTitle), state: (TASK_ITEM_STATES as readonly string[]).includes(i.state) ? i.state : 'pending' }))
    .filter((i) => i.text);
  if (!touchMember(ctx, handle)) return;
  let cur = currentTask(ctx, handle);
  if (!cur) {
    if (!items.length) return;
    cur = insertTask(ctx, handle, (items.find((i) => i.state === 'in_progress') ?? items[0]!).text, []);
  } else cur = patchTask(ctx, cur, {});
  for (const old of [...ctx.db.taskItem.iter()]) if (old.taskId === cur.id) ctx.db.taskItem.id.delete(old.id);
  items.forEach((i, ord) => ctx.db.taskItem.insert({ id: 0n, taskId: cur!.id, ord, text: i.text, state: i.state }));
});
```

- [ ] **Step 5: Transitions in existing reducers**

In `ingestActivity`, insert right **before** `// Plant state.`:

```ts
    // Task state.
    {
      const ct = currentTask(ctx, handle);
      if (ct && kind === 'blocked_edit' && (a.detail ?? '').startsWith('fenced by')) {
        patchTask(ctx, ct, { status: 'blocked', blockedReason: cap(a.detail!, LIM.blocked) });
      } else if (ct && path && (kind === 'edit' || kind === 'create' || kind === 'file_change')) {
        const unblock = ct.status === 'blocked' && (ct.blockedReason ?? '').startsWith('fenced by');
        patchTask(ctx, ct, { paths: mergePaths(ct.paths, [path]), bed: ct.paths.length ? ct.bed : bedOf(path), ...(unblock ? { status: 'active' } : {}) });
      }
    }
```

In `reportStatus`, insert right after `ensureMember(ctx, handle);`:

```ts
    const ts = status === 'working' ? 'active' : status === 'blocked' ? 'blocked' : status === 'needs_review' ? 'needs_review' : undefined;
    const ct = ts ? currentTask(ctx, handle) : undefined;
    if (ct && ts && ct.status !== ts) patchTask(ctx, ct, { status: ts, ...(ts === 'blocked' ? { blockedReason: 'reported blocked' } : {}) });
```

In `submitEvidence`, at the end of the `if (verdict.ok) {…}` block and the `else {…}` block respectively:

```ts
    for (const x of tasksFor(ctx, handle, path)) {
      patchTask(ctx, x, { status: 'done', doneAt: ctx.timestamp });
      log(ctx, handle, 'task_done', { path, detail: x.title });
    }
```

```ts
    for (const x of tasksFor(ctx, handle, path)) patchTask(ctx, x, { blockedReason: cap(`Botanist refused: ${reason}`, LIM.blocked) });
```

with this helper next to `currentTask`:

```ts
/** Not-done tasks of this member that cover `path`; falls back to the current task so a bloom always lands somewhere. */
function tasksFor(ctx: Ctx, handle: string, path: string): TaskRow[] {
  const hit = [...ctx.db.task.iter()].filter((x) => x.handle === handle && x.status !== 'done' && x.paths.some((p) => claimMatches(p, path)));
  if (hit.length) return hit;
  const ct = currentTask(ctx, handle);
  return ct ? [ct] : [];
}
```

In `removeMember`, before the plant loop:

```ts
  for (const x of [...ctx.db.task.iter()]) {
    if (x.handle !== handle) continue;
    for (const i of [...ctx.db.taskItem.iter()]) if (i.taskId === x.id) ctx.db.taskItem.id.delete(i.id);
    ctx.db.task.id.delete(x.id);
  }
```

- [ ] **Step 6: Run smoke**

Run: `bash spacetimedb/scripts/smoke.sh`
Expected: `== N passed, 0 failed` (the previous 117 plus 26 new).

- [ ] **Step 7: Publish to both hosted dbs without wiping data, then regenerate bindings**

```bash
spacetime sql --server maincloud sprout-mhacks "SELECT COUNT(*) AS n FROM plant"     # note N
spacetime publish sprout-mhacks --server maincloud -p spacetimedb --yes=remote          # NO --delete-data
spacetime publish sprout-demo   --server maincloud -p spacetimedb --yes=remote
spacetime sql --server maincloud sprout-mhacks "SELECT COUNT(*) AS n FROM plant"     # still N
spacetime sql --server maincloud sprout-mhacks "SELECT COUNT(*) AS n FROM task"      # 0
npm run gen
```

Expected: the plant count is unchanged, the `task` table exists, and `git status` shows new `task_table.ts`, `task_item_table.ts`, `start_task_reducer.ts` and `set_task_items_reducer.ts` in all three `module_bindings`.

- [ ] **Step 8: Commit, push, tell the team "task bindings are in"**

```bash
git pull --rebase && git add spacetimedb/ garden/src/module_bindings companion/src/module_bindings mcp/src/module_bindings status/P1.md && git commit -m "module: task + taskItem, startTask/setTaskItems, task transitions; bindings" && git push
```

---

### Task 3: MCP: `claim_files(task)`, `set_checklist`, tasks in `team_status` (P2 · Manahil)

**Files:**
- Modify: `mcp/src/db.ts`, `mcp/src/fakeDb.ts`, `mcp/src/stdbDb.ts`, `mcp/src/tools.ts`
- Modify: `mcp/src/tools.test.ts`, `mcp/src/server.test.ts`, `mcp/src/fakeDb.test.ts`
- Modify: `mcp/TEAM_RULES.md`, `mcp/README.md` (tool table)

**Interfaces:**
- Consumes: Task 1 types and constants; Task 2 reducers (`startTask`, `setTaskItems`) for `StdbDb`.
- Produces: `SproutDb.tasks(): TaskView[]`, `SproutDb.taskItems(taskId: number): TaskItemView[]`, `SproutDb.startTask(handle, title, paths)`, `SproutDb.setTaskItems(handle, items: { text: string; state: TaskItemState }[])`. Tools: `claim_files({ paths, task, ttl_minutes? })`, `set_checklist({ items })`.

- [ ] **Step 1: Write failing tests** (`tools.test.ts`)

Change the two existing claim tests to pass `task`, and the success assertion to:

```ts
  const r = await h.claim_files('trisha', { paths: ['./src/api/'], task: 'Refactor the routes' });
  assert.equal(r.text, 'Fenced src/api/ until 6:30pm (30 min) for "Refactor the routes". Release with release_files when you are done. Keep its checklist current with set_checklist.');
```

(In the other existing tests that call `claim_files`, add `task: 't'` to the args.) Add:

```ts
test('claim_files: task is required and capped at 80 chars', async () => {
  const { h, db } = setup();
  const none = await h.claim_files('trisha', { paths: ['src/x.ts'] } as never);
  assert.equal(none.isError, true);
  assert.match(none.text, /Name the task/);
  const long = await h.claim_files('trisha', { paths: ['src/x.ts'], task: 'x'.repeat(81) });
  assert.match(long.text, /81 chars; keep it under 80/);
  assert.equal(db.claims().length, 0);
  assert.equal(db.tasks().length, 0);
});

test('claim_files: creates the task after the fence, reuses it by title', async () => {
  const { h, db } = setup();
  await h.claim_files('trisha', { paths: ['src/api/'], task: 'Refactor the routes' });
  await h.claim_files('trisha', { paths: ['src/db.ts'], task: 'refactor THE routes' });
  assert.equal(db.tasks().length, 1);
  assert.deepEqual(db.tasks()[0]!.paths, ['src/api/', 'src/db.ts']);
  assert.equal(db.tasks()[0]!.bed, 'src');
});

test('claim_files: a fence conflict creates no task', async () => {
  const { h, db } = setup();
  await db.claimFiles('alex', ['src/api/'], 30);
  await h.claim_files('trisha', { paths: ['src/api/x.ts'], task: 'T' });
  assert.equal(db.tasks().length, 0);
});

test('set_checklist: replaces items on the current task and reports progress', async () => {
  const { h, db } = setup();
  await h.claim_files('trisha', { paths: ['src/x.ts'], task: 'T' });
  const r = await h.set_checklist('trisha', { items: [{ text: 'Read', state: 'completed' }, { text: 'Write', state: 'in_progress' }, { text: 'Test', state: 'pending' }] });
  assert.equal(r.text, 'Checklist for "T": 1/3 done.');
  assert.equal(db.taskItems(db.tasks()[0]!.id).length, 3);
  const bad = await h.set_checklist('trisha', { items: Array.from({ length: 21 }, (_, i) => ({ text: `s${i}`, state: 'pending' as const })) });
  assert.match(bad.text, /at most 20/);
  const sec = await h.set_checklist('trisha', { items: [{ text: 'use sk-ant-api03-abcdefghijklmnop', state: 'pending' }] });
  assert.match(sec.text, /looks like it contains a secret/);
});

test('team_status: lists not-done tasks with progress and roadblock', async () => {
  const { h, db } = setup();
  await h.claim_files('alex', { paths: ['src/api/'], task: 'Refactor the routes' });
  await h.set_checklist('alex', { items: [{ text: 'a', state: 'completed' }, { text: 'b', state: 'pending' }] });
  db.setTaskBlocked('alex', 'Botanist refused: no passing test run seen after your last edit');
  const r = await h.team_status('trisha', {});
  assert.match(r.text, /Tasks:\n  alex: "Refactor the routes" blocked 1\/2 — ✋ Botanist refused: no passing test run/);
});
```

In `server.test.ts`, add `'set_checklist'` to the tool list and rename the test to `'all 13 tools are listed'`. In `fakeDb.test.ts` add:

```ts
test('tasks: startTask reuses by title; setTaskItems with no task creates one', async () => {
  const { db } = make();
  await db.startTask('alex', 'Build', ['src/a/']);
  await db.startTask('alex', 'build', ['src/b.ts']);
  assert.equal(db.tasks().length, 1);
  await db.setTaskItems('trisha', [{ text: 'Plan', state: 'in_progress' }]);
  assert.equal(db.tasks().find((t) => t.handle === 'trisha')!.title, 'Plan');
});
```

- [ ] **Step 2: Run to make sure they fail**

Run: `cd mcp && npm test`
Expected: FAIL (`db.tasks is not a function`, `h.set_checklist is not a function`, and the changed claim text).

- [ ] **Step 3: Interface** (`db.ts`: import `TaskItemState, TaskItemView, TaskView` from shared types, re-export the views, and add to `SproutDb`)

```ts
  tasks(): TaskView[];
  taskItems(taskId: number): TaskItemView[];
  startTask(handle: string, title: string, paths: string[]): Promise<void>;
  setTaskItems(handle: string, items: { text: string; state: TaskItemState }[]): Promise<void>;
```

- [ ] **Step 4: FakeDb** (`fakeDb.ts`: add fields and methods; current task = latest-updated not-done)

```ts
  private _tasks: TaskView[] = [];
  private _items: TaskItemView[] = [];
  tasks() { return this._tasks.map((t) => ({ ...t, paths: [...t.paths] })); }
  taskItems(taskId: number) { return this._items.filter((i) => i.taskId === taskId).sort((a, b) => a.ord - b.ord); }
  private current(handle: string) {
    return this._tasks.filter((t) => t.handle === handle && t.status !== 'done').sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }
  /** Test helper: what the module does on a refusal. */
  setTaskBlocked(handle: string, reason: string) { const t = this.current(handle); if (t) { t.status = 'blocked'; t.blockedReason = reason; } }
  async startTask(handle: string, title: string, paths: string[]) {
    const now = this.now();
    const same = this._tasks.find((t) => t.handle === handle && t.status !== 'done' && t.title.toLowerCase() === title.toLowerCase());
    if (same) { same.paths = [...new Set([...same.paths, ...paths])]; same.status = 'active'; same.updatedAt = now; return; }
    const bed = paths[0] ? (paths[0].includes('/') ? paths[0].split('/')[0]! : '(root)') : '(root)';
    this._tasks.push({ id: this.nextId++, handle, title, status: 'active', bed, paths: [...paths], createdAt: now, updatedAt: now });
  }
  async setTaskItems(handle: string, items: { text: string; state: TaskItemState }[]) {
    let t = this.current(handle);
    if (!t) { if (!items.length) return; await this.startTask(handle, (items.find((i) => i.state === 'in_progress') ?? items[0]!).text, []); t = this.current(handle)!; }
    t.updatedAt = this.now();
    this._items = this._items.filter((i) => i.taskId !== t!.id);
    items.forEach((i, ord) => this._items.push({ id: this.nextId++, taskId: t!.id, ord, text: i.text, state: i.state }));
  }
```

- [ ] **Step 5: StdbDb** (`stdbDb.ts`: add `'task', 'task_item'` to `TABLES`; add methods)

```ts
  tasks(): TaskView[] {
    return [...this.c.db.task.iter()].map((x) => ({
      id: Number(x.id), handle: x.handle, title: x.title, status: x.status as TaskView['status'], bed: x.bed, paths: [...x.paths],
      ...(x.blockedReason ? { blockedReason: x.blockedReason } : {}), createdAt: ms(x.createdAt), updatedAt: ms(x.updatedAt),
      ...(x.doneAt ? { doneAt: ms(x.doneAt) } : {}),
    }));
  }
  taskItems(taskId: number): TaskItemView[] {
    return [...this.c.db.taskItem.iter()].filter((i) => Number(i.taskId) === taskId)
      .map((i) => ({ id: Number(i.id), taskId, ord: i.ord, text: i.text, state: i.state as TaskItemView['state'] }))
      .sort((a, b) => a.ord - b.ord);
  }
  async startTask(handle: string, title: string, paths: string[]) { await this.call(this.c.reducers.startTask({ handle, title, paths })); }
  async setTaskItems(handle: string, items: { text: string; state: TaskItemState }[]) {
    await this.call(this.c.reducers.setTaskItems({ handle, items }));
  }
```

- [ ] **Step 6: Tools** (`tools.ts`)

In `claim_files`, change the args type to `{ paths: string[]; task: string; ttl_minutes?: number }`. Validate `task` first:

```ts
      const title = (task ?? '').trim();
      if (!title) return err('Name the task in a few words, e.g. task: "Add untilText helper". It becomes the plant teammates see.');
      if (title.length > MAX_TASK_TITLE) return err(`Task name is ${title.length} chars; keep it under ${MAX_TASK_TITLE}.`);
      if (SECRET_RE.test(title)) return err('Not claimed: the task name looks like it contains a secret. Describe the work instead.');
```

After a successful `db.claimFiles(...)`, replace the success return with:

```ts
      try { await db.startTask(me, title, norm); } catch (e) {
        return ok(`Fenced ${norm.join(', ')} until ${clock(now() + ttl * 60_000)} (${ttl} min), but the task couldn't be recorded: ${msgOf(e)}.`);
      }
      return ok(`Fenced ${norm.join(', ')} until ${clock(now() + ttl * 60_000)} (${ttl} min) for "${title}". Release with release_files when you are done. Keep its checklist current with set_checklist.`);
```

Add the handler (inside the returned object):

```ts
    set_checklist: tool<{ items: { text: string; state: TaskItemState }[] }>(async (me, { items }) => {
      if (!Array.isArray(items)) return err('Give items: [{ text, state }], state = pending | in_progress | completed.');
      if (items.length > MAX_TASK_ITEMS) return err(`A checklist takes at most ${MAX_TASK_ITEMS} items; group small steps.`);
      const clean = items.map((i) => ({ text: (i.text ?? '').trim().slice(0, MAX_TASK_TITLE), state: i.state })).filter((i) => i.text);
      if (clean.some((i) => SECRET_RE.test(i.text))) return err('Not saved: an item looks like it contains a secret. Describe the step instead.');
      await db.setTaskItems(me, clean);
      const cur = db.tasks().filter((t) => t.handle === me && t.status !== 'done').sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const done = clean.filter((i) => i.state === 'completed').length;
      return ok(`Checklist for "${cur?.title ?? 'your task'}": ${done}/${clean.length} done.`);
    }),
```

In `team_status`, before the inbox line:

```ts
      const open = db.tasks().filter((t) => t.status !== 'done').sort((a, b) => a.handle.localeCompare(b.handle) || b.updatedAt - a.updatedAt);
      lines.push('', 'Tasks:');
      if (!open.length) lines.push('  (none)');
      for (const tk of open) {
        const items = db.taskItems(tk.id), done = items.filter((i) => i.state === 'completed').length;
        const prog = items.length ? ` ${done}/${items.length}` : '';
        lines.push(`  ${tk.handle === me ? 'you' : tk.handle}: "${tk.title}" ${tk.status}${prog}${tk.blockedReason ? ` — ✋ ${tk.blockedReason}` : ''}`);
      }
```

(The test expects `alex:` because the caller is `trisha`.) Import `MAX_TASK_ITEMS, MAX_TASK_TITLE` from constants and `TaskItemState` from shared types. Register the schema and description:

```ts
  server.registerTool('claim_files', {
    description:
      'Fence files or folders before you edit them, and NAME THE TASK you are doing (a few words in your human\'s terms, e.g. "Add untilText helper"); it becomes the plant your teammates see. ' +
      'Repo-relative paths; a folder ends with "/". Claims expire after ttl_minutes (team default 30). If someone else holds it, nothing is claimed: use post_finding to ask them. Never put secrets in the task name.',
    inputSchema: z.object({
      paths: z.array(z.string()).min(1).describe('Repo-relative files or folders ("src/api/")'),
      task: z.string().describe('What you are doing, ≤80 chars, e.g. "Add untilText helper"'),
      ttl_minutes: z.number().int().positive().optional().describe('Minutes until the fence expires (default: team setting, 30)'),
    }),
  }, wrap(h.claim_files));

  server.registerTool('set_checklist', {
    description:
      'Show your plan as a checklist on your current Sprout task. Call it right after claim_files with your steps, and again whenever a step starts or finishes (send the whole list each time). ' +
      `Each item ≤${MAX_TASK_TITLE} chars, at most ${MAX_TASK_ITEMS}; state is pending, in_progress or completed. Short summaries only, no secrets.`,
    inputSchema: z.object({
      items: z.array(z.object({ text: z.string(), state: z.enum(['pending', 'in_progress', 'completed']) })).describe('The full checklist, in order'),
    }),
  }, wrap(h.set_checklist));
```

Note: the MCP SDK validates input against the schema before the handler runs, so a missing `task` in a real MCP call is rejected by the SDK with a validation error that names `task`. The handler check covers direct calls and tests.

- [ ] **Step 7: Run tests, typecheck, build**

Run: `cd mcp && npm test && npm run typecheck && npm run build`
Expected: all pass (the earlier 38 tests plus the new ones), typecheck clean, `dist/server.js` built.

- [ ] **Step 8: Live check against the local module** (after Task 2 is pushed and published locally)

```bash
cd mcp && SPROUT_STDB_URI=ws://127.0.0.1:3000 SPROUT_DB=sprout npm test
```

Expected: the stdb tests still pass. Then run one `claude -p` with `--mcp-config` (pattern in `mcp/NOTES-P2.md`): "claim mcp/src/ for task 'Try tasks', then set_checklist with 3 items, then team_status". The output shows `you: "Try tasks" active 1/3`.

- [ ] **Step 9: Docs, commit, push, redeploy.** Add to `TEAM_RULES.md`: `- **Name your task when you claim files** (\`claim_files(paths, task)\`) and keep its checklist current with \`set_checklist\`.` Add `set_checklist` to the README tool table.

```bash
git pull --rebase && git add mcp/ && git commit -m "mcp: claim_files names the task, set_checklist, tasks in team_status" && git push
```

Then on the VM: `sudo systemctl restart sprout-mcp`, and check `curl -s https://35-225-24-109.sslip.io/health`.

---

### Task 4: Companion: Claude's to-do list → `setTaskItems` (P3 · Shriya)

**Files:**
- Modify: `companion/src/events.ts`, `companion/src/hookMap.ts`, `companion/src/db.ts`, `companion/src/stdbDb.ts`, `companion/src/daemon.ts`
- Modify: `companion/src/hookMap.test.ts`, `companion/HOOK_PAYLOADS.md`
- Create: `companion/test/fixtures/todos.jsonl` (real captured payload)

**Interfaces:**
- Consumes: Task 2 reducer `setTaskItems({ handle, items: { text, state }[] })`.
- Produces: `DaemonEvent` `{ type: 'todos'; repo: string; sessionId?: string; items: { text: string; state: 'pending'|'in_progress'|'completed' }[] }`; `SproutDb.setTaskItems(handle, items)`.

- [ ] **Step 1: Capture the real payload (interactive only).** In headless `claude -p` the to-do tool is not exposed (verified 6:55pm: ToolSearch finds no TodoWrite/TaskCreate). In a scratch repo, add a PostToolUse hook `"matcher": "*"` that appends stdin to `/tmp/todo.jsonl`. Start **interactive** `claude` and type: *"Make a 3-step todo list for adding a greet function, mark step 1 in progress, then step 1 done and step 2 in progress."* Copy the to-do PostToolUse lines into `companion/test/fixtures/todos.jsonl`, replace absolute paths with `/Users/alex/proj`, and record `tool_name` and the `tool_input` shape in `HOOK_PAYLOADS.md`.
  - **If `tool_name` is `TodoWrite`:** `tool_input.todos` is the full list `[{ content, status, activeForm }]`. Use Step 3 as written.
  - **If it is `TaskCreate` / `TaskUpdate`** (incremental): the daemon keeps a per-session list. Step 3b covers that.
  - **If no to-do tool shows up at all:** stop here, note it in `status/P3.md`, and rely on the MCP `set_checklist` tool (Task 3).

- [ ] **Step 2: Write the failing test** (`hookMap.test.ts`; use the fixture's real tool name)

```ts
test('to-do list → one todos event with the full list, text capped and masked', () => {
  const [p] = load('todos.jsonl');
  const plan = map(p!);
  const ev = plan.events.find((e) => e.type === 'todos') as Extract<DaemonEvent, { type: 'todos' }>;
  assert.ok(ev, 'todos event');
  assert.ok(ev.items.length >= 1 && ev.items.length <= 20);
  for (const i of ev.items) {
    assert.ok(['pending', 'in_progress', 'completed'].includes(i.state));
    assert.ok(i.text.length <= 80);
  }
  const secret = mapHook('PostToolUse', { ...p!, tool_input: { todos: [{ content: 'rotate key sk-ant-api03-abcdefghijklmnop', status: 'pending' }] } }, ctx);
  assert.ok(!JSON.stringify(secret).includes('sk-ant-api03-abcdefghijklmnop'));
});
```

Run: `cd companion && npm test`. Expected: FAIL (no `todos` event).

- [ ] **Step 3: Map it** (`events.ts`: add the union member; `hookMap.ts`: inside `case 'PostToolUse':`, before the final `return { events: [] }`)

```ts
  | { type: 'todos'; repo: string; sessionId?: string; items: { text: string; state: 'pending' | 'in_progress' | 'completed' }[] }
```

```ts
      if (tool === 'TodoWrite') {
        const raw = Array.isArray(p.tool_input?.todos) ? (p.tool_input!.todos as Array<Record<string, unknown>>) : [];
        const items = raw.slice(0, 20).map((t) => ({
          text: (detail(typeof t.content === 'string' ? t.content : '') ?? '').slice(0, 80),
          state: (t.status === 'in_progress' || t.status === 'completed' ? t.status : 'pending') as 'pending' | 'in_progress' | 'completed',
        })).filter((i) => i.text);
        return { events: [{ type: 'todos', repo: repo.name, sessionId, items }] };
      }
```

(`detail()` from `redact.ts` already masks secrets and trims. If it caps shorter than 80, keep its cap.)

- [ ] **Step 3b (only if the fixture shows `TaskCreate`/`TaskUpdate`):** emit `{ type: 'todo_op', repo, sessionId, op: 'create' | 'update', id, text?, state? }` from hookMap, taking `id`, `subject` and `status` from the captured `tool_input`/`tool_response` fields. In the daemon, keep `Map<sessionId, Map<id, { text, state, ord }>>`, apply each op, then send the whole list as `setTaskItems`. Write the test against the fixture before the code, same as Step 2.

- [ ] **Step 4: Daemon + db.** `db.ts`: add `setTaskItems(handle: string, items: { text: string; state: string }[]): Promise<void>;` to `SproutDb`, and to `FakeDb`: `setTaskItems(handle, items) { return this.call('setTaskItems', { handle, items }); }`. `stdbDb.ts`:

```ts
  setTaskItems(handle: string, items: { text: string; state: string }[]) {
    return withTimeout(this.r().setTaskItems({ handle, items }), CALL_TIMEOUT_MS, 'setTaskItems');
  }
```

`daemon.ts`: add `| { op: 'setTaskItems'; args: { handle: string; items: { text: string; state: string }[] } }` to the queued-op union, `case 'setTaskItems': await this.db.setTaskItems(op.args.handle, op.args.items); break;` to the op runner, and in the event switch:

```ts
      case 'todos': {
        if (this.paused) break;
        void this.enqueueOrSend({ op: 'setTaskItems', args: { handle: this.cfg.handle, items: ev.items } }, `todos ${ev.items.length}`);
        break;
      }
```

(Match the existing `test_run` case's pause and queue handling exactly. Copy its structure.)

- [ ] **Step 5: Run tests, then a live check**

Run: `cd companion && npm test` → all pass. Then on your laptop, in a joined repo: `sprout stop`, start interactive `claude`, ask for a 3-step plan, and run `spacetime sql --server maincloud sprout-mhacks "SELECT text, state FROM task_item"` → your items appear.

- [ ] **Step 6: Commit and push**

```bash
git pull --rebase && git add companion/ && git commit -m "companion: Claude's to-do list → setTaskItems" && git push
```

---

### Task 5: Garden data layer: tasks in the snapshot (P4 · Trisha)

**Files:**
- Modify: `garden/src/data/spacetime.ts`, `garden/src/data/store.ts`
- Create: `garden/src/data/snapshotTasks.test.ts`

**Interfaces:**
- Consumes: Task 1 types, Task 2 bindings (`db.task`, `db.taskItem`).
- Produces: live and fake snapshots carry `tasks` and `taskItems`; Store emits events for `tasks` / `taskItems`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, type LiveTables } from './spacetime.ts';

const ts = (ms: number) => ({ toDate: () => new Date(ms) });
const empty = { iter: () => [] as never[] };

test('buildSnapshot maps task and taskItem rows (ids → number, ms times, optional fields absent)', () => {
  const db = {
    member: empty, agent: empty, plant: empty, claim: empty, message: empty, testRun: empty, certification: empty, activity: empty,
    task: { iter: () => [{ id: 7n, handle: 'seno', title: 'Refactor', status: 'weird', bed: 'spacetimedb', paths: ['spacetimedb/src/'],
      blockedReason: undefined, createdAt: ts(1000), updatedAt: ts(2000), doneAt: undefined }] },
    taskItem: { iter: () => [{ id: 9n, taskId: 7n, ord: 0, text: 'Read', state: 'in_progress' }] },
  } as unknown as LiveTables;
  const s = buildSnapshot(db, 5000);
  assert.deepEqual(s.tasks, [{ id: 7, handle: 'seno', title: 'Refactor', status: 'active', bed: 'spacetimedb', paths: ['spacetimedb/src/'], createdAt: 1000, updatedAt: 2000 }]);
  assert.deepEqual(s.taskItems, [{ id: 9, taskId: 7, ord: 0, text: 'Read', state: 'in_progress' }]);
});
```

Run: `cd garden && npm test`. Expected: FAIL (`s.tasks` undefined, or a type error).

- [ ] **Step 2: Implement.** In `spacetime.ts`: import `TASK_ITEM_STATES, TASK_STATUSES` from constants and `TaskItemState, TaskStatus` from types. Add `'task', 'task_item'` to `TABLES`, and `'task', 'taskItem'` to the `onConnect` loop list. Add to `LiveTables`: `task?: Tbl<Row<'task'>>; taskItem?: Tbl<Row<'taskItem'>>;`. Append to the object `buildSnapshot` returns:

```ts
    ...(db.task ? { tasks: [...db.task.iter()].map((x) => opt({
      id: Number(x.id), handle: x.handle, title: x.title, status: oneOf(x.status, TASK_STATUSES, 'active') as TaskStatus,
      bed: x.bed, paths: [...x.paths], blockedReason: x.blockedReason, createdAt: ms(x.createdAt), updatedAt: ms(x.updatedAt), doneAt: optMs(x.doneAt),
    })) } : {}),
    ...(db.taskItem ? { taskItems: [...db.taskItem.iter()].map((i) => ({
      id: Number(i.id), taskId: Number(i.taskId), ord: num(i.ord), text: i.text, state: oneOf(i.state, TASK_ITEM_STATES, 'pending') as TaskItemState,
    })) } : {}),
```

In `store.ts` `KEYS`, add `tasks: 'id', taskItems: 'id'`.

- [ ] **Step 3: Run tests**

Run: `cd garden && npm test`. Expected: all pass. Then `npm run dev`, open `/?source=fake&step=3&paused=1`, and in the console `__garden.snapshot().tasks` (with `&debug=1`) shows trisha's task.

- [ ] **Step 4: Commit and push**

```bash
git pull --rebase && git add garden/src/data && git commit -m "garden: tasks and taskItems in live snapshots" && git push
```

---

### Task 6: Garden task model, task card, new `P` board (P2 · Manahil)

**Files:**
- Create: `garden/src/tasks.ts` (pure model), `garden/src/tasks.test.ts`
- Create: `garden/src/ui/taskCard.ts` (pure HTML), `garden/src/ui/taskCard.test.ts`
- Create: `garden/src/ui/board.css`
- Modify (rewrite): `garden/src/ui/plan.ts` (same exports `initPlan`, `renderPlan`, `PlanHandlers`)
- Create: `garden/src/ui/board.test.ts`
- Modify: `garden/src/main.ts`, only the `onShowIn3D` line: `world.focus('fence', path)`

**Interfaces:**
- Consumes: Task 1 types (on fake data first; live once Task 5 lands).
- Produces (used by Tasks 7 and 8):

```ts
export interface AgentLine { kind: 'main' | 'spirit'; sessionId: string; status: string; action: string; path?: string; agoMs: number }
export interface TaskModel {
  id: number; handle: string; color: string; title: string; status: TaskStatus; bed: string; paths: string[];
  items: { text: string; state: TaskItemState }[]; done: number; total: number;
  fence?: { path: string; expiresAt: number }; roadblocks: string[]; agents: AgentLine[];
  current: boolean; createdAt: number; updatedAt: number; doneAt?: number;
}
export interface Attention { kind: 'blocked' | 'refused' | 'bugs' | 'message' | 'handoff'; text: string; focus: string }
export function taskModels(s: GardenSnapshot): TaskModel[];         // sorted: handle, then current first, then updatedAt desc
export function currentTaskOf(s: GardenSnapshot, handle: string): TaskView | undefined;
export function attention(s: GardenSnapshot): Attention[];
export function taskCardHtml(m: TaskModel, now: number, o?: { compact?: boolean }): string;  // in ui/taskCard.ts
```

- [ ] **Step 1: Write failing model tests** (`garden/src/tasks.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_STEPS, makeFakeSnapshots } from '../../shared/fake-data.ts';
import { attention, currentTaskOf, taskModels } from './tasks.ts';

const snaps = makeFakeSnapshots(FAKE_STEPS + 1);

// snaps[n] = the fake story after script steps 0..n-1 (step 1 = trisha's fence, 2 = her edit, 3 = subagent out, 4 = back).
test('model: progress, fence, owner color, current flag', () => {
  const s = snaps[3]!;
  const [m] = taskModels(s).filter((t) => t.handle === 'trisha');
  assert.equal(m!.title, 'Refactor the API routes');
  assert.equal(`${m!.done}/${m!.total}`, '1/3');
  assert.equal(m!.fence?.path, 'src/api/');
  assert.equal(m!.color, s.members.find((x) => x.handle === 'trisha')!.color);
  assert.equal(m!.current, true);
});

test('model: live agent lines on the current task only (main + spirit)', () => {
  const out = taskModels(snaps[4]!).find((t) => t.handle === 'trisha')!;   // subagent is out
  assert.ok(out.agents.some((a) => a.kind === 'main'));
  assert.ok(out.agents.some((a) => a.kind === 'spirit' && a.path === 'src/db.ts'));
  const back = taskModels(snaps[5]!).find((t) => t.handle === 'trisha')!;  // subagent returned
  assert.equal(back.agents.filter((a) => a.kind === 'spirit').length, 0);
});

test('model: roadblocks from blocked reason, refusal and bugs', () => {
  assert.match(taskModels(snaps[6]!).find((t) => t.handle === 'alex')!.roadblocks.join('|'), /fenced by trisha/);
  const r = taskModels(snaps[11]!).find((t) => t.handle === 'trisha')!.roadblocks.join('|');
  assert.match(r, /Botanist refused/);
  assert.match(r, /bug/);
});

test('currentTaskOf ignores done tasks', () => {
  assert.equal(currentTaskOf(snaps[2]!, 'trisha')!.title, 'Refactor the API routes');
  assert.equal(currentTaskOf(snaps[FAKE_STEPS]!, 'trisha'), undefined);
});

test('attention: blocked task, refusal and unacked message become chips', () => {
  const kinds = (i: number) => attention(snaps[i]!).map((a) => a.kind);
  assert.ok(kinds(6).includes('blocked'));
  assert.ok(kinds(7).includes('message'));
  assert.ok(kinds(11).includes('refused'));
  assert.ok(!kinds(FAKE_STEPS).includes('refused')); // bloom after the refusal clears it
});
```

Run: `cd garden && npm test`. Expected: FAIL (`Cannot find module './tasks.ts'`).

- [ ] **Step 2: Implement `garden/src/tasks.ts`**

```ts
// Pure: one TaskModel per task, built from a snapshot. The board, hover card, task plants and spirits all read this.
import type { GardenSnapshot, TaskItemState, TaskStatus, TaskView } from '../../shared/types.ts';

export interface AgentLine { kind: 'main' | 'spirit'; sessionId: string; status: string; action: string; path?: string; agoMs: number }
export interface TaskModel {
  id: number; handle: string; color: string; title: string; status: TaskStatus; bed: string; paths: string[];
  items: { text: string; state: TaskItemState }[]; done: number; total: number;
  fence?: { path: string; expiresAt: number }; roadblocks: string[]; agents: AgentLine[];
  current: boolean; createdAt: number; updatedAt: number; doneAt?: number;
}
export interface Attention { kind: 'blocked' | 'refused' | 'bugs' | 'message' | 'handoff'; text: string; focus: string }

const covers = (claim: string, file: string) => claim === file || (claim.endsWith('/') && file.startsWith(claim));
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p;

export function currentTaskOf(s: GardenSnapshot, handle: string): TaskView | undefined {
  return (s.tasks ?? []).filter((t) => t.handle === handle && t.status !== 'done').sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function taskModels(s: GardenSnapshot): TaskModel[] {
  const color = (h: string) => s.members.find((m) => m.handle === h)?.color ?? '#888888';
  const out = (s.tasks ?? []).map((t): TaskModel => {
    const items = (s.taskItems ?? []).filter((i) => i.taskId === t.id).sort((a, b) => a.ord - b.ord).map((i) => ({ text: i.text, state: i.state }));
    const current = currentTaskOf(s, t.handle)?.id === t.id;
    const fenceRow = s.claims.find((c) => c.handle === t.handle && t.paths.some((p) => covers(c.path, p) || covers(p, c.path)));
    const roadblocks: string[] = [];
    if (t.blockedReason) roadblocks.push(t.blockedReason);
    else if (t.status === 'blocked') roadblocks.push('blocked');
    if (t.status !== 'done') {
      for (const p of s.plants) if (p.bugs > 0 && t.paths.some((tp) => covers(tp, p.path))) roadblocks.push(`${p.bugs} failing-test bug${p.bugs === 1 ? '' : 's'} on ${base(p.path)}`);
    }
    const agents: AgentLine[] = current
      ? s.agents.filter((a) => a.handle === t.handle && a.status !== 'dormant').map((a) => ({
          kind: a.kind === 'subagent' ? 'spirit' : 'main', sessionId: a.sessionId, status: a.status, action: a.currentAction,
          ...(a.currentPath ? { path: a.currentPath } : {}), agoMs: Math.max(0, s.at - a.lastSeen),
        }))
      : [];
    return {
      id: t.id, handle: t.handle, color: color(t.handle), title: t.title, status: t.status, bed: t.bed, paths: t.paths,
      items, done: items.filter((i) => i.state === 'completed').length, total: items.length,
      ...(fenceRow ? { fence: { path: fenceRow.path, expiresAt: fenceRow.expiresAt } } : {}),
      roadblocks, agents, current, createdAt: t.createdAt, updatedAt: t.updatedAt, ...(t.doneAt ? { doneAt: t.doneAt } : {}),
    };
  });
  return out.sort((a, b) => a.handle.localeCompare(b.handle) || Number(b.current) - Number(a.current) || b.updatedAt - a.updatedAt);
}

export function attention(s: GardenSnapshot): Attention[] {
  const out: Attention[] = [];
  for (const t of s.tasks ?? []) {
    if (t.status === 'blocked') out.push({ kind: 'blocked', text: `${t.handle} blocked: ${t.blockedReason ?? t.title}`, focus: t.paths[0] ?? '' });
  }
  const latest = new Map<string, (typeof s.certifications)[number]>();
  for (const c of s.certifications) { const p = latest.get(c.path); if (!p || c.at >= p.at) latest.set(c.path, c); }
  for (const c of latest.values()) if (c.result === 'refused') out.push({ kind: 'refused', text: `Botanist refused ${base(c.path)} (${c.handle}): ${c.reason}`, focus: c.path });
  for (const p of s.plants) if (p.bugs > 0) out.push({ kind: 'bugs', text: `${p.bugs} bug${p.bugs === 1 ? '' : 's'} on ${base(p.path)}`, focus: p.path });
  for (const m of s.messages) if (m.status !== 'acked') out.push({ kind: 'message', text: `${m.fromHandle} → ${m.toHandle}: ${m.status === 'sent' ? 'waiting for delivery' : 'not acked yet'}`, focus: '' });
  for (const h of s.handoffs ?? []) if (h.status === 'offered') out.push({ kind: 'handoff', text: `${h.fromHandle} → ${h.toHandle}: "${h.task}" needs accepting`, focus: '' });
  return out;
}
```

- [ ] **Step 3: Run the model tests**

Run: `cd garden && npm test`. Expected: `tasks.test.ts` passes. If the fake step indexes in the tests are off by one against the fake story, fix the **test indexes** (not the model) so they point at the steps described in each test's comment.

- [ ] **Step 4: Write failing card tests** (`garden/src/ui/taskCard.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskCardHtml } from './taskCard.ts';
import type { TaskModel } from '../tasks.ts';

const m = (o: Partial<TaskModel> = {}): TaskModel => ({
  id: 1, handle: 'manahil', color: '#2a9d8f', title: 'Add untilText helper', status: 'active', bed: 'mcp', paths: ['mcp/src/'],
  items: [{ text: 'Read time.ts', state: 'completed' }, { text: 'Add untilText()', state: 'in_progress' }, { text: 'Run tests', state: 'pending' }],
  done: 1, total: 3, fence: { path: 'mcp/src/', expiresAt: Date.UTC(2026, 9, 3, 23, 22) }, roadblocks: [],
  agents: [{ kind: 'main', sessionId: 's', status: 'working', action: 'edit', path: 'mcp/src/time.ts', agoMs: 4000 },
    { kind: 'spirit', sessionId: 's:a', status: 'working', action: 'search', path: 'companion/src/hookMap.ts', agoMs: 0 }],
  current: true, createdAt: 0, updatedAt: 0, ...o,
});

test('card shows title, owner, progress, checklist marks, fence and live lines', () => {
  const h = taskCardHtml(m(), Date.UTC(2026, 9, 3, 23, 0));
  for (const s of ['Add untilText helper', 'manahil', '1 / 3', '✓', '▸', '○', 'fenced mcp/src/', '🤖', '✨', 'search hookMap.ts', 'just now']) assert.ok(h.includes(s), s);
});

test('card escapes agent-written text', () => {
  const h = taskCardHtml(m({ title: '<img src=x onerror=alert(1)>', items: [{ text: '<b>x</b>', state: 'pending' }], roadblocks: ['<script>'] }), 0);
  assert.ok(!h.includes('<img') && !h.includes('<b>x') && !h.includes('<script>'));
  assert.ok(h.includes('&lt;img'));
});

test('card caps the checklist at 8 items with "+N more"', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ text: `step ${i}`, state: 'pending' as const }));
  const h = taskCardHtml(m({ items, total: 20, done: 0 }), 0);
  assert.ok(h.includes('step 7') && !h.includes('step 8'));
  assert.ok(h.includes('+12 more'));
});

test('done task shows the bloom, roadblocks show the hand', () => {
  assert.ok(taskCardHtml(m({ status: 'done', current: false, agents: [] }), 0).includes('🌸 certified'));
  assert.ok(taskCardHtml(m({ status: 'blocked', roadblocks: ['fenced by seno until 7:00pm'] }), 0).includes('✋ fenced by seno'));
});
```

Run: `cd garden && npm test`. Expected: FAIL (module missing).

- [ ] **Step 5: Implement `garden/src/ui/taskCard.ts`**

```ts
import type { TaskModel } from '../tasks.ts';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
const ago = (ms: number) => (ms < 15_000 ? 'just now' : ms < 3_600_000 ? `${Math.round(ms / 60_000) || 1} min ago` : `${Math.floor(ms / 3_600_000)}h ago`);
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
const STATUS: Record<string, string> = { active: '● working', blocked: '✋ blocked', needs_review: '👀 needs review', done: '🌸 certified' };
const MARK = { completed: '✓', in_progress: '▸', pending: '○' } as const;
const MAX_ITEMS = 8;

/** One task as an HTML card. Every agent-written string is escaped. */
export function taskCardHtml(m: TaskModel, now: number, o: { compact?: boolean } = {}): string {
  const items = m.items.slice(0, MAX_ITEMS).map((i) => `<li class="it ${i.state}"><span class="mk">${MARK[i.state]}</span>${esc(i.text)}</li>`).join('');
  const more = m.items.length > MAX_ITEMS ? `<li class="more">+${m.items.length - MAX_ITEMS} more</li>` : '';
  const pct = m.total ? Math.round((m.done / m.total) * 100) : m.status === 'done' ? 100 : 0;
  const live = m.agents.map((a) =>
    `<li class="live ${a.kind}"><span>${a.kind === 'main' ? '🤖 main' : '✨ spirit'}</span> ${esc(a.action)}${a.path ? ` ${esc(base(a.path))}` : ''} · ${ago(a.agoMs)}</li>`).join('');
  const meta = [esc(m.handle), m.fence ? `fenced ${esc(m.fence.path)} until ${clock(m.fence.expiresAt)}` : '', m.paths.length ? `${m.paths.length} path${m.paths.length === 1 ? '' : 's'}` : '']
    .filter(Boolean).join(' · ');
  return `<article class="task-card st-${m.status}${o.compact ? ' compact' : ''}" style="--owner:${esc(m.color)}" data-task="${m.id}" data-focus="${esc(m.paths[0] ?? '')}" tabindex="0">
  <header><h4>${esc(m.title)}</h4><span class="st">${STATUS[m.status] ?? esc(m.status)}</span></header>
  <p class="meta">${meta}</p>
  ${m.total ? `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><p class="prog">${m.done} / ${m.total}</p>` : ''}
  ${items || more ? `<ul class="items">${items}${more}</ul>` : ''}
  ${m.roadblocks.length ? `<ul class="blocks">${m.roadblocks.map((r) => `<li>✋ ${esc(r)}</li>`).join('')}</ul>` : ''}
  ${live ? `<ul class="lives">${live}</ul>` : ''}
</article>`;
}
```

(`now` is unused for now; it stays in the signature so callers don't change when relative times are added.) Run: `cd garden && npm test`. Expected: card tests pass.

- [ ] **Step 6: Write failing board tests** (`garden/src/ui/board.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_STEPS, makeFakeSnapshots } from '../../../shared/fake-data.ts';
import { boardHtml } from './plan.ts';

const snaps = makeFakeSnapshots(FAKE_STEPS + 1);

test('board: one column per member, in member order, with their task cards', () => {
  const h = boardHtml(snaps[6]!);
  const cols = [...h.matchAll(/data-col="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cols, snaps[6]!.members.map((m) => m.handle));
  assert.ok(h.includes('Refactor the API routes') && h.includes('Add auth checks'));
});

test('board: member without a task says so; orphan tasks go to Other', () => {
  const s = { ...snaps[2]!, tasks: [...snaps[2]!.tasks!, { id: 999, handle: 'ghost', title: 'Old work', status: 'active' as const, bed: 'src', paths: [], createdAt: 0, updatedAt: 0 }] };
  const h = boardHtml(s);
  assert.ok(h.includes('No task yet'));
  assert.ok(h.includes('data-col="__other"') && h.includes('Old work'));
});

test('board: needs-attention strip lists blocked and refused', () => {
  assert.match(boardHtml(snaps[6]!), /class="attn[^"]*"[\s\S]*alex blocked/);
  assert.match(boardHtml(snaps[11]!), /Botanist refused/);
});

test('board: done tasks are collapsed under a details element', () => {
  assert.match(boardHtml(snaps[FAKE_STEPS]!), /<details class="done"><summary>1 certified<\/summary>[\s\S]*Refactor the API routes/);
});
```

Run: `cd garden && npm test`. Expected: FAIL (`boardHtml` not exported).

- [ ] **Step 7: Rewrite `garden/src/ui/plan.ts`** (keep the exported names main.ts uses)

```ts
import './board.css';
import type { GardenSnapshot } from '../../../shared/types.ts';
import type { GardenLayout } from '../layout.ts';
import { attention, taskModels } from '../tasks.ts';
import { esc, taskCardHtml } from './taskCard.ts';

export interface PlanHandlers { onShowIn3D(path: string): void; onClose(): void }
let host: HTMLElement | undefined;
let handlers: PlanHandlers | undefined;
let lastSig = '';

const ICON: Record<string, string> = { blocked: '✋', refused: '🧑‍🌾', bugs: '🐛', message: '✉️', handoff: '🌱' };

/** Pure: the whole board as HTML (tested). */
export function boardHtml(s: GardenSnapshot): string {
  const models = taskModels(s);
  const handles = s.members.map((m) => m.handle);
  const col = (h: string, title: string, color: string, online: boolean | undefined) => {
    const mine = models.filter((m) => (h === '__other' ? !handles.includes(m.handle) : m.handle === h));
    const open = mine.filter((m) => m.status !== 'done'), done = mine.filter((m) => m.status === 'done');
    const main = s.agents.find((a) => a.handle === h && a.kind === 'claude' && a.status !== 'dormant');
    const doing = main ? `${esc(main.currentAction)}${main.currentPath ? ` ${esc(main.currentPath.split('/').pop()!)}` : ''}` : online ? 'online' : 'offline';
    return `<section class="col" data-col="${esc(h)}" style="--owner:${esc(color)}">
  <h3><span class="dot${online ? ' on' : ''}"></span>${esc(title)}<small>${h === '__other' ? '' : doing}</small></h3>
  ${open.length ? open.map((m) => taskCardHtml(m, s.at, { compact: true })).join('') : h === '__other' ? '' : '<p class="none">No task yet</p>'}
  ${done.length ? `<details class="done"><summary>${done.length} certified</summary>${done.map((m) => taskCardHtml(m, s.at, { compact: true })).join('')}</details>` : ''}
</section>`;
  };
  const cols = s.members.map((m) => col(m.handle, m.handle, m.color, m.online));
  if (models.some((m) => !handles.includes(m.handle))) cols.push(col('__other', 'Other', '#888888', undefined));
  const att = attention(s);
  const strip = att.length
    ? `<div class="attn" role="list" aria-label="Needs attention">${att.slice(0, 12).map((a) => `<button role="listitem" class="chip ${a.kind}" data-focus="${esc(a.focus)}">${ICON[a.kind]} ${esc(a.text)}</button>`).join('')}</div>`
    : '<div class="attn ok">Nothing needs attention 🌿</div>';
  return `${strip}<div class="cols">${cols.join('')}</div>`;
}

export function initPlan(el: HTMLElement, h: PlanHandlers) {
  host = el; handlers = h;
  el.innerHTML = `<div class="plan-bar"><b>Team board</b><span class="hint">Click a card or chip to see it in 3D · P or Esc to close</span><button data-close>Back to 3D (P)</button></div><div class="board" tabindex="-1"></div>`;
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) { handlers?.onClose(); return; }
    if (t.closest('summary')) return;
    const f = t.closest<HTMLElement>('[data-focus]');
    if (f?.dataset.focus) handlers?.onShowIn3D(f.dataset.focus);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { handlers?.onClose(); return; }
    const cards = [...el.querySelectorAll<HTMLElement>('.task-card')];
    const i = cards.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Enter' && i >= 0 && cards[i]!.dataset.focus) handlers?.onShowIn3D(cards[i]!.dataset.focus!);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && cards.length) { e.preventDefault(); cards[(i + 1) % cards.length]!.focus(); }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && cards.length) { e.preventDefault(); cards[(i - 1 + cards.length) % cards.length]!.focus(); }
  });
}

/** Signature kept for main.ts; the layout is no longer needed. Re-renders only when the HTML changes (keeps focus). */
export function renderPlan(s: GardenSnapshot, _l?: GardenLayout) {
  if (!host) return;
  const html = boardHtml(s);
  if (html === lastSig) return;
  lastSig = html;
  const board = host.querySelector<HTMLElement>('.board')!;
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.task;
  board.innerHTML = html;
  if (focused) board.querySelector<HTMLElement>(`[data-task="${focused}"]`)?.focus();
}
```

- [ ] **Step 8: `garden/src/ui/board.css`** (large type, projector-readable)

```css
#plan .plan-bar { font-size: 18px; gap: 16px; }
#plan .plan-bar .hint { opacity: .65; font-size: 15px; }
#plan .board { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
#plan .attn { display: flex; flex-wrap: wrap; gap: 8px; }
#plan .attn.ok { font-size: 17px; opacity: .7; }
#plan .attn .chip { font: 600 16px/1.3 inherit; padding: 6px 12px; border-radius: 999px; border: 2px solid #c0392b; background: #fff4f2; cursor: pointer; }
#plan .attn .chip.message, #plan .attn .chip.handoff { border-color: #2a6df4; background: #f1f6ff; }
#plan .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; align-items: start; }
#plan .col h3 { margin: 0 0 8px; font-size: 22px; display: flex; align-items: center; gap: 8px; border-bottom: 4px solid var(--owner); padding-bottom: 6px; }
#plan .col h3 small { font-weight: 400; font-size: 15px; opacity: .75; margin-left: auto; }
#plan .dot { width: 12px; height: 12px; border-radius: 50%; background: #bbb; } #plan .dot.on { background: #2e9e4f; }
#plan .none { font-size: 16px; opacity: .6; margin: 6px 0; }
.task-card { background: #fff; border: 1px solid #d9d2b8; border-left: 6px solid var(--owner); border-radius: 12px; padding: 10px 14px; margin: 0 0 10px; font-size: 16px; line-height: 1.35; color: #24231d; }
.task-card:focus { outline: 3px solid #2a6df4; }
.task-card header { display: flex; gap: 8px; align-items: baseline; }
.task-card h4 { margin: 0; font-size: 19px; flex: 1; overflow-wrap: anywhere; }
.task-card .st { font-size: 14px; white-space: nowrap; }
.task-card.st-blocked { background: #fff6f4; } .task-card.st-done { opacity: .8; }
.task-card .meta { margin: 2px 0 6px; font-size: 14px; opacity: .75; }
.task-card .bar { height: 8px; background: #eee6cc; border-radius: 4px; overflow: hidden; } .task-card .bar i { display: block; height: 100%; background: var(--owner); }
.task-card .prog { margin: 2px 0 4px; font-size: 13px; opacity: .7; }
.task-card ul { list-style: none; margin: 4px 0; padding: 0; }
.task-card .it .mk { display: inline-block; width: 1.3em; } .task-card .it.completed { opacity: .6; text-decoration: line-through; } .task-card .it.in_progress { font-weight: 700; }
.task-card .blocks li { color: #b0301f; font-weight: 600; }
.task-card .lives li { font-size: 14px; } .task-card .lives span { display: inline-block; min-width: 4.6em; }
.task-card.compact .lives li { font-size: 13px; }
#plan details.done summary { cursor: pointer; font-size: 15px; opacity: .75; margin: 4px 0 8px; }
.task-card.hover { position: fixed; z-index: 6; max-width: 360px; pointer-events: none; box-shadow: 0 8px 24px rgba(0,0,0,.2); }
```

Then in `main.ts` change `onShowIn3D: (path) => { setPlan(false); world.focus('plant', path); },` to `onShowIn3D: (path) => { setPlan(false); world.focus('fence', path); },` (`'fence'` also resolves folder paths like `mcp/src/`).

- [ ] **Step 9: Run all garden tests, then look at it**

Run: `cd garden && npm test`. Expected: all pass. Then `npm run dev`, open `/?source=fake&step=6&paused=1`, press `P`:
- the attention strip shows ✋ alex blocked
- there are four columns, with trisha's and alex's task cards
- text is readable from 3 m away
- clicking a card closes the board and flies to the plant

Also check `/` (live) once Task 5 is in.

- [ ] **Step 10: Commit and push** (tell Trisha "taskCard.ts and tasks.ts are in")

```bash
git pull --rebase && git add garden/src/tasks.ts garden/src/tasks.test.ts garden/src/ui/taskCard.ts garden/src/ui/taskCard.test.ts garden/src/ui/board.css garden/src/ui/plan.ts garden/src/ui/board.test.ts garden/src/main.ts && git commit -m "garden: task model, task card, readable team board (P)" && git push
```

---

### Task 7: Task plants, signposts, hover card, gardener task labels (P4 · Trisha)

**Files:**
- Modify: `garden/src/layout.ts` (+ `layoutTaskPlants`), `garden/src/layout.test.ts`
- Create: `garden/src/scene/taskPlants.ts`
- Modify: `garden/src/scene/world.ts` (own a `TaskPlants`, sync, update, hover), `garden/src/scene/actors.ts` (gardener label shows the current task)

**Interfaces:**
- Consumes: `taskModels`, `currentTaskOf` (`garden/src/tasks.ts`), `taskCardHtml` (`garden/src/ui/taskCard.ts`), `iconMat` (actors.ts), `Labels` (effects.ts).
- Produces: `layoutTaskPlants(l: GardenLayout, tasks: { id: number; bed: string; status: string; updatedAt: number }[]): TaskPlantLayout[]`, `TaskPlants.posOf(taskId): THREE.Vector3 | undefined`, and `GardenWorld.taskPlantPos(handle): THREE.Vector3 | undefined` (added to `WorldLookup`, used by Task 8).

- [ ] **Step 1: Failing layout tests.** Add `layoutTaskPlants` to the existing `import { … } from './layout.ts'` at the top of `garden/src/layout.test.ts`, then append:

```ts
test('task plants sit on the path in front of their bed, deterministic, no overlap with file plants', () => {
  const l = layoutGarden([{ path: 'mcp/src/a.ts', bed: 'mcp', lines: 10 }, { path: 'mcp/src/b.ts', bed: 'mcp', lines: 10 }, { path: 'garden/x.ts', bed: 'garden', lines: 5 }]);
  const tasks = [{ id: 2, bed: 'mcp', status: 'active', updatedAt: 5 }, { id: 1, bed: 'mcp', status: 'done', updatedAt: 9 }, { id: 3, bed: 'nope', status: 'active', updatedAt: 1 }];
  const a = layoutTaskPlants(l, tasks), b = layoutTaskPlants(l, [...tasks].reverse());
  assert.deepEqual(a, b);
  const mcp = l.beds.find((x) => x.name === 'mcp')!;
  for (const t of a.filter((x) => x.bed === 'mcp')) {
    assert.ok(Math.abs(t.z - (mcp.z + mcp.d / 2 + 1.2)) < 1e-6);
    for (const p of l.plants) assert.ok(Math.hypot(p.x - t.x, p.z - t.z) > 1, 'no overlap');
  }
  assert.equal(a.find((x) => x.id === 3)!.bed, l.beds[0]!.name); // unknown bed → first bed
});

test('at most 6 done task plants are kept (newest)', () => {
  const l = layoutGarden([{ path: 'a/x.ts', bed: 'a', lines: 1 }]);
  const tasks = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, bed: 'a', status: 'done', updatedAt: i }));
  assert.deepEqual(layoutTaskPlants(l, tasks).map((t) => t.id).sort((x, y) => x - y), [4, 5, 6, 7, 8, 9]);
});
```

Run: `cd garden && npm test`. Expected: FAIL (`layoutTaskPlants` not exported).

- [ ] **Step 2: Implement** (append to `layout.ts`)

```ts
export interface TaskPlantLayout { id: number; bed: string; x: number; z: number }
const TASK_GAP = 2.2;
const MAX_DONE_TASK_PLANTS = 6;

/** Task plants stand on the path just in front of their bed (toward the camera), spread across its width. */
export function layoutTaskPlants(l: GardenLayout, tasks: { id: number; bed: string; status: string; updatedAt: number }[]): TaskPlantLayout[] {
  if (!l.beds.length) return [];
  const done = tasks.filter((t) => t.status === 'done').sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id).slice(0, MAX_DONE_TASK_PLANTS);
  const keep = [...tasks.filter((t) => t.status !== 'done'), ...done].sort((a, b) => a.id - b.id);
  const byBed = new Map<string, number[]>();
  for (const t of keep) {
    const bed = l.beds.some((b) => b.name === normalizeBed(t.bed)) ? normalizeBed(t.bed) : l.beds[0]!.name;
    const ids = byBed.get(bed); if (ids) ids.push(t.id); else byBed.set(bed, [t.id]);
  }
  const out: TaskPlantLayout[] = [];
  for (const [bed, ids] of byBed) {
    const b = l.beds.find((x) => x.name === bed)!;
    const step = Math.min(TASK_GAP, b.w / ids.length);
    ids.forEach((id, i) => out.push({ id, bed, x: round(b.x - (step * (ids.length - 1)) / 2 + step * i), z: round(b.z + b.d / 2 + 1.2) }));
  }
  return out.sort((a, b) => a.id - b.id);
}
```

Run: `cd garden && npm test`. Expected: pass.

- [ ] **Step 3: `garden/src/scene/taskPlants.ts`** (a few dozen meshes at most, so ordinary meshes are fine)

```ts
import * as THREE from 'three';
import type { TaskModel } from '../tasks.ts';
import type { TaskPlantLayout } from '../layout.ts';
import type { Labels } from './effects.ts';
import { geo, mat, mesh } from './materials.ts';
import { iconMat } from './actors.ts';

interface TP { id: number; g: THREE.Group; key: string; label: HTMLElement; labelText: string; hand?: THREE.Sprite; x: number; z: number; status: string; born: number }
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One tall plant per task: owner-coloured pot, leaves = paths, buds = checklist, bloom when certified, droop + ✋ when blocked. */
export class TaskPlants {
  private items = new Map<number, TP>();
  readonly group = new THREE.Group();
  constructor(scene: THREE.Scene, private labels: Labels) { scene.add(this.group); }

  posOf(id: number) { const t = this.items.get(id); return t ? new THREE.Vector3(t.x, 0, t.z) : undefined; }

  sync(models: TaskModel[], layout: TaskPlantLayout[], now: number) {
    const pos = new Map(layout.map((p) => [p.id, p]));
    for (const [id, t] of this.items) if (!pos.has(id) || !models.some((m) => m.id === id)) this.drop(id, t);
    for (const m of models) {
      const p = pos.get(m.id); if (!p) continue;
      const key = JSON.stringify([m.status, m.color, m.items.map((i) => i.state), Math.min(8, m.paths.length)]);
      let t = this.items.get(m.id);
      if (!t) {
        const at = new THREE.Vector3();
        const label = this.labels.add('', () => at.set(t!.x, 3.1, t!.z), 'label task');
        t = { id: m.id, g: new THREE.Group(), key: '', label, labelText: '', x: p.x, z: p.z, status: m.status, born: now };
        this.items.set(m.id, t); this.group.add(t.g);
      }
      t.x = p.x; t.z = p.z; t.g.position.set(p.x, 0, p.z); t.status = m.status;
      const text = `${clip(m.title, 34)} · ${m.handle}`;
      if (text !== t.labelText) { t.labelText = text; this.labels.setText(t.label, text); t.label.style.borderColor = m.color; }
      if (key !== t.key) { t.key = key; this.build(t, m); }
    }
  }

  private build(t: TP, m: TaskModel) {
    for (const c of [...t.g.children]) { t.g.remove(c); }
    const owner = mat(m.color), stem = mat('#3f7d3a'), leaf = mat('#58a24a');
    t.g.add(mesh(geo.cyl, owner, 0.55, 0.45, 0.55, 0, 0.22, 0));                    // pot in the owner's colour
    t.g.add(mesh(geo.cyl, stem, 0.08, 2.2, 0.08, 0, 1.45, 0));                       // tall stem
    const leaves = Math.max(2, Math.min(8, m.paths.length));
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2, y = 0.8 + (i / leaves) * 1.4;
      const l = mesh(geo.sphere, leaf, 0.42, 0.07, 0.18, Math.cos(a) * 0.3, y, Math.sin(a) * 0.3); l.rotation.y = -a; l.rotation.z = 0.35; t.g.add(l);
    }
    const n = Math.min(m.items.length, 12);
    for (let i = 0; i < n; i++) {                                                        // buds spiral up the top third
      const it = m.items[i]!, a = i * 2.4, y = 1.9 + (i / Math.max(1, n)) * 0.7;
      const c = it.state === 'completed' ? mat('#ffffff', { emissive: 0x222222 }) : it.state === 'in_progress' ? mat('#ffd23f', { emissive: 0x6b4f00 }) : mat('#9ac26b');
      const s = it.state === 'completed' ? 0.2 : 0.14;
      t.g.add(mesh(geo.sphere, c, s, s, s, Math.cos(a) * 0.32, y, Math.sin(a) * 0.32));
    }
    if (m.status === 'done') {                                                           // certified: big bloom on top
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; t.g.add(mesh(geo.sphere, owner, 0.32, 0.08, 0.2, Math.cos(a) * 0.36, 2.65, Math.sin(a) * 0.36)); }
      t.g.add(mesh(geo.sphere, mat('#f2c230'), 0.24, 0.18, 0.24, 0, 2.68, 0));
    }
    if (t.hand) { t.g.remove(t.hand); t.hand = undefined; }
    if (m.status === 'blocked' || m.roadblocks.length) {
      t.hand = new THREE.Sprite(iconMat('✋')); t.hand.scale.setScalar(0.6); t.hand.position.set(0.55, 2.6, 0); t.g.add(t.hand);
    }
  }

  /** Sway; blocked tasks droop. */
  update(time: number, mo: number) {
    for (const t of this.items.values()) {
      const droop = t.status === 'blocked' ? 0.28 : 0;
      t.g.rotation.z = droop + Math.sin(time * 1.1 + t.id) * 0.03 * mo;
      const k = Math.min(1, (time - t.born) / 0.8); t.g.scale.setScalar(0.2 + 0.8 * (1 - Math.pow(1 - k, 3)));
    }
  }

  /** Task id under the ray, if any. */
  pick(ray: THREE.Raycaster): number | undefined {
    const hit = ray.intersectObjects(this.group.children, true)[0];
    if (!hit) return undefined;
    for (const t of this.items.values()) { let o: THREE.Object3D | null = hit.object; while (o) { if (o === t.g) return t.id; o = o.parent; } }
    return undefined;
  }

  private drop(id: number, t: TP) { this.group.remove(t.g); this.labels.remove(t.label); this.items.delete(id); }
}
```

If `Labels.add('', …)` with empty text misbehaves, pass the initial text instead. In that case compute `text` before creating the label.

- [ ] **Step 4: Wire into `world.ts`.**
  - Import `layoutTaskPlants`, `TaskPlants`, `taskModels`, `currentTaskOf`, `taskCardHtml`.
  - Add the fields `private tasks!: TaskPlants; private hoverEl = document.createElement('div');`.
  - In the constructor, after `this.actors = …`: `this.tasks = new TaskPlants(this.scene, this.labels); this.hoverEl.hidden = true; host.appendChild(this.hoverEl);`.
  - At the end of `onUpdate` (after `this.actors.sync(...)`):

```ts
    const models = taskModels(u.snapshot);
    this.tasks.sync(models, layoutTaskPlants(this.layout, models), this.time);
```

  - In `frame()`, after `this.field.update(t, mo);`, add `this.tasks.update(t, mo);`.
  - In the `if (gl) { … }` pointer block, add hover:

```ts
      gl.domElement.addEventListener('pointermove', (e) => {
        const r = gl.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, this.camera);
        const id = this.tasks.pick(ray);
        const m = id !== undefined && this.snap ? taskModels(this.snap).find((x) => x.id === id) : undefined;
        if (!m) { this.hoverEl.hidden = true; return; }
        this.hoverEl.hidden = false;
        this.hoverEl.innerHTML = taskCardHtml(m, this.snap.at);
        const card = this.hoverEl.firstElementChild as HTMLElement; card.classList.add('hover');
        card.style.left = `${Math.min(innerWidth - 380, e.clientX + 16)}px`; card.style.top = `${Math.max(8, e.clientY - 40)}px`;
      });
      gl.domElement.addEventListener('pointerleave', () => { this.hoverEl.hidden = true; });
```

  - Add the lookup:

```ts
  taskPlantPos(handle: string) { const t = this.snap ? currentTaskOf(this.snap, handle) : undefined; return t ? this.tasks.posOf(t.id) : undefined; }
```

  - Add `taskPlantPos(handle: string): THREE.Vector3 | undefined;` to `WorldLookup` in `actors.ts`.
  - Make sure `ui/board.css` is loaded on the 3D page too. It's imported by `plan.ts`, which `main.ts` imports, so the `.task-card.hover` styles apply.

- [ ] **Step 5: Gardener label shows the current task** (`actors.ts`, in the loop that sets `text` for each gardener)

```ts
      const cur = currentTaskOf(this.snap, handle);
      const name = group.length > 1 ? `${SHAPES[group.indexOf(handle) % SHAPES.length]} ${handle}` : handle;
      const text = cur ? `${name} · ${cur.title.length > 26 ? `${cur.title.slice(0, 25)}…` : cur.title}` : name;
```

(Import `currentTaskOf` from `../tasks.ts`, and replace the existing `const text = …` line.)

- [ ] **Step 6: Run tests and look**

Run: `cd garden && npm test`. Expected: pass. Then `npm run dev`, `/?source=fake&speed=2`. Watch:
- trisha's task plant appears in front of `src` with the signpost "Refactor the API routes · trisha"
- buds change color as items progress
- alex's plant shows ✋ and droops at step 5
- the bloom appears at the end
- hovering a task plant shows the card
- gardener tags read "trisha · Refactor the API routes"

Check performance: `?debug=1`, `__garden.bench()`, fps similar to before.

- [ ] **Step 7: Commit and push**

```bash
git pull --rebase && git add garden/src/layout.ts garden/src/layout.test.ts garden/src/scene/taskPlants.ts garden/src/scene/world.ts garden/src/scene/actors.ts && git commit -m "garden: task plants with signposts, checklist buds, roadblocks, hover card" && git push
```

---

### Task 8: Spirits replace bees, with live thought bubbles (P4 · Trisha)

**Files:**
- Modify: `garden/src/scene/actors.ts` (`makeBee` → `makeSpirit`, bee map → spirits with bubbles)

**Interfaces:**
- Consumes: `WorldLookup.taskPlantPos(handle)` (Task 7), `Labels.add/setText/remove`.
- Produces: none.

- [ ] **Step 1: Write the failing test** (`garden/src/spiritText.test.ts`; the bubble text is pure, so test it)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spiritText } from './scene/spiritText.ts';

test('spirit bubble: action + file basename, ≤24 chars, fallback to action', () => {
  assert.equal(spiritText('read', 'mcp/src/time.ts'), 'read time.ts');
  assert.equal(spiritText('search', undefined), 'search');
  assert.ok(spiritText('edit', 'a/very/long/path/some_really_long_file_name.test.ts').length <= 24);
  assert.equal(spiritText('Explore', undefined), 'Explore');
});
```

Run: `cd garden && npm test`. Expected: FAIL (module missing).

- [ ] **Step 2: `garden/src/scene/spiritText.ts`**

```ts
/** Text in a spirit's thought bubble: what it is doing right now, short enough to read in 3D. */
export function spiritText(action: string, path: string | undefined): string {
  const s = path ? `${action} ${path.split('/').filter(Boolean).pop()}` : action;
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
}
```

Run tests → pass.

- [ ] **Step 3: Replace the bee model and behavior in `actors.ts`**

```ts
function makeSpirit(color: string): Mover {
  const m = new Mover(4.5);
  const body = mesh(geo.sphere, mat('#fffaf0', { emissive: new THREE.Color(color).multiplyScalar(0.35).getHex() }), 0.2, 0.22, 0.2, 0, 0.2, 0);
  m.obj.add(body);
  for (const sx of [-1, 1]) m.obj.add(mesh(geo.sphere, mat('#1c1c1c'), 0.035, 0.045, 0.02, sx * 0.06, 0.24, 0.18)); // eyes
  const hat = mesh(geo.cone, mat('#58a24a'), 0.16, 0.2, 0.16, 0, 0.46, 0); m.obj.add(hat);                       // leaf hat
  m.obj.add(mesh(geo.sphere, mat(color, { emissive: new THREE.Color(color).multiplyScalar(0.6).getHex() }), 0.06, 0.06, 0.06, 0, 0.6, 0)); // glow tip in owner colour
  return m;
}
```

Change the `bees` map type to `Map<string, { obj; m; seed; parent; handle; returning; bubble: HTMLElement; text: string }>` (drop `trail` and `trailPos`). In `sync`, where a bee is created:

```ts
        const m = makeSpirit(this.memberColor(a.handle));
        const start = this.world.taskPlantPos(a.handle) ?? this.bots.get(a.parentSessionId ?? '')?.obj.position ?? this.home(a.handle);
        m.obj.position.copy(start).setY(0.6);
        this.scene.add(m.obj);
        const bp = new THREE.Vector3();
        const text = spiritText(a.currentAction, a.currentPath);
        const bubble = this.labels.add(text, () => bp.copy(m.obj.position).setY(m.obj.position.y + 0.9), 'bubble spirit');
        b = { obj: m.obj, m, seed: m.obj.position.x, parent: a.parentSessionId ?? '', handle: a.handle, returning: false, bubble, text };
        this.bees.set(a.sessionId, b);
```

After `b.returning = false;`, update the bubble and target:

```ts
      const text = spiritText(a.currentAction, a.currentPath);
      if (text !== b.text) { b.text = text; this.labels.setText(b.bubble, text); }
      b.m.target.copy((a.currentPath ? this.world.plantPos(a.currentPath) : undefined) ?? this.world.taskPlantPos(a.handle) ?? this.home(a.handle)).setY(0.35);
```

In `tick`, the returning branch flies home to the task plant:

```ts
        const home = this.world.taskPlantPos(b.handle) ?? this.bots.get(b.parent)?.obj.position;
        if (!home) { this.dropBee(id, b); continue; }
        b.m.target.copy(home).setY(0.6);
        if (b.obj.position.distanceToSquared(b.m.target) < 0.25) { this.fx.burst(b.obj.position, 0xfff1a8, 10, 0.8, 1.5); this.dropBee(id, b); continue; }
```

Replace the bee wing/trail animation with a hop:

```ts
      b.m.step(dt, true);
      b.obj.position.y = Math.max(b.obj.position.y, 0.15) + Math.abs(Math.sin(t * 6 + b.seed)) * 0.18 * mo; // hop
```

`dropBee` becomes: `this.scene.remove(b.obj); this.labels.remove(b.bubble); this.bees.delete(id);`. Delete `makeBee`. Import `spiritText`.

- [ ] **Step 4: Run tests and look**

Run: `cd garden && npm test` → pass. Then `npm run dev`, `/?source=fake&speed=1&step=2`, and press → (next step):
- a spirit in trisha's color hops from her task plant to `src/db.ts`
- its bubble reads `read db.ts`
- it returns and pops at the next step

Live: start a real `claude` subagent ("use a subagent to list files"). A spirit appears with the live action.

- [ ] **Step 5: Commit and push**

```bash
git pull --rebase && git add garden/src/scene/actors.ts garden/src/scene/spiritText.ts garden/src/spiritText.test.ts && git commit -m "garden: subagent spirits with live thought bubbles (replace bees)" && git push
```

---

### Task 9: Demo script for tasks (P2 · Manahil)

**Files:**
- Modify: `demo/DEMO_SCRIPT.md`, `demo/PITCH.md`, `demo/BACKUP.md`

**Interfaces:** none (docs).

- [ ] **Step 1: Update the run.** In DEMO_SCRIPT.md:
  - **Step 2:** change A's prompt to end with: `Fence mcp/src/ with sprout claim_files first (task: "Add untilText helper"), then set_checklist with your plan. Don't run the tests yet.`
  - **Step 2, "Garden":** "A's **task plant** appears in front of the `mcp` bed with the signpost *Add untilText helper · manahil*, and its buds fill as the checklist moves."
  - **Step 3, "Garden":** "a **spirit** in A's color hops from the task plant to `companion` files; its bubble shows what it's doing (`search hookMap.ts`)."
  - **Step 4:** "B's task plant gets ✋ and droops."
  - **Step 6:** "the **task plant** blooms."
  - **Step 1** narration: add *"Every plant out front is a task someone's agent named; hover one and you see its checklist and what each agent and spirit is doing right now. Press P for the team board."*
  - **Setup:** add one row, "N opens the board once (`P`) to check it's legible, then closes it."

- [ ] **Step 2: Pitch.** In PITCH.md, in the 3-minute version's four call-outs, add *"Tasks, not files: each plant out front is a task an agent named, with its live checklist."* In the Q&A "usefulness vs spectacle" answer, lead with *"Press P: a per-person task board with what needs attention on top."*

- [ ] **Step 3: Backup shot list.** In BACKUP.md, change shot 6 to "spirit hops out and back (bubble readable)", and add a shot "board (P) full screen, 5s".

- [ ] **Step 4: Commit and push**

```bash
git pull --rebase && git add demo/ && git commit -m "demo: task plants, spirits, board in the script and pitch" && git push
```

---

## Self-review notes (plan author)

- **Spec coverage:**
  - §3 concept: Tasks 6, 7, 8.
  - §4 data: Tasks 1, 2.
  - §5 MCP: Task 3.
  - §6 companion: Task 4.
  - §7 garden: Tasks 5–8. Ground cover is already done by the existing LOD (`LOD_LIMIT = 80` turns quiet file plants into tufts), so no new task.
  - §8 demo: Task 9.
  - §9 cut: Task order matches must/should/nice.
  - §10 tests: listed per task.
  - §11 Q1: Task 4, step 1 (headless check done: no to-do tool in `-p`). Q2 (privacy wording in PROJECT_CONTEXT §12) needs team OK: Trisha adds one line, "task titles and to-do items: short agent-written summaries, masked for secrets". Q3: done tasks kept, collapsed on the board, at most 6 done plants in 3D.
- **Ruling: `claim_files` calls `claimFiles` first, then `startTask`.** The spec said `startTask` then `claimFiles`. Reversing it means a fence conflict never leaves an orphan task. Cost if wrong: a successful claim whose `startTask` fails reports the fence without a task (the message says so).
- **Ruling: `set_checklist` (MCP) is added**, because the to-do hook is unverified in headless mode. Both paths call the same reducer.
- **Ruling: `submitEvidence` falls back to the current task** when no task path covers the file, so a bloom always lands on a task.
