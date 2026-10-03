# Garden frontend plan (P4)

Everything the garden still needs, phase by phase, in the order to run it. Each phase is a self-contained prompt: when you say "run phase N", the prompt in that phase is the full instruction.

Written Sat Oct 3 ~7pm. Feature freeze is Sun 10:30am; Devpost deadline is Sun 12:15pm EDT.

## 0. Where we are (so nothing gets rebuilt)

Already built and verified in the browser (fake timeline and live `sprout-demo`):

- Data layer: `Store` (snapshot + per-table inserted/updated/deleted events), `fake.ts` (loops `makeFakeSnapshots`), `spacetime.ts` (live source, reconnect with backoff, 10s timeout then demo fallback).
- Layout: pure deterministic `layout.ts` (6 tests).
- Scene: beds, glass greenhouse, plants by stage with bugs and droop, gardeners (walk and kneel), bots, bees, butterflies, fences, rain on commit, botanist, sky by hour.
- Overlays: shed noticeboard, plan view (P), director mode (D), follow a member, reframe (F), hide UI (H), `?debug=1` fps.

Known gaps this plan closes: see the "Gap list" at the bottom.

## Rules for every phase

1. Edit only `garden/**` (never `garden/src/module_bindings`). If a phase needs something in `shared/`, `spacetimedb/`, `companion/` or `mcp/`, do not edit it: write it under "Contract requests" in `status/P4.md` and continue with a stub.
2. Verify in the browser before calling a phase done: `?source=fake` for deterministic checks and `?db=sprout-demo` for live ones. Take a screenshot at each acceptance point and read it.
3. Gate before every commit: `cd garden && npm test` (tsc + tests) must pass, and the browser console must show no errors.
4. Commit per phase (`garden: phase N <name>`), then `git pull --rebase && git push`. Update `status/P4.md` after each phase.
5. Keep 60 fps on a laptop. If a change drops fps below 50 with `?debug=1`, fix it in the same phase.
6. Never break the fallback: if the live connection fails the page must still show the demo timeline with the badge.
7. Do not stop between phases. If a phase is blocked, record why in `status/P4.md`, skip to the next one, and come back.

## Phase table

| # | Phase | Priority | Est. | Depends on |
|---|---|---|---|---|
| 0 | Test harness and deterministic controls | Must | 40 min | none |
| 1 | Camera and framing | Must | 50 min | 0 |
| 2 | The botanist moment | Must | 60 min | 0, 1 |
| 3 | Labels, bubbles and declutter | Must | 50 min | 1 |
| 4 | World art pass | Should | 90 min | 0 |
| 5 | Performance and scale | Must | 70 min | 4 |
| 6 | Interaction fidelity | Should | 80 min | 4 |
| 7 | Shed noticeboard and plan view upgrade | Must | 60 min | 3 |
| 8 | Seasons timelapse | Should | 80 min | 5 |
| 9 | Resilience and states | Must | 50 min | 0 |
| 10 | Presentation and demo tooling | Must | 50 min | 1, 2, 7, 9 |
| 11 | Build and host | Should | 40 min | 9 |
| 12 | QA, accessibility and design review | Must | 70 min | all |
| 13 | Figma design (optional, design prize) | Nice | 60 min | 7 |

Total about 14 hours of scope; phases 0 to 3, 5, 7, 9, 10 and 12 are the must-haves (about 8 hours). If time runs short, cut in this order: 13, 8, 6, 4, 11.

---

## Phase 0: Test harness and deterministic controls

Why: later phases need repeatable screenshots and regression tests, and today the scene can only be checked by waiting for the loop.

Prompt:

