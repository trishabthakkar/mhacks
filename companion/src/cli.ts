// `sprout` CLI. Keep top-level imports tiny: `sprout hook` runs on every tool call and must
// start fast; everything heavy (daemon, SpacetimeDB SDK, join) is imported lazily.
export const HELP = `sprout — Sprout companion

Usage: sprout <command>

Commands:
  join <team-code> --handle <name> [--color <hex>] [--repo .] [--no-claude-md]
                                     join the team and install hooks in this repo
  make-code --stdb <uri> --db <name> --mcp <url> [--color <hex>]
                                     print a team code
  daemon                             run the local companion daemon (127.0.0.1:4777)
  hook <event>                       handle a Claude Code hook event (reads stdin)
  shell-init <zsh|bash>              print the shell hook snippet
  pause                              stop reporting activity
  resume                             resume reporting activity
  status                             show companion status
  stop                               stop the local daemon

Options:
  -h, --help                         show this help
`;

function flags(args: string[]): { pos: string[]; opt: Record<string, string | true> } {
  const pos: string[] = [];
  const opt: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2) as [string, string | undefined];
      if (v !== undefined) opt[k] = v;
      else if (args[i + 1] !== undefined && !args[i + 1]!.startsWith('--')) opt[k] = args[++i]!;
      else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}
const str = (v: string | true | undefined) => (typeof v === 'string' ? v : undefined);

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(HELP);
    return 0;
  }
  switch (cmd) {
    case 'hook': {
      // Fail open on ANY error, always exit 0, never wait long.
      if (!rest[0]) return 0;
      const killer = setTimeout(() => process.exit(0), 1500);
      killer.unref();
      try {
        const { readStdin, runHook } = await import('./hook.ts');
        const out = await runHook(rest[0], await readStdin());
        if (out) await new Promise<void>((r) => process.stdout.write(out + '\n', () => r()));
      } catch { /* fail open */ }
      return 0;
    }
    case 'git-post-commit': {
      const { runPostCommit } = await import('./hook.ts');
      await runPostCommit();
      return 0;
    }
    case 'make-code': {
      const { opt } = flags(rest);
      const stdbUri = str(opt.stdb), db = str(opt.db), mcpUrl = str(opt.mcp);
      if (!stdbUri || !db || !mcpUrl) { console.error('usage: sprout make-code --stdb <uri> --db <name> --mcp <url> [--color <hex>]'); return 2; }
      const { makeTeamCode } = await import('./teamCode.ts');
      console.log(makeTeamCode({ stdbUri, db, mcpUrl, color: str(opt.color) }));
      return 0;
    }
    case 'join': {
      const { pos, opt } = flags(rest);
      const handle = str(opt.handle);
      if (!pos[0] || !handle) { console.error('usage: sprout join <team-code> --handle <name> [--color <hex>] [--repo .]'); return 2; }
      const { join_ } = await import('./join.ts');
      try {
        return await join_({ code: pos[0], handle, color: str(opt.color), repo: str(opt.repo), claudeMd: !opt['no-claude-md'], seed: !opt['no-seed'] });
      } catch (e) {
        console.error(`sprout join: ${(e as Error).message ?? e}`);
        return 1;
      }
    }
    case 'daemon': {
      const { runDaemon } = await import('./daemon.ts');
      return runDaemon();
    }
    case 'shell-init': {
      if (rest[0] !== 'zsh' && rest[0] !== 'bash') { console.error('usage: sprout shell-init <zsh|bash>'); return 2; }
      const { shellInit } = await import('./shellInit.ts');
      const { daemonPort, loadConfig } = await import('./config.ts');
      process.stdout.write(shellInit(rest[0], daemonPort(loadConfig())));
      return 0;
    }
    case 'pause':
    case 'resume': {
      const { loadConfig, saveConfig, daemonPort } = await import('./config.ts');
      const { call } = await import('./client.ts');
      const cfg = loadConfig();
      if (!cfg) { console.error('not joined yet'); return 1; }
      cfg.paused = cmd === 'pause';
      saveConfig(cfg);
      await call(daemonPort(cfg), 'POST', '/reload', undefined, 1000).catch(() => {});
      console.log(cfg.paused ? '⏸  tracking paused: nothing leaves this laptop until `sprout resume`' : '▶  tracking resumed');
      return 0;
    }
    case 'status': {
      const { printStatus } = await import('./status.ts');
      return printStatus();
    }
    case 'stop': {
      const { loadConfig, daemonPort } = await import('./config.ts');
      const { call } = await import('./client.ts');
      const ok = await call(daemonPort(loadConfig()), 'POST', '/shutdown', undefined, 1000).then(() => true, () => false);
      console.log(ok ? 'daemon stopped' : 'daemon was not running');
      return 0;
    }
    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      return 2;
  }
}
