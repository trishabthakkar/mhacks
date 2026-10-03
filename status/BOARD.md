# Board

_Maintained by the integrator at each checkpoint. Status of every must/should/nice item from PROJECT_CONTEXT.md §16, blockers with owners, and the next integration step._

## Team code

(not generated yet)

## Bugs for P1–P4

### P3
- **macOS symlinked paths drop edits (found 5:35pm).** `companion/src/e2e.test.ts` "join → hooks → block / warn / inject" fails on macOS (35/36 pass): `os.tmpdir()` is `/var/folders/...` but `git rev-parse --show-toplevel` returns `/private/var/folders/...`, so `relPath()` (`redact.ts`) sees the file as outside the repo and the PreToolUse hook returns nothing (no block/warn). Passes when `TMPDIR` is a real path. Real users hit it only if their project dir is reached through a symlink, but a fenced file would silently not be fenced. Fix: `realpathSync` both sides in `relPath` / the repo-root lookup.
- Verified live from this Mac against Maincloud `sprout-demo` (handle `p3check`, throwaway): `sprout join`, daemon `connected [spacetimedb]`, session_start/prompt/read/edit/bash/test-pass events landed and render in the garden. Test handle `p3check` is left in `sprout-demo`; P2's demo-reset should remove it.


## Audit + rehearsal (Sat 6:20pm, integrator)

`bash scripts/e2e.sh` plays the demo story through the real stack (two companions + local MCP + Maincloud `sprout-demo`; refuses to touch `sprout-mhacks`): join, claim, **blocked edit**, claim conflict names owner, post_finding, **inbox injection with exact wrapper**, delivered, ack, **botanist refuse then bloom**, commit releases the fence. Result: 16 pass, 0 fail, 1 skip.

- **SKIP = P1 must republish.** The deployed module demotes a bloomed plant to `bud` when its commit arrives, and a commit after the passing test pushes `lastDiffAt` past the test (botanist then asks for another test run). Fixed in `spacetimedb/src/index.ts` (`recordDiff`) and `scripts/smoke.sh`, but **not published and smoke not run** (no `spacetime` CLI here). P1: run `bash scripts/smoke.sh`, publish to `sprout-mhacks` and `sprout-demo`, re-run `scripts/e2e.sh`; step 15 should then PASS.
- Fixed: macOS symlink path bug in companion (`relPath`/`repoFor`), Caddyfile `handle` blocks in `infra/setup-vm.sh`, garden duplicate bed labels / dormant-bot pile-up / stale butterflies.
- Test data left in `sprout-demo`: `ivy moss fern reed p3check e2e-a e2e-b` and their plants. Run `demo/demo-reset.ts` before the stage run.
- Known, not fixed: plants never go `dormant` (sweep only covers members/agents); `reqPath` rejects any path containing `..` even inside a filename; MCP has no auth (anyone can send `X-Sprout-Member: <teammate>`); edits repeated within seconds are deduped by the daemon.

### 6:35pm re-check (integrator)

- Seno published the `recordDiff` fix, `removeMember`, and plant dormancy to `sprout-mhacks` + `sprout-demo`. `bash scripts/e2e.sh` is now **17/17 PASS, 0 skip** (twice in a row): a commit no longer un-blooms or moves the evidence clock.
- e2e now uses unique handles per run, self-heals stale `e2e-*` fences/members, and removes its members at the end via `removeMember`.
- All package tests pass: shared 8, mcp 38 (+2 live skipped), companion 37, garden 6, stages 3.
- Open: P3 nit from P1 (a Claude Bash command logs `bash` twice: Pre + Post); a human rehearsal with real Claude Code sessions; second-laptop check of the db; CI workflow still needs adding via GitHub web editor (`infra/ci.yml.pending`).
