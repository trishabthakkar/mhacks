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
/** Starts with a path, file, call or camelCase name: keep its case. */
const CODEISH = /^\S*([/._(]|[a-z][A-Z])/;
/** Tidy agent-written text for display: one line, no wrapping quotes, no trailing period, capitalised unless it starts with code. Mirrors mcp/src/tidy.ts. */
export function tidy(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) { const m = /^(["'`])(.*)\1$/.exec(t); if (!m) break; t = m[2]!.trim(); }
  t = t.replace(/^`([^`]+)`/, '$1');
  t = t.replace(/(?<!\.)\.$/, '').trim();
  if (t && !CODEISH.test(t)) t = t[0]!.toUpperCase() + t.slice(1);
  return t;
}
/** Shorten to n characters at a word boundary, with an ellipsis (falls back to a hard cut for one long word). */
export function clipWords(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1), sp = cut.lastIndexOf(' ');
  return `${(sp >= n * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}
