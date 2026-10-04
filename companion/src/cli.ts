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

Messages (straight from your terminal, no AI needed):
  inbox                              messages to you, and whether your agent has them
  send <handle> <message…> [--request]
                                     message a teammate (their agent gets it on their next prompt)
  reply <id> <message…>              answer a message
  ack <id…>                          done with it (an unread one never reaches your agent)
  allow <id…|all>                    pass held messages to your agent (inbox mode "ask")
  sent                               what you sent and whether it landed

Fences (claims), from your terminal:
  claim <path…> [--ttl <minutes>]    fence files or folders so teammates' agents are warned/blocked
  release [path…]                    drop your fences (no paths: all of yours)
  claims                             who has fenced what, and until when

What you share:
  share                              show what leaves this laptop and how messages reach your agent
  share <activity|reads|commands|tests|diffs> <on|off>
  share inbox <auto|ask|off>         auto: straight to your agent · ask: you approve each · off: never
  share compliments <on|off>         congratulate teammates when their task blooms (default on)
  hide <path|glob…>                  never share these paths (e.g. secrets/ or '.env*')
  unhide <path|glob…>

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
      console.log(cfg.paused ? '⏸  tracking paused: no activity leaves this laptop until `sprout resume` (messages you send yourself still go)' : '▶  tracking resumed');
      return 0;
    }
    case 'inbox': return (await import('./messages.ts')).inbox();
    case 'sent': return (await import('./messages.ts')).sent();
    case 'send': {
      const { pos, opt } = flags(rest);
      if (pos.length < 2) { console.error('usage: sprout send <handle> <message…> [--request]'); return 2; }
      return (await import('./messages.ts')).send(pos[0]!, pos.slice(1).join(' '), opt.request ? 'request' : 'finding');
    }
    case 'reply': {
      const { pos, opt } = flags(rest);
      if (pos.length < 2 || !/^#?\d+$/.test(pos[0]!)) { console.error('usage: sprout reply <id> <message…> [--request]'); return 2; }
      return (await import('./messages.ts')).reply(pos[0]!.replace('#', ''), pos.slice(1).join(' '), opt.request ? 'request' : 'finding');
    }
    case 'ack': {
      const ids = rest.map((x) => x.replace('#', '')).filter(Boolean);
      if (!ids.length) { console.error('usage: sprout ack <id…>'); return 2; }
      return (await import('./messages.ts')).ack(ids);
    }
    case 'allow': {
      const ids = rest.map((x) => x.replace('#', '')).filter(Boolean);
      if (!ids.length) { console.error('usage: sprout allow <id…|all>'); return 2; }
      return (await import('./messages.ts')).allow(ids.includes('all') ? 'all' : ids);
    }
    case 'claim': {
      const { pos, opt } = flags(rest);
      if (!pos.length) { console.error('usage: sprout claim <path…> [--ttl <minutes>]'); return 2; }
      const ttl = typeof opt.ttl === 'string' ? Number(opt.ttl) : undefined;
      if (ttl !== undefined && !(Number.isInteger(ttl) && ttl > 0)) { console.error('--ttl must be a whole number of minutes'); return 2; }
      return (await import('./claims.ts')).claim(pos, ttl);
    }
    case 'release': return (await import('./claims.ts')).release(flags(rest).pos);
    case 'claims': return (await import('./claims.ts')).claims();
    case 'share':
    case 'hide':
    case 'unhide': {
      const { shareCommand } = await import('./shareCmd.ts');
      return shareCommand(cmd, rest);
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