```
Phase 0 of garden/PLAN.md. In garden/ only.

1. Add URL controls to the fake source (garden/src/data/fake.ts, main.ts):
   ?source=fake&step=N   freeze on timeline step N (0..FAKE_STEPS) and never advance
   ?source=fake&paused=1 start paused; Space toggles pause; ArrowRight/ArrowLeft step forward/back one frame
   ?speed=N              already exists; keep it
   Stepping backward must not replay history (use store.set(frame, true) as reset).
2. Expose window.__garden (only when ?debug=1): { store, world, setStep(n), snapshot(), fps }, so a browser tool can drive and inspect the scene.
3. Unit tests (tsx --test, add to `npm test`): 
   - store.ts: inserted/updated/deleted events per table, reset emits no events, newActivity only for new ids.
   - sentences.ts: every ActivityKind in shared/constants.ts returns a non-empty string (iterate ACTIVITY_KINDS so a new kind fails the test).
   - spacetime.ts mapping: extract the row -> view mapping into a pure function and test it with a hand-built row (optional fields absent, not undefined).
4. Add `garden/scripts/shots.md`: the list of named states to capture, each as a URL: bare-soil (step=0), fence-up, blocked-edit, message-in-flight, botanist-refuse, bloom, post-commit, full-garden (step=FAKE_STEPS).
Acceptance: `npm test` green; each shots URL renders the described state (screenshot each and read it); window.__garden works.
Commit: "garden: phase 0 harness".
```

## Phase 1: Camera and framing

Why: the camera starts too far out, gardeners on the outer ring go off-screen, and the shed panel covers part of the scene on a projector.

Prompt:

```
Phase 1 of garden/PLAN.md. Files: garden/src/scene/world.ts (+ a new garden/src/scene/camera.ts).

1. Fit-to-frame: compute the bounding box of beds + gardeners + botanist home and place the camera so all of it is visible at the current aspect ratio, leaving room for the shed panel (shift the view with camera.setViewOffset or move the target so the scene is centered in the area NOT covered by the shed). Re-run when the layout grows (new bed) unless the user has orbited manually; a "reframe" (F) always re-fits.
2. Pull the gardener home ring in (extent + 1.5 instead of +3) and place homes on the side facing the camera so none are behind beds or off-screen.
3. Smooth camera moves: ease transitions (reframe, follow, director) with critically damped motion; no snapping.
4. Keyboard camera: arrow keys or WASD pan, Q/E orbit, +/- zoom, 1/2/3 presets (overview, top-down, low angle). Document in the on-screen key hint.
5. Projector mode: ?present=1 hides the key hints and debug, increases base label font size 1.25x, and auto-enables director mode.
6. Clamp zoom/orbit so the camera never goes under the ground or inside the fog wall.
Acceptance (screenshots at 1280x720 and 1920x1080 and 800x600): every gardener, bot and all beds visible at fit; shed panel does not cover any bed; F always recovers a good view; keyboard controls work.
Commit: "garden: phase 1 camera".
```

## Phase 2: The botanist moment

Why: the prompt calls this the moment judges remember. It is currently quick and easy to miss.

Prompt:

```
Phase 2 of garden/PLAN.md. Files: garden/src/scene/actors.ts (botanist), world.ts, effects.ts, index.html CSS.

Sequence for certify_refused and certify_bloom (queue them; never overlap):
1. Cue (0.0s): botanist leaves the greenhouse/home and walks to the plant; other gardener motion continues. Dim the rest of the scene slightly (vignette or light dip) and pin a soft spotlight on the target plant.
2. Camera (0.5s to 1.5s): ease in to a close 3/4 shot of the plant and botanist (about 4 units away), then restore the previous camera on completion. Skip the camera move if the user is manually orbiting or director mode is off and ?present is not set.
3. Hold (about 4s total, up to 5s for refusals so the reason can be read):
   - refused: botanist shakes head (existing), a LARGE bubble (min 18px, max width 360px) with a red border and the reason broken into one line per missing item; the bud stays closed and gets a small wobble. Optional: a small 'locked' padlock icon above the bud.
   - bloom: botanist nods, the bud opens over about 1s (petals scale out in sequence, not a pop), a burst in the flower color, a soft glow ring on the ground, bubble in green "Bloom certified" with the task text.
4. Return: botanist walks home; camera and lighting restore.
5. If three or more certifications arrive within 10s, only animate the newest two and just update the shed for the rest.
6. The plant visual must change at the moment of the bloom animation, not when the data arrives: hold the bloom stage visual back until the botanist reaches the plant (data is already in the store; animation drives the swap), with a 6s safety timeout.
Acceptance (use ?source=fake&step=9..13 and the sim): the refusal and the bloom are each readable from a screenshot taken mid-hold; no overlap with other bubbles; the camera returns; two quick certifications queue correctly.
Commit: "garden: phase 2 botanist".
```

