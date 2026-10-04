// `sprout share | hide | unhide`: each person decides what leaves their laptop and how
// teammates' messages reach their agent. Saved in ~/.sprout/config.json; the daemon reloads it.
import { call } from './client.ts';
import { daemonPort, loadConfig, saveConfig } from './config.ts';
import { describeShare, INBOX_MODES, SHARE_CATEGORIES, shareOf, type InboxMode, type ShareCategory } from './share.ts';

type Print = (s: string) => void;

const USAGE = 'usage: sprout share [<activity|reads|commands|tests|diffs> <on|off>] | sprout share inbox <auto|ask|off> | sprout hide|unhide <path|glob…>';

/** Repo-relative, forward slashes; `src` stays a file, `src/` a folder. */
function cleanEntry(raw: string): string | undefined {
  const s = raw.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..')) return undefined;
  return s;
}

export async function shareCommand(cmd: 'share' | 'hide' | 'unhide', args: string[], print: Print = console.log): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) { console.error('not joined yet: sprout join <team-code> --handle <name>'); return 1; }
  const share = shareOf(cfg);
  const notes: string[] = [];

  if (cmd === 'share' && args.length === 0) {
    for (const l of describeShare(share)) print(l);
    return 0;
  }
  if (cmd === 'share') {
    const [what, value] = args;
    if (what === 'inbox') {
      if (!INBOX_MODES.includes(value as InboxMode)) { console.error(USAGE); return 2; }
      share.inbox = value as InboxMode;
    } else if (SHARE_CATEGORIES.includes(what as ShareCategory) && (value === 'on' || value === 'off')) {
      share[what as ShareCategory] = value === 'on';
      if ((what === 'tests' || what === 'diffs') && value === 'off') {
        notes.push(`Note: with ${what} off the botanist can't see your evidence, so your plants won't bloom.`);
      }
    } else { console.error(USAGE); return 2; }
  } else {
    const entries = args.map(cleanEntry);
    if (!args.length || entries.some((e) => !e)) { console.error(`usage: sprout ${cmd} <repo-relative path|glob…> (e.g. secrets/ or '.env*')`); return 2; }
    const set = new Set(share.hidden);
    for (const e of entries as string[]) cmd === 'hide' ? set.add(e) : set.delete(e);
    share.hidden = [...set];
    if (cmd === 'hide') notes.push('Hidden paths never leave this laptop. Edits there still show as activity, without the file name, and those files can\'t bloom.');
  }

  cfg.share = share;
  saveConfig(cfg);
  await call(daemonPort(cfg), 'POST', '/reload', undefined, 1000).catch(() => {});
  for (const l of describeShare(share)) print(l);
  for (const n of notes) print(n);
  return 0;
}
