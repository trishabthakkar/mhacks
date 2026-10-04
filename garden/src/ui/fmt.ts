// Small text helpers shared by the shed, inspector and tooltips. Pure.
export { esc, safeColor } from './taskCard.ts';
export const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Compact relative time: now, 4m, 2h, 3d. */
export const rel = (ms: number) => (ms < 45_000 ? 'now' : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : ms < 86_400_000 ? `${Math.floor(ms / 3_600_000)}h` : `${Math.floor(ms / 86_400_000)}d`);
/** "just now" or "4m ago". */
export const ago = (ms: number) => (rel(ms) === 'now' ? 'just now' : `${rel(ms)} ago`);
/** One icon per activity kind for feed rows. */
export const ICON: Record<string, string> = {
  session_start: '👋', session_end: '🏠', prompt: '💬', read: '👀', search: '🔎', edit: '💧', create: '🌱', delete: '🪓',
  bash: '🧰', tool_error: '⚠️', subagent_start: '✨', subagent_stop: '✨', waiting: '⏳', idle: '😴', blocked_edit: '🚧',
  shell_cmd: '🧰', test_pass: '✅', test_fail: '🐛', commit: '🌧️', file_change: '✏️', claim: '🔒', release: '🔓',
  message_sent: '🦋', message_delivered: '🦋', message_acked: '👍', handoff_offered: '🤝', handoff_accepted: '🤝',
  certify_bloom: '🌸', certify_refused: '✋',
};