## Phase 3: Labels, bubbles and declutter

Why: name labels, bed labels and speech bubbles overlap when several things happen at once; labels can render over the shed panel.

Prompt:

```
Phase 3 of garden/PLAN.md. Files: garden/src/scene/effects.ts (Labels), actors.ts, index.html CSS.

1. Label manager with priorities: bubble > member name > bed name > botanist tag. Each frame, project labels to screen, sort by priority, and nudge lower-priority labels away from overlaps (vertical stacking with leader lines for bubbles, hide bed labels that collide when zoomed out).
2. Clamp labels and bubbles to the visible scene area (not under the shed panel or the key hints). If a gardener is off-screen, show an edge arrow with their name pointing to them.
3. Bubble lifecycle: queue at most 3 visible bubbles; new ones replace the oldest with a quick fade; every bubble has a pointer tail to its owner.
4. Distance scaling: labels shrink slightly with distance and fade beyond a limit; never below 11px (readability).
5. Offline members: no gardener, but keep the name in the shed only.
6. No per-frame DOM thrash: cache sizes, write transforms only when changed by more than 0.5px.
Acceptance: at ?source=fake&step=7 (message in flight, fence, blocked edit) and a stress case with 8 members, no label overlaps another; none sits under the shed panel; fps unchanged.
Commit: "garden: phase 3 labels".
```

## Phase 4: World art pass

Why: this is what judges see on the projector. Stylized low-poly, warm, readable.

Prompt:

```
Phase 4 of garden/PLAN.md. Files: garden/src/scene/* (new world art files allowed). Keep every object procedural (no downloaded assets) and cheap.

1. Ground: soft vertex-color gradient meadow with subtle noise, a worn path network connecting beds (flat lighter strips along bed edges and between beds; gardeners and bots should prefer walking along them), rounded island edge fading into fog.
2. Beds: wooden border planks with corner posts, darker tilled soil with row furrows, a small wooden sign per bed with the name (replace the floating bed label when zoomed in; keep the label when zoomed out).
3. Greenhouse (tests bed): proper frame, translucent panes, a small door; plants visible through glass.
4. Garden shed: a small 3D shed at the edge of the island with a noticeboard prop that mirrors the HTML shed (fence count, open requests as little paper notes). Click it to toggle the shed panel.
5. Props: a few trees, rocks, tufts of grass, a well or bench, scattered butterflies and fireflies at dusk (decorative, clearly different from message butterflies: gray-white and tiny, no glow).
6. Characters: gardeners with arms and a tool each state uses (watering can for edit, magnifier for read, clipboard for search, hammer for bash), simple walk cycle (arm swing, bob), kneel pose; bots with treads/wheel spin, antenna blink, state icon above (zzz idle, ! waiting, gear working); bee wing blur and a faint trail.
7. Lighting and sky: golden-hour key light with soft shadows, hemisphere fill, sky gradient dome with sun disc and a few low-poly clouds, hour-of-day palette (dawn, day, golden hour, dusk, night) with a minimum brightness so night stays readable.
8. Palette: define one cohesive palette in garden/src/scene/palette.ts; member colors stay distinguishable (check each of MEMBER_COLORS against the ground and soil).
9. Add a ?quality=low|high URL option; low disables shadows and props for weak laptops.
Acceptance: before/after screenshots of the full-garden shot; readable at 1280x720; fps >= 55 at ?quality=high on this Mac with 60 plants.
Commit: "garden: phase 4 art".
```

