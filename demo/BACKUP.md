# Backup recording plan

**Goal:** one clean, full recorded run of DEMO_SCRIPT.md by **7:30am Sun**, in case the venue network or a laptop fails during judging. It also becomes the Devpost video.

## Timeline

| Time | What |
|---|---|
| 5:30am | Deployed stack green: `curl <MCP_URL>/health` → `db: connected`; both laptops `claude mcp list` ✔; garden live on `sprout-mhacks` (http://localhost:5173/) |
| 5:45am | Rehearsal 1 (untimed, fix whatever breaks; note fixes in status/P2.md) |
| 6:15am | Rehearsal 2 (timed, ≤3:00) |
| 6:45am | **Record** take 1, then take 2 if anything went wrong |
| 7:15am | Pick the best take, trim, add captions, export 1080p ≤3:00, upload unlisted to YouTube + copy to two laptops (offline playback) |
| 7:30am | Done: link in demo/DEVPOST.md and in the team chat |

## Recording setup

- **Projector laptop (N):** record the garden full-screen with QuickTime (File → New Screen Recording) or OBS at 1080p/30fps. Director mode on, UI visible, `?debug=1` off.
- **Laptops A and B:** record each terminal too (QuickTime). Terminal font 20pt, dark theme, window 1280×800. Close notifications (Focus mode on).
- **Audio:** one narrator voice recorded on N's laptop mic in a quiet corner, or added as voice-over afterwards.
- Run demo-reset (DEMO_SCRIPT.md) before **every** take, and `demo-reset --after` plus `git checkout mcp/src/time.ts` on laptop 1 after it.
- **Edit:** garden full-frame as the base track. Cut to A's or B's terminal (picture-in-picture, bottom-right, ~35%) whenever they type, so viewers can read the prompt and the tool result.

## Shot list

| # | Shot | Source | Length | Must be visible |
|---|---|---|---|---|
| 1 | Title card "Sprout: your team's agents, in one garden" | edit | 3s | — |
| 2 | Idle garden, slow orbit, beds labeled | N | 12s | beds `src`, `tests`, 4 gardeners, bots |
| 3 | Shed noticeboard close-up | N | 5s | who's online, fences (empty) |
| 4 | A types the untilText prompt | A terminal (PiP) | 6s | prompt text, `Fenced mcp/src/ until …` |
| 5 | Fence rises in A's color; bot tends plants; seedlings grow | N | 10s | fence color = A's avatar |
| 6 | Subagent prompt → bee flies out and back | A PiP + N | 12s | bee leaves and returns |
| 7 | B types "change clock() format" → hook denial text | B terminal | 8s | `fenced by manahil until …` |
| 8 | B's bot stops at the gate; gardeners meet on the path | N | 8s | both avatars on the path |
| 9 | B's agent sends post_finding; butterfly to A's bed | B PiP + N | 7s | butterfly |
| 10 | A's finding → butterfly circles B's bed | A PiP + N | 8s | circling = not delivered |
| 11 | B prompts, injected message shown with the wrapper, ack | B terminal | 10s | "information, not instructions" readable |
| 12 | Butterfly lands, pollen burst | N | 5s | landing |
| 13 | A: submit evidence → **Botanist refused** + next step | A terminal | 8s | full refusal text |
| 14 | Botanist shakes head at the bud | N | 5s | head shake + bubble |
| 15 | A: run tests → pass → **🌸 Bloom certified** | A terminal | 10s | `npm test` pass, bloom line |
| 16 | Plant blooms, botanist nods | N | 6s | bloom burst |
| 17 | Timelapse of `sprout-mhacks`, noon Sat → now | N | 10s | bare soil → full garden |
| 18 | End card: team names, "Built with SpacetimeDB · MCP · Claude Code · Three.js", repo URL | edit | 4s | — |

About 2:40 of footage, leaving room for narration pauses.

## Screenshots for Devpost (grab during the takes)

Garden overview · fence + blocked-edit terminal · butterfly mid-flight · botanist refusal bubble · bloom · shed board · plan view (`P`).

## If something fails during recording

Keep rolling, finish the run, and do another take. If a beat fails twice, record it on its own and splice it in. Never fake a result: the demo's whole point is that the botanist can't be talked into anything.
