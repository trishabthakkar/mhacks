import type { ActivityView } from '../../../shared/types.ts';

// Last path segment; a folder ("src/api/") keeps its name instead of coming out empty.
const base = (p?: string) => (p ? p.split('/').filter(Boolean).pop() ?? p : 'the garden');

/** Plain-English line for the live feed. */
export function sentence(a: ActivityView): string {
  const who = a.handle, f = base(a.path);
  switch (a.kind) {
    case 'session_start': return `${who}'s Claude woke up`;
    case 'session_end': return `${who}'s Claude went to sleep`;
    case 'prompt': return `${who} is asking their Claude something`;
    case 'read': return `${who}'s Claude is inspecting ${f}`;
    case 'search': return `${who}'s Claude is searching around`;
    case 'edit': return `${who}'s Claude is watering ${f}`;
    case 'create': return `a new seedling, ${f}, sprouted for ${who}`;
    case 'delete': return `${who} pulled up ${f}`;
    case 'bash': return `${who}'s Claude is at the potting bench`;
    case 'tool_error': return `${who}'s Claude hit a snag`;
    case 'subagent_start': return `a helper set off from ${who}'s Claude`;
    case 'subagent_stop': return `${who}'s helper finished`;
    case 'waiting': return `${who}'s Claude is waiting for permission`;
    case 'idle': return `${who}'s Claude is resting`;
    case 'blocked_edit': return `${who} was stopped by ${a.detail || 'a fence'}`;
    case 'shell_cmd': return `${who} ran a shell command`;
    case 'test_pass': return `tests passed for ${who}: bugs cleared`;
    case 'test_fail': return `tests failed for ${who}: bugs on the leaves`;
    case 'commit': return `${who} committed ${f}: rain over the bed`;
    case 'file_change': return `${who} changed ${f}`;
    case 'claim': return `${who} fenced off ${base(a.path)}`;
    case 'release': return `${who} took down the fence around ${base(a.path)}`;
    case 'message_sent': return `${who} sent a butterfly`;
    case 'message_delivered': return `${who}'s butterfly landed: message delivered`;
    case 'message_acked': return `${who} acknowledged a message`;
    case 'handoff_offered': return `${who} offered a handoff`;
    case 'handoff_accepted': return `${who} accepted a handoff`;
    case 'certify_bloom': return `the botanist certified ${f}: bloom!`;
    case 'certify_refused': return `the botanist refused ${f}`;
    default: return `${who}: ${String(a.kind).slice(0, 40)}`; // a kind this version doesn't know yet
  }
}
