# Claude Code hook payloads (verified)

Verified 2026-10-03 against **Claude Code 2.1.288** by running a real headless session (`claude -p`) with a logging hook on every event and a scripted task (Read, Grep, Edit, Write, Bash ok, Bash failing, Explore subagent). Raw payloads (paths sanitized) are in `test/fixtures/payloads.jsonl`. Docs: https://code.claude.com/docs/en/hooks

`test/fixtures/synthetic.jsonl` holds payloads I could not trigger headless (Notification, PermissionRequest, MultiEdit, NotebookEdit, Glob, a failing `npm test`). They are built from the docs schema, **not** observed.

## Verified answers

| Question | Answer (observed) |
|---|---|
| Deny a tool with a reason Claude sees | PreToolUse stdout, exit 0: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<text>"}}`. The edit was blocked and Claude quoted it as `PreToolUse:Edit hook error: <text>`. File unchanged. |
| Add context without blocking (warn mode) | PreToolUse stdout: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"<text>"}}` (from docs; same envelope as deny) |
| UserPromptSubmit adds context | stdout `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<text>"}}`. Observed: Claude quoted a codeword we injected inside the untrusted-message wrapper. Plain stdout also works per docs. |
| SubagentStart exists? | **Yes.** Fires with `agent_id` + `agent_type`. |
| Subagent tool calls | Carry the parent `session_id` **plus** `agent_id`/`agent_type`. We derive the subagent session id as `<session_id>:<agent_id>`. |
| Bash exit status | Success → `PostToolUse`, `tool_response: {stdout, stderr, interrupted, ...}` — **no exit code field**; treat as 0. Non-zero → `PostToolUseFailure` with `error: "Exit code N\n<output>"` (parse `N`). |
| Write: new vs existing | `PostToolUse.tool_response.type` is `"create"` for a new file (`originalFile: null`), otherwise `"update"`. |
| Prompt text | `UserPromptSubmit.prompt` (we never forward it). |
| Exit codes | 0 = ok, JSON on stdout honoured; 2 = blocking error (stderr shown); other = non-blocking error. We always exit 0 (fail open). |
| Timeouts | default 600s for command hooks, 30s on UserPromptSubmit. We set `timeout: 5` and our own 0.5s HTTP timeout. |
| async | `"async": true` runs the hook in the background (no output honoured, no timeout). Used for pure-reporting events. |

## Common fields (every event)

`session_id`, `transcript_path`, `cwd`, `hook_event_name`, plus `prompt_id` (after first prompt), `permission_mode`, `effort: {level}`, `scratchpad_dir` (cloud only), and `agent_id`/`agent_type` inside subagents.

## Per event (observed unless marked)

| Event | Extra fields |
|---|---|
| SessionStart | `source` (`startup`/`resume`/`clear`/`compact`/`fork`), optional `model` |
| SessionEnd | `reason` (`other` observed headless; docs: `clear`, `logout`, `prompt_input_exit`, …) |
| UserPromptSubmit | `prompt` |
| PreToolUse | `tool_name`, `tool_input`, `tool_use_id` |
| PostToolUse | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms` |
| PostToolUseFailure | `tool_name`, `tool_input`, `tool_use_id`, `error`, `is_interrupt`, `duration_ms` |
| SubagentStart | `agent_id`, `agent_type` |
| SubagentStop | `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `stop_hook_active` |
| Stop | `stop_hook_active`, `last_assistant_message` |
| Notification *(docs)* | `notification_type` (`permission_prompt`, `idle_prompt`, …), `message` |
| PermissionRequest *(docs)* | `tool_name`, `tool_input`, `tool_use_id` |

`tool_input` shapes: Read/Edit/Write/MultiEdit → `file_path`; NotebookEdit → `notebook_path`; Grep/Glob → `pattern`, optional `path`; Bash → `command`, `description`; Agent → `subagent_type`, `prompt`, `description`. Paths are absolute.

## Examples (trimmed)

```json
{"hook_event_name":"PreToolUse","session_id":"…","cwd":"/Users/alex/proj","tool_name":"Edit",
 "tool_input":{"file_path":"/Users/alex/proj/a.txt","old_string":"hello","new_string":"hello world","replace_all":false},"tool_use_id":"toolu_…"}

{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"node --test","description":"Run node tests"},
 "tool_response":{"stdout":"TAP version 13 …","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false},"duration_ms":499}

{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"cat does-not-exist.txt"},
 "error":"Exit code 1\ncat: does-not-exist.txt: No such file or directory","is_interrupt":false}

{"hook_event_name":"SubagentStart","agent_id":"aa67ece49f0e2c57b","agent_type":"Explore"}
```

## Latency

See status/P3.md (measured per hook path).
