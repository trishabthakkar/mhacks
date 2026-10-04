# Task garden: tasks as plants, subagent spirits, a readable board

_Spec, Sat Oct 3 2026, ~6:50pm. Author: P2 (Manahil). Status: **draft for team review**. Touches CONTRACT.md and `shared/`, so it needs the whole team's OK before anyone builds it._

## 1. Why

Today the garden draws one plant per file (241 for our repo). Besides path, size, stage and bugs, a plant tells you nothing. Nobody can look at the projector and answer "what is Seno doing?" The `P` plan view is a top-down map of the same 241 dots, and it's illegible.

The goal: someone glancing at the garden understands **what each person and agent is working on, how far along it is, and what's stuck**.

## 2. Goals (from Manahil, agreed in chat)

1. **See the people and what they're working on**: "seno · refactoring the module", "manahil · setting up the MCP".
2. **See their subagents** as small spirits (junimo-style) in the owner's color, and what each one is doing right now.
3. **Progress and roadblocks**: visible on the plant, plus a hover card with the task overview, a checklist, and live per-agent activity.
4. **A legible `P` board** that replaces the illegible file map.

Constraints:
- No workflow change.
- No prompt text leaves a laptop.
- It has to land before the 4:30am cut.
- It must keep every existing real signal: fences, butterflies, botanist, bugs, rain.

**Task names come from the agent (decision (a)).** When Claude fences files with `claim_files`, it must name the task in a few words. Its built-in to-do list becomes the checklist. Both are short, agent-written summaries: the same privacy class as a commit message, never prompt text.

## 3. Concept (approach A: a task is a plant)