## Phase 5: Performance and scale

Why: the contract says 60 fps with 300 plants and instanced meshes; today each plant is its own group of meshes.

Prompt:

```
Phase 5 of garden/PLAN.md. Files: garden/src/scene/plantMesh.ts, world.ts, effects.ts.

1. Replace per-plant Groups with InstancedMesh pools per part type (mound, stem, leaf, petal, bud, center, bug), per-instance transform and color via instanceMatrix/instanceColor. Plant state changes update instance slots; no mesh creation or disposal at runtime.
2. Animation without per-object work: wind sway and pop-in computed in a small vertex shader (onBeforeCompile) or by updating only dirty instance matrices at a throttled rate.
3. Pooled particles (bursts, rain, pollen): preallocate N Points objects, reuse; no new BufferGeometry in steady state.
4. Remove per-frame allocations in tick paths (reuse Vector3s; no clone() in loops); verify with the Chrome performance tool or a heap check that steady state allocates ~0.
5. Large repos: only plants active in the last 30 minutes (or non-seed, non-dormant) are full plants; others render as low ground cover (single instanced tuft per plant). A bed shows a count badge "+N more". Clicking a bed or pressing B expands it temporarily.
6. Benchmark route ?bench=300 and ?bench=1000 that fills the store with synthetic plants and activity; log frame time stats to the console. Targets: 300 plants >= 58 fps; 1000 plants >= 45 fps on this Mac.
7. DPR cap 2, shadow map 2048 only for the key light, frustum culling on, fog on.
Acceptance: benchmark numbers recorded in status/P4.md; visual parity with phase 4 screenshots at 60 plants.
Commit: "garden: phase 5 perf".
```

## Phase 6: Interaction fidelity

Why: several behaviors in PROJECT_CONTEXT.md section 4 are not drawn yet or read ambiguously.

Prompt:

```
Phase 6 of garden/PLAN.md. Files: actors.ts, world.ts, store/sentences as needed.

1. Handoff: when a handoff row appears (status offered), the sender's gardener walks to the receiver, a small watering can and a seed tag (showing the task text on hover/bubble) pass hands; accepted: tag is planted at the receiver's bed with a small sprout; declined: tag returns, tiny sad cloud.
2. Fence lifecycle: fences fade in when created, show a countdown ring or color fade as expiresAt approaches, and drop with a short animation on release; a claim on a single file draws a small ring, a folder draws the full fence.
3. Walking: gardeners and bots follow the path network between beds (waypoints), not straight lines through plants; they avoid each other (simple separation).
4. Meeting at the gate on blocked_edit: both stop facing each other with small gesture animation; bubble from the blocked bot; resolved after the timeout.
5. Dormant plants: desaturate and fade; wake animation when activity returns. Plants with bugs droop and the bugs scatter on pass (exists); add a warning icon over a plant with 3+ bugs.
6. Waiting bot: raised sign with permission icon; the gardener looks at the bot.
7. Many members: handle 8 to 12 members (home positions on an arc), and members with identical colors (module cycles colors) get a distinguishing shape/initial on the label.
8. Subagent bees: trail, buzz in orbit while working, return to parent bot with a small bow at the end.
9. Test pass/fail: pass shows a green sparkle ring over the gardener; fail shows a red puff.
Acceptance: each behavior visible in a screenshot from the fake timeline or the sim; add a debug route ?source=fake&scenario=handoff to trigger the handoff animation (fake data can't emit it today, so add a local-only synthetic event; do not edit shared/).
Commit: "garden: phase 6 behaviors".
```

## Phase 7: Shed noticeboard and plan view upgrade

Why: the shed and plan view are the everyday-use views and the accessibility story.

