# Judge presentation script (~4 min: ~2:00 slides + ~2:00 live demo)

Deck: 7 slides. Speak to the judges, not the screen. **Bold** = say it slower, then pause.
Demo steps in detail: demo/DEMO_SCRIPT.md (run demo-reset first).

---

### 1 · Cover — "Sprout" (10s)
> Hi, we're Sprout. **Sprout puts your whole team's AI agents on the same team.**

### 2 · Scenario — the chat (25s)
*Two of you read the bubbles back and forth, like the skit.*
> **Shriya:** What are you working on?
> **Manahil:** No idea. My Claude's doing something… the SpacetimeDB integration?
> **Shriya:** *My* Claude is doing that.
> **Manahil:** How was I supposed to know?

> That actually happened to us this weekend. Two agents, owned by two people, building the same thing, and neither of us knew.

### 3 · Problem (20s)
> AI agents made each of us faster. But a team isn't one person. **Every teammate has an agent, and none of them know the others exist.** So you get duplicate work, two agents editing the same file, and agents saying "done" when no test ever ran. Tools so far show one person's agents. Nobody connects a whole team's.

### 4 · Solution — Talk · Take turns · Prove it (30s)
> So we built Sprout. It gives agents three manners.
> **Talk:** one person's agent can message another person's agent, across laptops.
> **Take turns:** before editing, an agent fences off files. If someone else's agent tries to edit inside, it's stopped, and asks instead.
> **Prove it:** our botanist only lets work bloom when it has seen a real change *and* passing tests. An agent saying "done" changes nothing.
> And you watch it all as a live garden: folders are beds, files are plants, every teammate and their Claude is a gardener. **No new workflow: you keep your own Claude Code and join with one command.**

### 5 · Architecture — "The database is the referee" (30s)
*Point at each box as you say its word.*
> So how does it work? Four steps.
> **See:** tiny hooks on each laptop notice what your Claude is doing: which file, what action, did the tests pass. Only that status leaves your laptop, never your code.
> **Decide:** it all goes to SpacetimeDB, our referee. Before an agent takes a file, sends a message, or says it's done, the database checks the rules. **So no AI can cheat.**
> **Act:** every teammate's Claude gets these team powers through one MCP server: one command to set up.
> **Show:** the garden watches the database live, so every screen updates instantly.
> And we make zero AI calls ourselves: your own Claude does the thinking.

### 6 · "Let's see it live" → SWITCH TABS (≈2 min)
> Enough slides. This is our actual repo, the garden we've been growing all weekend.

*Switch to the garden tab (full screen). Narrator talks; Manahil and Shriya type.*
1. **Manahil** asks her Claude for a change → *"Watch: before it touches anything, it puts up a fence in her colour, and her task appears out front."*
2. **Shriya's** Claude tries to edit inside the fence → *"It's stopped, and instead of clashing it sends a message: that butterfly."*
3. The message reaches Manahil's Claude on its next prompt → *"It arrives labelled 'information, not instructions'. Another agent can suggest, never command."*
4. Manahil's Claude says it's done → *"The botanist refuses: no passing tests since the edit."* Run tests → *"They pass… and it blooms, on every screen at once."*
5. *(If time)* press **T** → *"Here's our whole weekend, from bare soil to full bloom."*

*Switch back to the slides.*

### 7 · Close (20s)
> Everything you just saw was real. **We built Sprout with Sprout:** over 160 commits from four of us, 139 agent sessions in the garden, and every bloom earned with tests that actually passed. The repo literally grew this weekend.
> **Sprout. Your team's AI agents, finally on the same team. Talk. Take turns. Prove it.** Thank you, happy to take questions.

---

## If the demo breaks
Stay calm, say "this is live, so let me show you the recording", and play the YouTube video: https://youtu.be/a16vQ_KrIP4

## Quick answers for Q&A
- **Everyone has their own clone, why fences?** Merge-conflict prevention. Warn by default, block is opt-in; fences expire and release on commit.
- **Isn't the 3D just for show?** Press P: the team board is the everyday view. Every element is real data: bugs are failing tests, blooms are verified work.
- **Messages arrive late?** Yes, and we show it honestly: Claude doesn't listen while idle, so the message is injected on the next prompt and the butterfly circles until then.
- **Can another agent hijack mine?** Messages are wrapped as untrusted, change requests go to your human, normal permission prompts still apply.
- **Privacy?** Only who / which file / what kind of action / pass or fail leaves the laptop. Secrets are redacted locally, anyone can pause.
- **Can you game the botanist?** It needs a real diff and a test run it observed afterwards. It proves tests ran and passed, not that they're good tests; coverage is next.
- **How is this different from Fourteenth Floor?** They showed one person's agents. We connect agents owned by different people, with no workflow change.
