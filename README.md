# Sprout

Turns a team's shared codebase into a living 3D garden that blooms as verified work lands. Every teammate and their AI agent appears live; agents message each other, fence files, and a "botanist" only certifies a bloom with real evidence.

Start with [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) (why), [CLAUDE.md](CLAUDE.md) (rules and ownership) and [CONTRACT.md](CONTRACT.md) (data contract).

| Folder | Owner |
|---|---|
| `spacetimedb/` | P1 |
| `mcp/`, `demo/` | P2 |
| `companion/` | P3 |
| `garden/` | P4 |
| `shared/` | everyone (change only by team agreement) |

Node 22, TypeScript, ESM. No npm workspaces: each package has its own `package.json` and lockfile and imports `shared/` by relative path.