Prompt:

```
Phase 7 of garden/PLAN.md. Files: garden/src/ui/shed.ts, plan.ts, index.html CSS, main.ts.

Shed:
1. Collapsible panel (button + S key), remembers state in localStorage (try/catch), responsive: becomes a bottom sheet under 900px wide.
2. Sections stay: gardeners, fences, open requests, botanist, happening now. Add: handoffs (offered/accepted), test status (last run per member, pass/fail), and a per-member inbox count.
3. Fence rows show a countdown; requests show age ("2m, waiting for delivery"); certifications show time and the reason as a list.
4. Live feed is an ARIA live region (polite), new lines animate in, hover pauses; filter chips (all, claims, messages, tests, botanist).
5. Click a gardener/plant/fence row focuses the camera on it and highlights it with a pulse ring in the scene.
6. Show data freshness: a small "updated 2s ago" and the connection state.

Plan view:
1. Pan/zoom with wheel and drag; fit button; legend of stage glyphs; search box to find a file; click a plant to focus it in 3D and open its detail card (stage, bugs, last touched by, last diff, last bloom).
2. Show claims, agents, bugs, blocked edits (red X), messages in flight (arrows between members).
3. Print-friendly CSS for a Devpost screenshot.
Acceptance: keyboard-only use works end to end (Tab order, Enter activates, Esc closes); screenshots at 800x600, 1280x720.
Commit: "garden: phase 7 shed and plan".
```

## Phase 8: Seasons timelapse

Why: the closing shot of the demo, "bare soil at noon Saturday to full bloom at submission". Theme fit.

Prompt:

```
Phase 8 of garden/PLAN.md. Files: new garden/src/data/timelapse.ts, ui/timeline.ts, world.ts, main.ts.

1. Data: read the whole activity table (not just the last 200 rows) and certification/diff/commit rows; build a replay model that reconstructs plant stages over time from activity order (create -> seed, any activity -> sprout, edit -> growing, diff -> bud, certify_bloom -> bloom, certify_refused -> stays bud). It approximates; label it "replay".
2. Player: ?mode=timelapse (works on ?db=sprout-mhacks and ?source=fake). Controls: play/pause, scrub bar with time labels, speed (1x, 10x, 60x, 600x), "Play 30s" button that maps the full history to 30 seconds of playback. Space toggles; keys 1..4 pick speed.
3. Visuals: season color grading by progress (bare soil/early spring -> lush summer -> golden bloom), sky time follows the replayed timestamp, flowers open as certify_bloom events pass, rain on commits, fences appear and disappear. Gardeners appear as they first join.
4. Live mode and replay share the same scene: replay writes snapshots into the Store at a fixed rate. Leaving replay returns to live.
5. Edge cases: empty log shows a friendly message; huge logs (>20k rows) are downsampled by time bucket.
Acceptance: on the fake timeline and on sprout-demo (which has history), the 30s autoplay runs from bare soil to full bloom smoothly at >= 50 fps; screenshots at 0%, 50%, 100%.
Commit: "garden: phase 8 timelapse".
```

## Phase 9: Resilience and states

Why: venue wifi, bad data and weak machines must not leave a blank screen on stage.

Prompt:

```
Phase 9 of garden/PLAN.md. Files: data/spacetime.ts, main.ts, ui, index.html.

1. Connection banner with states: connecting (spinner), live, reconnecting (with attempt count), fallback to demo data (keep the badge), and a "retry live" button. Never block the scene.
2. Auto switch: if live drops for more than 15s, keep showing the last known state (dimmed slightly) rather than clearing; on reconnect re-sync without replaying history as new events.
3. Empty states: no plants -> friendly "no files planted yet: run sprout join" panel; no members; no events.
4. Data hardening: long paths and unicode names truncated with ellipsis and full text in title/aria; unknown stage/status/kind values degrade to a safe default instead of throwing; NaN lines.
5. WebGL failure or very low fps (< 20 for 5s): automatically switch to the plan view with a notice (and ?quality=low suggestion).
6. Error boundary: uncaught errors show a small toast and keep running; errors logged with a ring buffer visible at ?debug=1.
7. prefers-reduced-motion and a manual "calm mode" toggle (M) that lowers motion and removes camera moves; high-contrast option (K) that outlines labels and uses text for all status.
8. Color-blind safety: never rely on color alone (stage text/icons, fence labels, shapes for bug counts).
Acceptance: simulate each failure (offline in devtools, bad host, throw in a handler); the page stays usable; document in status/P4.md.
Commit: "garden: phase 9 resilience".
```

