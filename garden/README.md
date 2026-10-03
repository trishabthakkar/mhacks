# Sprout garden (P4)

The 3D garden, the shed noticeboard and the flat garden plan. Reads everything live from SpacetimeDB (no API layer).

```bash
cd garden && npm ci && npm run dev      # http://localhost:5173
npm test                                 # tsc + unit tests
npm run build && npm run preview         # production bundle
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

Parameters: `source=fake` (offline timeline) · `step=N` freeze on timeline frame N (0..14) · `paused=1` · `speed=N` · `loop=0` · `present=1` projector mode · `badge=0` hide the demo label · `shot=full|bed-src|botanist|plan` repeatable screenshot camera · `quality=low` · `debug=1` fps + `window.__garden` · `bench=300` synthetic garden · `nogl=1` simulate no WebGL.

## Keys

Press `?` in the page. Short version: drag orbit, arrows/Q/E/+/- camera, `1 2 3` views, `F` reframe, `D` director, `P` plan, `S` shed, `C` cue strip, `H` hide UI, `L` plant labels, `B` expand all plants, `M` calm, `K` contrast, `Space` and `←/→` step the demo timeline.

## Cue strip (`C`)

Eight pills for the demo steps (PROJECT_CONTEXT.md section 13). Each turns yellow then green as the events that prove it arrive (claim, blocked_edit, message delivered, certify_refused, test_pass, certify_bloom…). Click a pill to tick it by hand, `reset` between runs.

## Structure

- `src/data/` Store (snapshot + change events), fake timeline, live SpacetimeDB source, benchmark data.
- `src/scene/` world, camera rig, plant field (instanced), actors (gardeners, bots, bees, butterflies, botanist), effects (labels, particles).
- `src/ui/` shed, plan view, cue strip, sentences, screenshot shots.
- `src/layout.ts` pure deterministic bed/plant layout.
- `scripts/shots.md` named screenshot states.

Generated `src/module_bindings` is never hand-edited (P1 runs `npm run gen`).
