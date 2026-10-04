# Sprout garden (P4)

The 3D garden, the shed noticeboard and the flat garden plan. Reads everything live from SpacetimeDB (no API layer).

```bash
cd garden && npm ci && npm run dev      # http://localhost:5173
npm test                                 # tsc + unit tests
npm run build && npm run preview         # production bundle (≈ 270 KB gzip in 3 chunks)
# hosting on the VM: see ../infra/README.md → "Garden" (infra/deploy-garden.sh)
```

## URLs (the garden dev server at `http://localhost:5173`)

| What | URL |
|---|---|
| The real team garden (live) | `/` (default db `sprout-mhacks`) |
| Demo run (live, rehearsal database) | `/?db=sprout-demo` |
| Projector mode on the demo db | `/?db=sprout-demo&present=1` |
| Closing shot: seasons timelapse | `/?mode=timelapse&db=sprout-mhacks&present=1` (phase 8) |
| Backup if the venue network dies | `/?source=fake&present=1` (clean fake timeline, loops) |
| Backup, no "demo data" label | `/?source=fake&present=1&badge=0` (hides the label; only use it if you say it is a recording) |
| Another host/db | `/?host=wss://…&db=name` |

Parameters: `source=fake` (offline timeline) · `step=N` freeze on timeline frame N (0..14) · `paused=1` · `speed=N` · `loop=0` · `present=1` projector mode · `badge=0` hide the demo label · `shot=full|bed-src|botanist|plan` repeatable screenshot camera · `quality=low` · `debug=1` fps + `window.__garden` · `bench=300` synthetic garden · `nogl=1` simulate no WebGL · `repo=<name>` name on the arch sign (default: the newest test run's repo folder, else the db name without `sprout-`) · `timelapse=1` open straight into the seasons timelapse (30 s autoplay) · `tasks=current` draw only each person's current task pot (hides leftover open tasks; use it for the demo) · `me=<handle>` makes the "since you were last here" card personal (remembered in this browser) · `since=90` preview that card as if your last visit was 90 minutes ago · `hour=21` preview any time of day (sky, moonlight and the garden lamps, which fade on at dusk) · `ao=0` / `bloom=0` turn off ambient occlusion / bloom (`quality=low` turns off all post-processing and contact shadows).

## Keys

**Click anything** (plant, bed, gardener, botanist, task pot, pond or lily pad, the arch) to inspect it in the shed; hover for a one-line tooltip and a ring (plants also glow); `Esc` or ← goes back. A drag never selects. Every teammate always has a bot: awake beside them while their Claude works, asleep at home (z z z) otherwise. Idle gardeners wander the garden; calm mode keeps them home. Two teammates working on the same files get an early warning in the shed (⚠️) and amber dashes between them. Press `R` for the judge tour: a ~40 s fly-through with captions (any key or click stops it). On live data, a card lists what changed since your last visit. In `present=1` the camera slowly circles after a minute without input.

Press `?` in the page. Short version: drag orbit, arrows/Q/E/+/- camera, `1 2 3` views, `F` reframe, `D` director, `P` plan, `S` shed, `C` cue strip, `H` hide UI, `L` plant labels, `B` expand all plants, `M` calm, `K` contrast, `Space` and `←/→` step the demo timeline.

## Cue strip (`C`)

Eight pills for the demo steps (PROJECT_CONTEXT.md section 13). Each turns yellow then green as the events that prove it arrive (claim, blocked_edit, message delivered, certify_refused, test_pass, certify_bloom…). Click a pill to tick it by hand, `reset` between runs.

## Structure

- `src/data/` Store (snapshot + change events), fake timeline, live SpacetimeDB source, benchmark data.
- `src/scene/` world, camera rig, plant field (instanced), actors (gardeners, bots, bees, butterflies, botanist), effects (labels, particles).
- `src/ui/` shed (attention strip, Team / Activity tabs, inspector: `shed.ts`, `attention.ts`, `inspect.ts`), plan view, cue strip, sentences, screenshot shots.
- `src/pick.ts` pure picking (what is under the pointer); `src/boundary.ts` pure garden fence + arch repo name; `src/scene/post.ts` AO + bloom with a plain-render fallback.
- `src/layout.ts` pure deterministic bed/plant layout.
- `scripts/shots.md` named screenshot states.

Generated `src/module_bindings` is never hand-edited (P1 runs `npm run gen`).