## Phase 10: Presentation and demo tooling

Why: P2's DEMO_SCRIPT has two `TODO(P4)` items, and the stage run needs one-key control.

Prompt:

```
Phase 10 of garden/PLAN.md. Files: main.ts, ui, plus garden/README.md (new) and a note for demo/DEMO_SCRIPT.md TODOs in status/P4.md (do NOT edit demo/ - it's P2's).

1. URL presets: ?present=1 (projector: big labels, director on, hide hints), ?db=sprout-demo (demo run), ?mode=timelapse&db=sprout-mhacks (closing shot). Write the exact URLs for the garden dev server and for a hosted build in garden/README.md and in status/P4.md under "For P2: DEMO_SCRIPT TODO(P4)".
2. Presenter hotkeys with an on-screen cheat sheet on ?: P plan, D director, S shed, T timelapse, F reframe, H hide UI, G grid/guides, 1-4 camera presets, B expand bed, Space pause (fake), R reload live.
3. "Cue" overlay (toggle with C, off by default): a small floating strip showing the next demo step name from the 8-step script (static list in code) so the narrator can follow along; highlights when a matching event happens (claim, blocked_edit, message_sent/delivered/acked, certify_refused, test_pass, certify_bloom, commit).
4. Screenshot mode: H hides all UI; ?shot=NAME applies a fixed camera for named shots (full, bed-src, botanist, plan) so Devpost screenshots are repeatable.
5. Backup helper: ?source=fake&loop=1&present=1 plays the clean fake timeline as a stand-in if the live connection dies on stage (this is the "backup" P2 wants), with the demo badge hidden only if ?badge=0 (default shows it, to stay honest).
Acceptance: each preset URL works from a fresh tab; cue strip follows a sim run correctly.
Commit: "garden: phase 10 presentation".
```

## Phase 11: Build and host

Why: the projector can run `npm run dev`, but a hosted build lets teammates and judges open it, and survives a laptop sleeping.

Prompt:

