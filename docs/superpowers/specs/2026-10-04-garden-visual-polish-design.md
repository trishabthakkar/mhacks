# Garden visual polish: design

Owner: Trisha (P4). Scope: `garden/**` only (no `shared/`, CONTRACT, or `module_bindings` changes). Time box: ~12 h before the demo.

## Goal

The garden must work for both audiences equally:

- **Projector / judges:** reads from across the room, has a clear "this is our garden" identity, looks lit and grounded rather than flat.
- **Teammates day to day:** anything visible can be hovered and clicked to answer "what is this, who is on it, is anything wrong".

Problems today (seen in headless screenshots of `?source=fake` and `?bench=120`):

1. Almost nothing is interactive: only task pots hover and the 3D shed clicks.
2. The shed panel is a cluttered stack of six text sections; empty sections take as much space as full ones; it is hard to see what needs attention.
3. No boundary or identity: beds float on an endless meadow, nothing names the repo.
4. Flat lighting: hard shadows, nothing grounded, no depth.

## Build order (each step is its own commit and leaves the demo working)

1. Picker + inspector (§1, inspector part of §2)
2. Shed redesign (§2)
3. Boundary + repo sign (§3)
4. Lighting + post-processing (§4)
5. Polish (§5)

If time runs out, later steps are dropped, never half-merged.

## §1 Picking and selection

**New `scene/picker.ts`** owns hit-testing. Priority order: gardeners and botanist → task pots → plants → pond lily pads → beds → 3D shed → arch (§3). Instanced plants map instance id → path via `PlantField`. Hedges (folded `module_bindings`) pick as their hedge key.

```ts
type Pick =
  | { kind: 'plant'; key: string }   // file path
  | { kind: 'bed'; key: string }     // bed name
  | { kind: 'member'; key: string }  // handle
  | { kind: 'botanist' }
  | { kind: 'task'; key: number }    // task id
  | { kind: 'pond' }
  | { kind: 'commit'; key: number }  // activity id of the commit
  | { kind: 'garden' }               // the arch / repo sign
  | { kind: 'shed' };
```

- **Hover:** a highlight on the picked object (emissive tint for meshes; a slightly scaled highlight copy for an instanced plant) and a small tooltip (name + one line, e.g. `routes.ts · growing · trisha 3m ago`). This replaces the task-only hover; a task pot still shows its full task card. The cursor becomes a pointer over anything pickable.
- **Click** (pointer moved ≤ 5 px): sets `world.selected`. The camera eases toward it (`rig.flyTo`, no follow lock), a ground ring marks it, a plant does one bounce, and the shed opens on the inspector. Clicking the 3D shed keeps today's behaviour (toggle the panel).
- **Clear:** Esc, a click on empty ground, or the inspector back arrow. If the selected object disappears from the snapshot (e.g. the file was deleted), the selection clears.
- Hover picking is throttled to one raycast per animation frame.

## §2 Shed redesign

`ui/shed.ts` is rewritten; its CSS moves from `index.html` into `ui/shed.css`. The pure HTML builders live in new `ui/attention.ts` and `ui/inspect.ts`; every agent-written string is escaped.

**Header:** 🌱 Garden shed · connection dot (green live, amber demo/reconnecting, with the text as its accessible name) · collapse button.

**Needs attention** (`attention(s): AttentionItem[]`, pure, ranked, max 3 shown, each one a button that selects its subject):

1. blocked edit (activity `blocked_edit` in the last 10 min)
2. refused botanist verdict newer than the last bloom on that path
3. latest test run for a member failed
4. fence expiring within 5 min
5. message undelivered for ≥ 5 min
6. handoff offered, not accepted

Empty → one line "All quiet 🌿".

**Tabs:** Team | Activity. The selected tab is remembered in `localStorage` (wrapped in try/catch).

- **Team:** one card per member: a colour stripe, name, status pill (working / idle / blocked / offline / paused), one "what" line (action + file basename), badges (✉ unread, ✓/✗ last test, 🔒 fence count, `+N helper`; a click expands the existing `agentRows`). Clicking the card selects the member. Offline members fold into "+N offline".
- **Activity:** an "Open now" group pinned at the top (fences with countdowns, open requests grouped as today, offered handoffs, the last 3 botanist verdicts), shown only when non-empty. Below it: filter chips on one row, then the feed. Each feed row has a kind icon, the sentence and a relative time. Consecutive events with the same kind, handle and path collapse into "×N". A row with a path selects that plant.

