# Sprout data contract

Authoritative with the SpacetimeDB module. Summary of PROJECT_CONTEXT.md §8–§9; change only by team agreement.

## Tables (all public)
| Table | Fields |
|---|---|
| `member` | handle (PK), color, online, paused, lastSeen |
| `agent` | sessionId (PK), handle, kind (`claude`/`subagent`), parentSessionId?, status (`working`/`blocked`/`needs_review`/`waiting`/`idle`/`dormant`), currentPath?, currentAction, lastSeen |
| `plant` | path (PK), bed, lines, stage, bugs, lastActivity, lastTouchedBy?, lastDiffAt?, lastBloomAt? |
| `claim` | id, path (file or dir prefix ending `/`), handle, createdAt, expiresAt |
| `message` | id, fromHandle, fromSession?, toHandle, kind (`finding`/`request`/`handoff`/`system`), body (<=500), status (`sent`/`delivered`/`acked`), sentAt, deliveredAt?, ackedAt? |
| `handoff` | id, fromHandle, toHandle, task, notes, status (`offered`/`accepted`/`declined`), createdAt |
| `testRun` | id, handle, repo, command (redacted, <=120), exitCode, at |
| `diff` | id, handle, path, at, commit? |
| `review` | id, path, handle, ok, at |
| `certification` | id, path, handle, task, result (`bloom`/`refused`), reason, at |
| `activity` | id, at, handle, sessionId?, kind, path?, detail (<=160) |
| `config` | key (PK), value — `claimMode`, `claimTtlMinutes`, `requireReview` |

Plant stages: `seed, sprout, growing, bud, bloom, dormant`.

## Reducers
`joinMember`, `setPaused`, `heartbeat`, `seedRepo(files[])`, `ingestActivity(handle, sessionId?, kind, path?, lines?, detail?)`, `recordTestRun`, `recordDiff(paths[], commit?)`, `claimFiles`, `releaseFiles`, `postMessage`, `markDelivered`, `ackMessage`, `offerHandoff`, `respondHandoff`, `reportStatus`, `submitEvidence`, `review`, `setConfig`, scheduled `expireClaims` + dormancy sweeps.

## Activity kinds
See `ACTIVITY_KINDS` in `shared/constants.ts`.

## Rules
- Claim matches a file if equal, or claim ends with `/` and file starts with it. Claiming fails if another member holds an active match.
- Claims expire after TTL (default 30 min) and auto-release on commit.
- `claimMode`: `warn` (default; edit proceeds, `blocked_edit` logged) or `block` (PreToolUse denies with a reason).
- Botanist: bloom needs (1) a diff touching the file since last bloom, (2) a test run with exit 0 after that diff in the same repo, (3) optionally a passing teammate review if `requireReview = 'true'`. See `shared/botanist.ts`.
- Failing test run: plants the member touched since last bloom get `bugs += 1` (cap 5). Passing run clears them.
