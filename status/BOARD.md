# Board

_Maintained by the integrator at each checkpoint. Status of every must/should/nice item from PROJECT_CONTEXT.md §16, blockers with owners, and the next integration step._

## Team code

(not generated yet)

## Bugs for P1–P4

### P3
- **macOS symlinked paths drop edits (found 5:35pm).** `companion/src/e2e.test.ts` "join → hooks → block / warn / inject" fails on macOS (35/36 pass): `os.tmpdir()` is `/var/folders/...` but `git rev-parse --show-toplevel` returns `/private/var/folders/...`, so `relPath()` (`redact.ts`) sees the file as outside the repo and the PreToolUse hook returns nothing (no block/warn). Passes when `TMPDIR` is a real path. Real users hit it only if their project dir is reached through a symlink, but a fenced file would silently not be fenced. Fix: `realpathSync` both sides in `relPath` / the repo-root lookup.
- Verified live from this Mac against Maincloud `sprout-demo` (handle `p3check`, throwaway): `sprout join`, daemon `connected [spacetimedb]`, session_start/prompt/read/edit/bash/test-pass events landed and render in the garden. Test handle `p3check` is left in `sprout-demo`; P2's demo-reset should remove it.
