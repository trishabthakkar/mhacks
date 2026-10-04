# Foundation, story and objections (Phases 1–3, condensed for a hackathon judge panel)

## Foundation

- **Pain (visceral):** four people, four agents, one repo, and none of the agents know the others exist.
- **Inevitable future:** every developer works with agents; teams of people each running agents is the default.
- **Blocker:** agents have no shared rules across owners: no "I'm editing this", no notes between them, no proof behind "done".
- **Our solution:** shared rules enforced in the database (claims, untrusted messages, accepted handoffs, evidence gate), reached from each person's own Claude Code with one command.
- **Hard value (measured on our own weekend):** see traction. **Soft value:** trust that "done" means tests passed; a calm shared picture of who is doing what.
- **Reasons judges score us up:** new problem (cross-owner agent coordination); real rules not a visualization; deep stack (hooks → local daemon → SpacetimeDB reducers → MCP → Three.js) working live; every visual is real data; accessible everyday views.
- **Reasons they might not (and our answer):** "spectacle" → team board + shed are the everyday view, every element is data; "clones don't need locks" → merge-conflict prevention, warn by default; "messages lag" → shown honestly; "prompt injection" → wrapped, untrusted, human approves changes; "privacy" → only status events leave, local redaction, pause; "botanist is gameable" → proves tests ran; review as extra evidence; coverage is next; "just Claude Code" → shell + git feeds work for anyone; "no auth" → hackathon limit, per-member tokens next.

## Headlines (each slide's message)

1. Your team's agents, in one garden — and nothing blooms without proof
2. Four people, four agents, one repo — and the agents can't see each other
3. Agents owned by different people need shared rules, not more dashboards
4. Fence, message, hand off, prove — from the Claude Code you already use
5. This is our real repo, grown live by our agents this weekend
6. Everything in the garden is real data
7. The botanist can't be talked into anything
8. Every rule lives in the database; zero LLM calls on our side
9. Built to survive a live demo
10. Only status leaves your laptop, and other agents can't give orders
11. One command to join, a calm view every day
12. Built to grow — literally
13. Fourteenth Floor showed one person's agents; we connect a whole team's
14. Where Sprout fits the tracks
15. What we prove today, and what's next
16. Close: reprise + team

## Objection arsenal (appendix)

Fences vs clones · 3D spectacle vs everyday use · message lag · cross-agent prompt injection · privacy/bossware · gaming the botanist · Claude Code lock-in · scale (big repos) · auth.