| In the team | In the garden |
|---|---|
| A task ("Add untilText helper") | One **task plant**, tall, in the owner's color, planted in the bed of its main folder, with a **signpost**: `Add untilText helper · manahil` |
| Checklist items (Claude's to-do list) | **Buds** on the task plant: closed = pending, glowing = in progress, open flower = done |
| Files the task touches | **Leaves** on the task plant (count). The file plants themselves become low, muted **ground cover**, highlighted when you hover their task |
| Task certified by the botanist | The task plant **blooms** (big flower and petals) |
| Roadblock (blocked edit, botanist refusal, failing tests, status `blocked`) | **Red ✋ marker** and a drooping plant; failing tests still show **bugs** |
| Fence on the task's files | Fence around the task plant in the owner's color (existing fence logic) |
| Main Claude Code session | The existing bot beside its gardener; the gardener's name tag shows the current task title |
| Subagent | A **spirit**: small glowing round creature with a leaf hat, owner's color. It hops from the task plant to the file it is touching, with a tiny live thought bubble (`read time.ts`, `grep "expiry"`), then flies home and pops when it stops. **Replaces the bees.** |
| Message / handoff / commit | Unchanged: butterfly, watering can, rain |

### Hover / click card on a task plant

```
Add untilText helper                      ● working
manahil · started 6:52pm · fenced mcp/src/ until 7:22pm
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  2 / 3
 ✓ Read time.ts
 ▸ Add untilText()          (in progress)
 ○ Run mcp tests
Files: mcp/src/time.ts, mcp/src/tools.ts
Roadblocks: ✋ Botanist refused: no passing test run seen after your last edit
Live:
 🤖 main     editing mcp/src/time.ts           · 4s ago
 ✨ spirit   grep "expiry" in companion/src     · now
```

### The new `P` board (replaces the file map)

- **Top strip, "Needs attention":** one chip per open problem: blocked edits, botanist refusals, failing tests, messages waiting for delivery or ack, open handoffs. Click a chip to jump to the task in 3D.
- **One column per member** (Seno, Manahil, Shriya, Trisha):
  - header: color dot, online/offline, what their main agent is doing right now
  - then their task cards: the hover card above, compact
  - done (🌸) tasks collapsed at the bottom
- At least 16px type, high contrast, no SVG map, readable from the back of a room.
- Keyboard: `P` toggles the board, arrows move between cards, `Enter` shows the task in 3D.

## 4. Data (P1, contract change)

### New tables (public)

| Table | Fields |
|---|---|
| `task` | `id` u64 auto, `handle`, `title` (≤80), `status` (`active` / `blocked` / `needs_review` / `done`), `bed`, `paths` string[] (≤50), `blockedReason` option string (≤120), `createdAt`, `updatedAt`, `doneAt` option |
| `taskItem` | `id` u64 auto, `taskId` u64, `ord` u32, `text` (≤80), `state` (`pending` / `in_progress` / `completed`) |

**A member's current task** = their most recently updated task that isn't `done`. Agents and subagents belong to their member's current task. There's no per-session task: that keeps it simple, and a person rarely runs two tasks at once.

### New reducers

- `startTask({ handle, title, paths })`. Reuses the member's not-done task with the same title (case-insensitive), otherwise inserts a new one. Sets `bed` from the first path's top-level folder (`(root)` for root files). Merges `paths`. Sets it `active` and touches `updatedAt`, which makes it current.
- `setTaskItems({ handle, items: { text, state }[] })`. Replaces the items of the member's current task (≤20 items). If the member has no current task, it creates one titled with the first `in_progress` item, or else the first item.

### Automatic transitions, inside existing reducers

- **edit/create activity** by the member: add the path to the current task's `paths` (cap 50, dedupe). If the task was `blocked` by a fence, set it back to `active`.
- **`blocked_edit` activity in block mode** (detail starts with `fenced by`): current task becomes `blocked`, with `blockedReason` = the detail ("fenced by manahil until 7:22pm"). In warn mode (detail `warned`) the edit went ahead, so the status doesn't change.
- **`reportStatus`** `working` / `blocked` / `needs_review` → current task `active` / `blocked` / `needs_review`.
- **`submitEvidence` bloom** on a path in a not-done task of that member → task `done`, `doneAt` set.
- **`submitEvidence` refused** → `blockedReason` = "Botanist refused: <reason>"; status stays (it's a roadblock, not a stop).
- `blockedReason` is cleared whenever the task goes back to `active` or becomes `done`.

`shared/types.ts` gets `TaskView` and `TaskItemView` with ms timestamps. `shared/fake-data.ts` gets two or three tasks with items, so the fake garden shows them (integrator).

## 5. MCP (P2)

- `claim_files(paths, task, ttl_minutes?)`: **`task` becomes required.** It's a few words naming the work ("Add untilText helper"). The tool calls `startTask` then `claimFiles`. The description says: name the task in the user's terms, no secrets, max 80 chars.
- `team_status` lists each member's not-done tasks: title, status, items n/m, roadblock. Example: `manahil: "Add untilText helper" working 2/3`.
- `report_status` is unchanged in shape; the module moves the current task's status as described above.
- Tests: required `task`, `startTask` called before `claimFiles`, the `team_status` task lines. TEAM_RULES.md says "name the task when you claim files".

## 6. Companion (P3)

- **Verify first (~10 min):** which tool Claude Code 2.1.288 uses for its to-do list (`TodoWrite`, or `TaskCreate` / `TaskUpdate`) and the PostToolUse `tool_input` shape. Add the payload to `HOOK_PAYLOADS.md`.
- Map that PostToolUse to `setTaskItems` with the full list. Each `text` is capped at 80 chars and run through the existing secret masking. Asynchronous, fails open.
- No other hook changes: subagent tool calls already update their agent row's `currentAction` / `currentPath` under the derived session id. That's what the spirit bubbles show.

## 7. Garden (P4)

In priority order. Each step is shippable on its own.

1. **Board** (`ui/plan.ts` rewrite, kept in the same file): columns, task cards, Needs attention strip. Biggest legibility win; works even before task plants exist.
2. **Task plants + signposts + hover/click card:** deterministic placement in the task's bed (layout function gets tasks as input; add a layout test). Leaves = path count, buds = items, bloom when `done`, ✋ and droop when `blocked`.
3. **Spirits replace bees:** junimo-style mesh, owner's color, hop parent task plant → `currentPath` plant, live bubble from `currentAction` (truncated to 24 chars), pop on stop.
4. **File plants become ground cover:** lower and muted, highlighted when their task is hovered.

## 8. Demo impact (P2)

- `demo/DEMO_SCRIPT.md` step 2: A's prompt already says "Fence mcp/src/ with sprout claim_files first". `claim_files` now requires `task`, so the plant appears titled ("Add untilText helper"), and Claude's to-do list fills its buds.
- Step 3: "a spirit hops to `companion` plants and back with a live bubble" replaces "a bee flies off".
- Step 4: B's blocked edit puts ✋ on B's task.
- Step 6: refusal shows on the card. The bloom makes the **task** plant bloom.
- The new talking point: *"Every plant here is a task someone's agent named, with its live checklist; hover it and you see exactly what each agent and subagent is doing right now."*

## 9. Cut plan and timeline

| By | What | Who |
|---|---|---|
| 8:30pm | `task` / `taskItem` + `startTask` / `setTaskItems` + transitions, smoke, published, bindings regenerated | P1 |
| 8:30pm | `claim_files(task)`, `team_status` tasks, tests, deployed | P2 |
| 9:00pm | to-do hook → `setTaskItems` | P3 |
| 10:30pm | new board | P4 |
| 1:00am | task plants + card | P4 |
| 3:00am | spirits | P4 |
| 4:30am | **cut:** if task plants aren't solid, ship the board + card on the existing file plants and keep the bees | all |

**Must:** task table + `startTask` + `claim_files(task)` + board + hover card.
**Should:** checklist from the to-do hook, task plants, spirits.
**Nice:** ground cover, leaves per path.

## 10. Testing

- P1: smoke.sh cases for every transition in §4 (start/reuse, items replace, blocked_edit → blocked → edit → active, bloom → done, refused → reason).
- P2: tool tests on the fake db (above); live run through Claude Code against the local module.
- P3: hookMap test with the real to-do payload fixture.
- P4: layout test (task plant placement deterministic, no overlap with file plants); board render test on fake data (columns, Needs attention chips).
- End to end: `scripts/e2e.sh` gains asserts for a task row with items, and for the task status after block and bloom.

## 11. Open questions

1. To-do tool name and payload in Claude Code 2.1.288: P3 verifies first (§6). If the hook can't see the to-do list, the checklist is cut and the cards show files and activity only.
2. Privacy wording: PROJECT_CONTEXT §12 should add "task titles and to-do items: short agent-written summaries, masked for secrets". Needs team OK.
3. Do `done` tasks stay as bloomed plants all weekend (nice for the timelapse) or fade after 3h? Proposal: keep them, but collapse them on the board.
