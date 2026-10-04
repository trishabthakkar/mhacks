# Garden life pass: design

Owner: Trisha (P4). Scope: `garden/**`, plus the `claim_files` / `set_checklist` wording and a title tidy in `mcp/src/tools.ts` (Trisha cleared this with the team; it is noted in `status/P4.md` for Manahil). No `shared/`, CONTRACT, `module_bindings` or companion changes. This is the second pass after `2026-10-04-garden-visual-polish-design.md`.

## Goal

The garden should feel alive, and every visible thing should answer "what is this" the same way:

- every pickable thing gives the same hover cues
- people move around the whole garden
- every teammate's Claude is always visible, awake or asleep
- the garden is lit at night
- what the Claudes write (task names, checklist items) reads well, both at the source and on screen

## What Trisha saw, and the cause

| Observation | Cause |
|---|---|
| File plants in beds: no hover highlight | The hover ring is drawn at y=0.33, inside the soil mounds (top ≈0.58). Plants are hit-tested on a flat y=0.3 plane, which drifts for tall plants and plants on mounds. |
| Task pots show "the whole thing" on hover | `setHover` puts the full `taskCardHtml` in the tooltip for tasks. |
| Dark at night | The sky and sun follow the local clock (`world.ts` ~254), but there are no lamps. |
| Gardeners never roam | `idleSpot` only moves them ±1.5 along their home lane. |
| Bots vanish | Dormant sessions are filtered out (`actors.ts` ~308), and members with no Claude session have no bot. |
| Writing is weak | Titles come from the agent's `claim_files task:` argument as written; checklist items are cut mid-word at 80 chars (companion `todoText`). |

## §1 Uniform picking and highlighting

**Plant hit test.** A pure `pickColumn(origin, dir, cols)` in `pick.ts`:

- Each plant is a vertical cylinder: `{path, x, z, r, y0, y1}`.
  - `y0` is the soil top (0.45 in raised beds, 0 on stones).
  - `y1 = y0 + height`, where height comes from the plant's stage size; a folded or small plant uses 0.6.
- The function returns the column whose cylinder the ray enters first (smallest t).
- `pickAt` gains an optional `plant?: string` input from this column test, which replaces the ground-distance plant search. People, then task pots, still win first, as today.

**Ring height.**

- `pickPos` gives a plant ring the plant's soil-top y + 0.03.
- Rings for beds, the pond and others keep 0.33.
- The ring is drawn with `depthTest: false` and `renderOrder: 10`, so soil or leaves never hide it.

**Plant glow.**

- `PlantField.setHighlight(path | null, level)` brightens that instance's colour by `level`: 0.35 on hover, 0.55 when selected.
- The old colour is restored when the highlight moves.
- Hover and selection can both be set; selection wins on the same plant.

**Task pots.**

- Hover: a one-line tooltip plus a ring, like every other pick.
  - Format: `hoverText` gives `<title> · <handle> · <done>/<n> done`.
  - Without items: `<title> · <handle> · <status>`.
- The full card appears only in the inspector (already `taskCardHtml`) after a click.
- The `task` branch with `innerHTML` and `card.hover` in `setHover` is removed.

## §2 Bots: always visible, asleep when idle

**Pure `botFor(snap, handle): { agent?: AgentView; asleep: boolean }`** in a new `src/bots.ts`:

- The candidates are that member's `kind: 'claude'` agents.
- Pick the awake one first, by rank: `working` > `waiting` > `blocked` > `needs_review` > `idle`. Ties go to the latest `lastSeen`.
- If nothing is awake, pick the latest dormant one.
- If there are no agents, `agent` is undefined.
- `asleep` is true when there is no agent, when the status is `idle` or `dormant`, or when the member is offline or paused (`memberStatus`).

**Actors.**

- Bots are keyed by **handle**: one per member, always.
- `agentPos(sessionId)` maps the session to its handle's bot.
- Spirits (subagents) whose parent session belongs to a member fly back to that member's bot.

**Asleep look.**

- Position: the bot goes home (`home + OFF_BOT_HOME`).
- Body: lowered to y 0.18 and tilted forward ~0.25 rad, breathing with scale.y `1 + 0.03·sin(1.4t)`.
- Face: eyes squashed to slits (scale.y 0.25).
- Antenna tip: unlit.
- Icon: a "z" sprite that rises and fades on a 2.5 s loop (three staggered sprites from one shared material).
- Calm mode and reduced motion: no breathing or rising; the z's stay static.

**Awake.** Behaviour is unchanged.

**Hover text.**

- Asleep: `trisha's Claude · asleep · last active 2h ago` (or `· no session yet`).
- Awake: `trisha's Claude · working on routes.ts`.
- Bots become pickable as `member` (the owner). No new `Pick` kind is needed: clicking a bot shows its member.

## §3 Gardeners roam the whole garden

**Pure `roamSpot(t, seed, spots): {x, z, face: {x, z}}`** in `wander.ts`:

- `spots` is a list of places to visit: the front edge centre of each bed (+0.9 in front of it), the pond rim (nearest point toward the garden centre), each task pot (+0.9), the arch (inside, 1.5 m back) and the shed door.
- Hold time per stop is 6–12 s, from `hash2(k, seed)`.
- Consecutive stops are never the same spot.
- Two seeds rarely share a stop at the same time: the spot index is offset by seed.