**Inspector** (replaces the tabs while something is selected; back arrow + title). `inspectHtml(pick, snapshot): string`:

- **plant:** full path, stage pill + seed→bloom track, lines, bugs, last toucher + when, fence (owner, countdown), last botanist verdict, last 5 events on the path
- **bed:** folder, file count, stage breakdown bar, fences in it, people active in it (last 30 min), the 5 most recently active files (clickable)
- **member:** the current task card (`taskCardHtml`), bot + helpers, unread messages, last test, last 5 events
- **botanist:** last 5 verdicts with reasons
- **task:** `taskCardHtml`
- **pond / commit:** today's commits newest first (commit highlights its row)
- **garden:** repo name, member / plant / bloom counts, stage breakdown

The render-signature + hover-defer logic stays, so the panel does not churn under the pointer. The phone bottom sheet and present-mode sizing keep working.

## §3 Boundary and repo sign

**Pure `src/boundary.ts`** (tested): from the layout, pond spot and home frame, compute the fence rectangle (with margins covering beds, pond, shed and the gardeners' lane), the picket positions, and the gate gap centred on the front lane.

**`scene/boundary.ts`:**

- a white picket fence: one `InstancedMesh` for pickets plus merged rails; casts shadows
- an arch over the gate (two posts, a curved beam, a hanging board). The board is a canvas texture: the repo name in large painted letters, then a smaller line `4 gardeners · 37 plants · 3 🌸 today`, redrawn only when those counts change. Pickable as `garden`.

**Repo name**, first that exists:

1. `?repo=` param
2. basename of the latest `testRuns[].repo`
3. db name minus a leading `sprout-`
4. `our garden`

The pure function is `repoName(params, snapshot, db)`.

- **Inside vs outside:** the meadow vertex colours get a slightly lighter, mown tone inside the fence. The tree and tall-grass scatter in `props.ts` lands mostly outside the fence and keeps clear of the fence line.
- **Bed signboards:** painted with a canvas texture big enough to read from the overview. The HTML bed pill shows only with `L` (labels on).

## §4 Lighting and shading

- **Shadows:** the shadow camera is fitted to the fence bounds (not a fixed ±35) and its radius softened.
- **Contact shadows:** soft radial blob quads (one shared texture, instanced) under gardeners, bots, the botanist and task pots.
- **Post-processing** (`scene/post.ts`): `EffectComposer` → `RenderPass` → AO (`GTAOPass`, or `SAOPass` if GTAO costs too much) → `UnrealBloomPass` (high threshold: blooms, the light shaft and fireflies glow) → `OutputPass`. It is off at `?quality=low`. If composer setup throws, it falls back to plain `renderer.render`. The extra bundle size is measured against today's ~270 KB gzip.
- **Light:** the sun is slightly lower and warmer for longer shadows; the hemisphere ground colour is cooler in shadow.
- **Wind sway:** an `onBeforeCompile` vertex offset on the plant field and grass instances, scaled by height, with a per-instance phase and a time uniform. It is off in calm mode and under reduced motion.

## §5 Polish

- Gravel paths end at the fence/gate, not past the beds.
- The top-left keys bar and the demo banner merge into one slim top bar.
- `present=1`: after 60 s without input the camera slowly orbits; any input stops it.

## Testing

- **Unit tests (node:test, beside the code):**
  - `inspectHtml` for each kind, including escaping
  - `attention` ranking and the cap
  - `repoName` resolution order
  - boundary geometry: the gate lines up with the lane; no picket inside a bed, the pond or the lane
  - feed grouping of repeated events
  - the picker's priority order on a stub list of hits
- **Gates:** `npm test`, typecheck and `npm run build` green after every step; bundle size reported.
- **Visual:** headless-Chrome screenshots of `?source=fake&step=14&paused=1`, `?bench=120` and `present=1`, looked at after each step.
- **Performance:** `__garden.bench` before and after §4. If AO costs more than ~2 ms/frame at 120 plants, AO is limited to `?quality=high`.

## Out of scope

Time-of-day lighting, floating 3D popovers, new data from the module, and changes outside `garden/**`.
