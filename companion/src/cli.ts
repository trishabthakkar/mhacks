export const HELP = `sprout — Sprout companion

Usage: sprout <command>

Commands:
  join <team-code> --handle <name>   join the team and install hooks
  daemon                             run the local companion daemon (127.0.0.1:4777)
  hook <event>                       handle a Claude Code hook event (reads stdin)
  shell-init <zsh|bash>              print the shell hook snippet
  pause                              stop reporting activity
  resume                             resume reporting activity
  status                             show companion status

Options:
  -h, --help                         show this help
`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(HELP);
    return 0;
  }
  switch (cmd) {
    case 'join':
    case 'daemon':
    case 'pause':
    case 'resume':
    case 'status':
      console.log(`sprout ${cmd}: not implemented yet (P3)`);
      return 0;
    case 'hook':
      if (!rest[0]) { console.error('usage: sprout hook <event>'); return 2; }
      // Hooks must fail open: never block Claude Code while this is a stub.
      return 0;
    case 'shell-init':
      if (rest[0] !== 'zsh' && rest[0] !== 'bash') { console.error('usage: sprout shell-init <zsh|bash>'); return 2; }
      console.log(`# sprout shell-init ${rest[0]}: not implemented yet (P3)`);
      return 0;
    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      return 2;
  }
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
