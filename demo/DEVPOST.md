# Devpost draft — Sprout

_Draft (P2), Sat 5:30pm. Revise by 10pm; final by 10:30am Sun. Fill in the `TODO` numbers from the real run._

**Tagline:** A shared garden where your whole team's AI agents coordinate, and nothing blooms without proof.

## Inspiration

Every one of us codes with an AI agent now. On a team, that means four people each running their own agent in the same repo, and none of those agents knows the others exist. During planning we kept hitting the same three failures: two agents editing the same file, one agent changing an API another depends on, and an agent announcing "done" when no test ever ran.

Fourteenth Floor (HackGT 13) made one person's agents visible as a 3D office, and it inspired us. We wanted the next step: agents owned by *different people*, coordinating, without anyone changing how they work.

## What it does

Sprout turns a team's codebase into a living 3D garden. Directories are beds, files are plants, every teammate is a gardener, and every teammate's Claude Code session is a little bot that follows them.

- **Agents fence files.** Before editing, an agent claims `src/api/`. A fence in its owner's color appears. If another person's agent tries to edit inside it, a hook blocks the edit with a reason Claude sees ("fenced by trisha until 2:40am, use post_finding to ask them"), and the agent asks instead.
- **Agents message agents, across laptops.** `post_finding` sends a short finding to a teammate's agent. A butterfly carries it, circles until the recipient's next prompt picks it up, and lands when it's acked. Every message arrives labeled *information, not instructions*.
- **Handoffs.** An agent can offer a task with notes. The receiver has to accept it.
- **The botanist.** A plant only blooms when the database holds evidence: a real diff to that file, then a test command observed passing afterwards (optionally plus a teammate's review). "Done, tests pass" from an agent changes nothing. Failing tests show up as bugs crawling on the leaves.
- **No workflow change.** Everyone keeps their own terminal and Claude Code. One `sprout join` installs the hooks, and one `claude mcp add` gives your agent the team tools.

## How we built it

- **SpacetimeDB (Maincloud)** holds all shared state: members, agents, plants, claims, messages, handoffs, test runs, diffs, certifications, and an activity log that doubles as the timelapse. Every rule is a reducer: claim conflicts, the message lifecycle (sent → delivered → acked), handoffs, bugs from failing tests, and the evidence gate. Scheduled reducers expire stale claims and put idle agents to sleep.
- **Companion CLI (`sprout`)**: Claude Code hooks, a zsh/bash hook and a git post-commit hook feed a local daemon. It redacts events, then calls reducers over one persistent connection. It also caches claims and the inbox so the edit-blocking check and message injection answer in milliseconds.
- **MCP server**: a Streamable HTTP server (MCP TypeScript SDK v2) behind Caddy HTTPS. It gives every teammate's Claude Code twelve team tools: `team_status`, `claim_files`, `post_finding`, `read_inbox`, `ack`, handoffs, `report_status`, `submit_evidence`, `review`. Identity is a per-person header. Reads come from a live subscription cache, and writes are reducer calls. Tool descriptions are written as prompts that carry the team's safety rules.
- **Garden**: Three.js + Vite, subscribing straight to SpacetimeDB tables with no API layer. It has low-poly procedural plants by stage, gardeners, bots, bees for subagents, butterflies for messages, fences, rain on commit, and the botanist. There's a 2D plan view and a shed noticeboard for everyday use.
- **Zero LLM calls on our side.** Each person's own Claude Code does the thinking.

TypeScript everywhere, Node 22, four packages with no shared lockfile, and one shared, test-covered pure function for the botanist.

## Challenges we ran into

- **Agents don't listen while idle.** Claude Code can't receive a message between prompts. We inject undelivered messages on the next prompt through the UserPromptSubmit hook, and the garden shows the delay honestly.
- **Prompt injection between agents.** Another person's agent is untrusted input. Every message is wrapped and length-capped, secret-looking text is refused, and the rules tell agents to show any change or delete request to their human first.
- **Hooks must be fast and never break your session.** They answer from a local cache, fail open, and redact on the laptop.
- **Hosting gotchas**: the MCP SDK's DNS-rebinding guard rejected proxied requests, and free wildcard DNS names share Let's Encrypt rate limits. `TODO: add others from the night.`

## Accomplishments that we're proud of

- Two laptops' Claude Code sessions, owned by two people, claiming files, blocking a conflicting edit, and messaging each other live.
- An evidence gate that refuses "done" until it has seen the tests pass.
- A garden where every element is real data.
- `TODO: numbers, e.g. N reducers, N tests, events per minute in our own weekend repo`

## What we learned

- Coordinating agents is mostly about *rules*: who may touch what, what counts as done, and what an incoming message is allowed to make you do. Putting those rules in the database made them impossible to bypass.
- MCP over Streamable HTTP plus a header for identity is enough to give a whole team shared agent tools with one command.
- Honest UI (a butterfly that waits) beats pretending a system is real-time.

## What's next for Sprout

- Codex, Cursor and other agents through the same hooks and MCP tools
- Coverage-aware evidence, and screenshot evidence for frontend work
- Real auth (per-member tokens) instead of a trusted handle header
- Org-scale gardens: one bed per service, and a replay for post-mortems

## Built with

`typescript` · `node.js` · `spacetimedb` · `model-context-protocol` · `claude-code` · `three.js` · `vite` · `express` · `caddy` · `zod`

## Links / media checklist

- [ ] GitHub repo (public)
- [ ] Demo video (BACKUP.md recording, ≤3 min)
- [ ] Screenshots: garden overview, fence + blocked edit, butterfly landing, botanist refuse → bloom, shed board, plan view
- [ ] Prize tracks selected: Grand, Actually Intelligent, Best Use of SpacetimeDB, Figma Best Design, Best .Tech Domain
