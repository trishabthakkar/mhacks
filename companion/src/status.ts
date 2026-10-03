// `sprout status`: connection, last 5 events, my claims, inbox count, claimMode.
import { call } from './client.ts';
import { daemonPort, files, loadConfig } from './config.ts';
import type { DaemonStatus } from './events.ts';
import { formatUntil } from './hookMap.ts';

export async function printStatus(print: (s: string) => void = console.log): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) { print('not joined yet: sprout join <team-code> --handle <name>'); return 1; }
  const s = await call<DaemonStatus>(daemonPort(cfg), 'GET', '/status', undefined, 1000).catch(() => undefined);
  print(`member     ${cfg.handle}${cfg.color ? ` ${cfg.color}` : ''}`);
  print(`database   ${cfg.db} @ ${cfg.stdbUri}`);
  print(`tracking   ${cfg.paused ? 'PAUSED (sprout resume)' : 'on'}`);
  if (!s) {
    print(`daemon     not running (starts on the next hook; log: ${files.log()})`);
    return 0;
  }
  print(`daemon     running, ${s.connected ? 'connected' : 'OFFLINE (queueing)'} [${s.impl}]${s.queued ? `, ${s.queued} queued` : ''}`);
  print(`claimMode  ${s.claimMode}`);
  print(`inbox      ${s.inbox} undelivered`);
  print(`repos      ${s.repos.join(', ') || '(none)'}`);
  print(`my claims  ${s.myClaims.length ? s.myClaims.map((c) => `${c.path} (until ${formatUntil(c.expiresAt)})`).join(', ') : '(none)'}`);
  print('recent');
  if (!s.recent.length) print('  (no events yet)');
  for (const r of s.recent) print(`  ${new Date(r.at).toLocaleTimeString()}  ${r.text}`);
  return 0;
}