```
Phase 11 of garden/PLAN.md. Files: garden/vite.config.ts, package.json, README. Infra edits are the integrator's (infra/, scripts/): this phase is allowed to touch infra/ because the same person owns both.

1. `npm run build` must pass with the production bundle under ~1.5 MB gzip (code-split three; lazy-load timelapse and plan view). Fix any build-only type or import problems.
2. Base path: support serving at / and at /garden/ via `VITE_BASE`.
3. `npm run preview` smoke: open the built app against ?source=fake and ?db=sprout-demo.
4. VM hosting: add a Caddy `handle /garden/*` static file server block to infra/setup-vm.sh (idempotent), an `infra/deploy-garden.sh` that builds locally and rsyncs `garden/dist` to the VM, and runbook lines in infra/README.md. Do not run anything against the VM without asking me (needs the SSH details).
5. Environment: VITE_STDB_HOST / VITE_STDB_DB baked at build time with sane defaults; ?host=&db= still override.
Acceptance: `npm run build` and `npm run preview` work locally; the VM steps are written and syntax-checked (`bash -n`), clearly marked "not yet run on the VM".
Commit: "garden: phase 11 build and host".
```

## Phase 12: QA, accessibility and design review

Prompt:

```
Phase 12 of garden/PLAN.md.

1. Full regression: `npm test` in shared, garden, companion, mcp; `bash scripts/e2e.sh` (17/17 expected); the benchmark routes; the shots list from Phase 0 captured and read.
2. Viewport matrix: 1920x1080, 1366x768, 1280x720, 1024x768, 800x600, 375x812 (mobile preset). Fix overlaps, clipped panels, unreadable text.
3. Run the design:accessibility-review skill on the shed, plan view and cue strip (WCAG 2.1 AA: contrast, keyboard, focus order, aria-live, touch targets) and fix every finding.
4. Run the design:design-critique skill on three screenshots (full garden, botanist moment, plan view) and apply the top five suggestions that fit the time.
5. Soak test: sim.ts with --loop for 20 minutes; memory and fps must stay flat (check JS heap before/after).
6. Update status/P4.md: what is done, benchmark numbers, known issues, and a one-page "how to run the garden for the demo".
7. Capture Devpost screenshots (named shots) into garden/screenshots/ (commit them).
Commit: "garden: phase 12 QA".
```

## Phase 13 (optional): Figma design for the design prize

Needs the Figma connector authorized; skip if it isn't.

Prompt:

```
Phase 13 of garden/PLAN.md. Only if the Figma MCP is connected (tell me if it is not and skip).

Design the shed panel, the plan view and the botanist bubble in Figma using the garden palette (garden/src/scene/palette.ts) and the CSS tokens in index.html: components, states (empty, loading, live, error), light surfaces over the 3D scene. Then align the HTML/CSS to the Figma frames (spacing, type scale, radii) and record the Figma link in status/P4.md for the Devpost "Best Design" entry.
Commit: "garden: phase 13 figma alignment".
```

---

## Gap list (everything flagged so far, mapped to phases)

| Gap | Phase |
|---|---|
| Camera starts too far out; some gardeners off-screen | 1 |
| Shed panel covers part of the scene | 1, 7 |
| Keyboard camera controls | 1 |
| Botanist moment too quick, bubble easy to miss, no camera push | 2 |
| Plant bloom visual should land when the botanist arrives | 2 |
| Labels and bubbles overlap | 3 |
| Plants are not InstancedMesh; 300-plant target untested | 5 |
| Pooled particles and per-frame allocations | 5 |
| Ground cover / "only recently active files are full plants" for large repos | 5 |
| Handoff watering can and seed tag | 6 |
| Fence expiry visual and release animation | 6 |
| Characters are basic; tools and walk cycle | 4, 6 |
| Gardeners walk straight lines through plants | 6 |
| Many members (8+) and duplicate member colors | 6 |
| Dormant plant visuals and wake animation | 6 |
| World looks plain (ground, paths, props, shed, sky) | 4 |
| Shed and plan view polish, accessibility, focus-on-click | 7 |
| Seasons timelapse | 8 |
| Connection states, empty states, bad data, WebGL failure | 9 |
| Reduced motion, calm mode, color-blind safety | 9 |
| DEMO_SCRIPT `TODO(P4)` URLs (garden URL, timelapse URL) | 10 |
| Backup if the network dies on stage | 10 |
| Build and host the garden | 11 |
| Soak test, viewport matrix, a11y audit, Devpost screenshots | 12 |
| Figma-first design for the design prize | 13 |

## Definition of done for the whole plan

- All must-have phases (0 to 3, 5, 7, 9, 10, 12) merged and pushed, `status/P4.md` current.
- `npm test` green in `garden/`; `bash scripts/e2e.sh` still 17/17.
- The 8-step demo (PROJECT_CONTEXT.md section 13) is readable from the garden alone on a projector, live on `sprout-demo`, with the timelapse close on `sprout-mhacks`.
- 60 fps with 60 plants and 58+ with 300 on this Mac; no console errors in a 20-minute soak.
- A recorded-state fallback (`?source=fake&loop=1&present=1`) exists in case the venue network fails.
