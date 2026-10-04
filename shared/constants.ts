export const DAEMON_PORT = 4777;
export const DEFAULT_CLAIM_TTL_MIN = 30;
export const DEFAULT_CLAIM_MODE: ClaimMode = 'warn';
export const MAX_MESSAGE_BODY = 500;
export const MAX_DETAIL = 160;
export const MAX_COMMAND = 120;
export const MAX_BUGS = 5;

export type ClaimMode = 'warn' | 'block';

export const TEST_COMMAND_RE =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(vitest|jest|pytest|mocha|tap)\b|\bgo\s+test\b|\bcargo\s+test\b|\bnode\s+--test\b/;

// Garden-friendly colors, one per member.
export const MEMBER_COLORS = [
  '#e76f51', '#2a9d8f', '#e9c46a', '#8ab17d',
  '#b56576', '#6d9dc5', '#f4a261', '#9b8bd1',
] as const;

export const PLANT_STAGES = ['seed', 'sprout', 'growing', 'bud', 'bloom', 'dormant'] as const;
export const AGENT_STATUSES = ['working', 'blocked', 'needs_review', 'waiting', 'idle', 'dormant'] as const;
export const MESSAGE_KINDS = ['finding', 'request', 'handoff', 'system'] as const;
export const MESSAGE_STATUSES = ['sent', 'delivered', 'acked'] as const;
export const HANDOFF_STATUSES = ['offered', 'accepted', 'declined'] as const;

export const ACTIVITY_KINDS = [
  'session_start', 'session_end', 'prompt', 'read', 'search', 'edit', 'create', 'delete',
  'bash', 'tool_error', 'subagent_start', 'subagent_stop', 'waiting', 'idle', 'blocked_edit',
  'shell_cmd', 'test_pass', 'test_fail', 'commit', 'file_change', 'claim', 'release',
  'message_sent', 'message_delivered', 'message_acked', 'handoff_offered', 'handoff_accepted',
  'certify_bloom', 'certify_refused', 'task_started', 'task_done',
] as const;

export const TASK_STATUSES = ['active', 'blocked', 'needs_review', 'done'] as const;
export const TASK_ITEM_STATES = ['pending', 'in_progress', 'completed'] as const;
export const MAX_TASK_TITLE = 80;
export const MAX_TASK_ITEMS = 20;
export const MAX_TASK_PATHS = 50;
