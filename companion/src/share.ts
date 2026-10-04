// What each person lets leave their laptop, and how teammates' messages reach their agent.
// Stored in ~/.sprout/config.json (`share`), changed with `sprout share` / `sprout hide`,
// enforced by the daemon before anything is sent.
import type { SproutConfig } from './config.ts';

/** auto: messages go to your agent on your next prompt. ask: they wait for `sprout allow`. off: never. */
export type InboxMode = 'auto' | 'ask' | 'off';

export interface ShareSettings {
  /** What your agents are doing and on which file (edits, sessions, waiting, blocked). */
  activity: boolean;
  /** Which files your agents read or search. */
  reads: boolean;
  /** Commands run (binary + subcommand only). */
  commands: boolean;
  /** Test runs and pass/fail. The botanist needs these to certify a bloom. */
  tests: boolean;
  /** Which files changed in git (paths and commit sha). The botanist needs these too. */
  diffs: boolean;
  /** Paths never shared: `secrets/` (folder), `.env*` (glob on the file name), `src/x.ts` (file). */
  hidden: string[];
  inbox: InboxMode;
  /** Congratulate teammates (via your companion) when their task blooms. */
  compliments: boolean;
}

export type ShareCategory = 'activity' | 'reads' | 'commands' | 'tests' | 'diffs';
export const SHARE_CATEGORIES: readonly ShareCategory[] = ['activity', 'reads', 'commands', 'tests', 'diffs'];
export const INBOX_MODES: readonly InboxMode[] = ['auto', 'ask', 'off'];

export const DEFAULT_SHARE: ShareSettings = {
  activity: true, reads: true, commands: true, tests: true, diffs: true, hidden: [], inbox: 'auto', compliments: true,
};

export function shareOf(cfg: Pick<SproutConfig, 'share'> | null | undefined): ShareSettings {
  const s = { ...DEFAULT_SHARE, ...(cfg?.share ?? {}) };
  s.hidden = Array.isArray(s.hidden) ? s.hidden.filter((h) => typeof h === 'string' && h) : [];
  if (!INBOX_MODES.includes(s.inbox)) s.inbox = 'auto';
  for (const c of SHARE_CATEGORIES) s[c] = s[c] !== false;
  s.compliments = s.compliments !== false;
  return s;
}

/** Which setting an activity kind falls under. */
export function categoryOf(kind: string): ShareCategory {
  switch (kind) {
    case 'read': case 'search': return 'reads';
    case 'bash': case 'shell_cmd': return 'commands';
    case 'test_pass': case 'test_fail': return 'tests';
    case 'file_change': case 'commit': return 'diffs';
    default: return 'activity';
  }
}

function globRe(glob: string): RegExp {
  const body = glob.split('**').map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${body}$`);
}

/**
 * A hidden entry matches a path if equal, if it ends with `/` and the path is under it,
 * or if it's a glob (`*`, `**`). A glob with no `/` matches the file name in any folder.
 */
export function isHidden(hidden: string[], path: string): boolean {
  const name = path.split('/').pop() ?? path;
  for (const raw of hidden) {
    const h = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!h) continue;
    if (h === path || (h.endsWith('/') && path.startsWith(h))) return true;
    if (h.includes('*')) {
      const re = globRe(h.endsWith('/') ? h + '**' : h);
      if (re.test(path) || (!h.includes('/') && re.test(name))) return true;
    }
  }
  return false;
}

const LABELS: Record<ShareCategory, string> = {
  activity: 'what your agents are doing and on which file',
  reads: 'which files your agents read or search',
  commands: 'commands run (binary + subcommand only, e.g. `git commit`)',
  tests: 'test runs and pass/fail (the botanist needs this to bloom)',
  diffs: 'which files changed in git (the botanist needs this to bloom)',
};

const INBOX_TEXT: Record<InboxMode, string> = {
  auto: "teammates' messages reach your agent on your next prompt",
  ask: 'teammates\' messages wait in `sprout inbox` until you `sprout allow` them',
  off: "teammates' messages never reach your agent (read them with `sprout inbox`)",
};

export function describeShare(s: ShareSettings): string[] {
  const out = ['What leaves this laptop:'];
  for (const c of SHARE_CATEGORIES) out.push(`  ${s[c] ? '[on] ' : '[off]'} ${c.padEnd(9)} ${LABELS[c]}`);
  out.push(`  hidden    ${s.hidden.length ? s.hidden.join(', ') : '(none)'}`);
  out.push('Never shared: prompt text, file contents, command arguments, secrets.');
  out.push('');
  out.push(`Messages to your agent: ${s.inbox}, ${INBOX_TEXT[s.inbox]}`);
  out.push(`Compliments: ${s.compliments ? 'on, your companion sometimes congratulates a teammate when their task blooms' : 'off'}`);
  out.push('');
  out.push('Change: sprout share <activity|reads|commands|tests|diffs> <on|off> · sprout share inbox <auto|ask|off> · sprout share compliments <on|off>');
  out.push('        sprout hide <path|glob> · sprout unhide <path|glob>');
  return out;
}