**Who roams.**

- An idle gardener: not working, not blocked or waiting, member not offline or paused.
- They walk (nav paths) to `roamSpot` and face `face` while stopped.
- In calm mode or reduced motion they use the old `idleSpot` near home.

**Other cases.** Working, blocked and waiting gardeners behave exactly as today. Offline gardeners stay home, as today.

**Data.** `World` builds the spot list when the layout rebuilds and passes it to `Actors` through `WorldLookup.roamSpots`.

## §4 Garden lights at night

**Pure `src/lamps.ts`.**

- `lampSpots(fence: GardenFence, paths: Array<{x, z, w, d}>, shed: {x, z}): Lamp[]` (paths are the gravel `PathLayout` strips):
  - fence posts every ~6 m (never inside the gate gap)
  - two on the arch posts
  - path lights every ~4 m along the long axis of each gravel strip, alternating sides, inside the fence only
  - one by the shed door
  - Each lamp is `{x, z, kind: 'post' | 'arch' | 'path' | 'shed', real: boolean}`; `real` is true for the two arch lamps, the shed lamp and the post nearest each back corner (max 4).
- `lampLevel(hour)`: 0 by day, ramping 18.5→20 to 1, holding through the night, and ramping down 5.5→6.5.

**`scene/lamps.ts`.**

- Instanced lantern bodies: posts and caps share the fence material colour; a glass bulb is an `InstancedMesh` with `MeshStandardMaterial` emissive `#ffcf7a`, intensity `2.2·level`, so bloom catches it.
- At most 4 `PointLight`s (distance 9, decay 2, intensity `6·level`), no shadows.
- A soft additive glow sprite (one shared texture) under each lamp on the ground.
- The lamps are hidden when level = 0.
- At `quality=low`: bulbs only, no point lights or glow.

**Time.** `?hour=<0–24>` overrides the clock for the sky and lamps, for screenshots and rehearsal.

## §5 Better writing

**MCP (`mcp/src/tools.ts`).**

- `claim_files.task` describe text and tool description gain a short style guide:
  - start with a verb
  - sentence case
  - name the feature, not the file
  - ≤ 60 chars
  - no trailing period
  - Good: "Add retry to the upload client". Bad: "working on src/api/upload.ts", "Fixing stuff.".
- `set_checklist` gets the same rules for items, plus "one step per item, ≤ 50 chars".
- New pure `tidyTitle(s)` (exported from `mcp/src/tidy.ts`, tested in `mcp/src/tidy.test.ts`):
  - collapse whitespace
  - strip wrapping quotes or backticks
  - drop a trailing `.` (but keep `…`, `?`, `!`)
  - capitalise the first letter (unless it starts with a code-ish token: contains `/`, `.`, `_`, `(` or camelCase)
  - It never rejects.
- Applied to the claim task title and checklist item text before saving.
- The existing length, secret and empty checks run on the tidied text.

**Garden (`ui/fmt.ts`).**

- `tidy(s)` mirrors `tidyTitle`. It is duplicated rather than shared, because `shared/` needs team sign-off.
- `clipWords(s, n)` cuts at the last word boundary ≤ n and adds `…`.
- Used for task titles, checklist items and `blockedReason` everywhere the garden shows them: the task card, plan, tooltips, inspector and gardener labels. The gardener label uses `clipWords(title, 22)`.

**Garden copy pass.**

- Tooltips, inspector headings and activity sentences (`ui/sentences.ts`) are read once for plain language.
- Fix anything that leaks code-speak:
  - `blocked_edit` becomes "was stopped by a fence"
  - raw status words become plain verbs
  - "needs_review" becomes "waiting for review"
- Existing tests are updated to the new text.

## Build order (each step is a commit and leaves the demo working)

1. §1 picking
2. §2 bots
3. §3 roaming
4. §4 lights
5. §5 writing

If time runs out, later steps are dropped, never half-merged.

## Testing

**Unit tests (node:test, beside the code):**

- `pickColumn`: nearest along the ray, a tall plant behind a short one, a miss over soil.
- `pickAt`: plant input priority (below people and tasks, above the pond and beds).
- `hoverText` for a task: the one-line format.
- `botFor`: rank order, dormant fallback, no agents, offline means asleep.
- `roamSpot`: never the same spot twice in a row, deterministic, holds 6–12 s.
- `lampSpots`: none in the gate gap, at most 4 real; `lampLevel` at 12, 19.25, 23, 6.
- `tidyTitle` / `tidy`: whitespace, quotes, trailing period, code-ish first word.
- `clipWords`: boundary and ellipsis.

**Gates:** `npm test` and `npm run build` in `garden/`; `npm test` in `mcp/`.

**Visual:** headless screenshots of `?source=fake&step=14&paused=1`, the same with `&hour=21`, and `?bench=120&hour=21`.

**Performance:** `__garden.bench` at bench120 with `hour=21`; the lights may add ≤ 1.5 ms (swiftshader) over day. If they cost more, point lights drop to 2.

## Out of scope

Weather, seasons, new module data, companion changes, character models for bots.
