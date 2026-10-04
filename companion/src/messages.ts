// `sprout inbox | send | reply | ack | allow | sent`: team messaging straight from the terminal,
// no AI in the loop. Everything goes through the local daemon (one connection per laptop).
import { call } from './client.ts';
import { daemonPort, loadConfig } from './config.ts';
import type { MessageRow, MessagesView } from './events.ts';

type Print = (s: string) => void;
type SendResult = { ok: true; body: string; masked: boolean } | { ok: false; error: string };

const TIMEOUT_MS = 10_000; // a send waits for the module to accept it

/** Messages come from other people's machines: never let them drive the terminal. */
export function safeText(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').replace(/\n/g, ' ');
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** Where an incoming message stands, from my side. */
function inboxState(m: MessageRow & { held: boolean }, mode: MessagesView['mode']): string {
  if (m.status === 'delivered') return 'your agent has it';
  if (m.held) return mode === 'off' ? 'not sent to your agent (inbox off)' : 'waiting for your OK: sprout allow ' + m.id;
  return 'reaches your agent on your next prompt';
}

/** Where a message I sent stands. Honest about lag: agents only read on their human's next prompt. */
function sentState(m: MessageRow): string {
  if (m.status === 'acked') return `acked ${ago(m.ackedAt ?? m.sentAt)}`;
  if (m.status === 'delivered') return `delivered ${ago(m.deliveredAt ?? m.sentAt)}, not acked yet`;
  return 'not yet delivered (their agent gets it on their next prompt, or they read it with sprout inbox)';
}

async function daemon<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T | undefined> {
  const cfg = loadConfig();
  if (!cfg) { console.error('not joined yet: sprout join <team-code> --handle <name>'); return undefined; }
  try {
    return await call<T>(daemonPort(cfg), method, path, body, TIMEOUT_MS);
  } catch {
    console.error('the sprout daemon is not running. Start it with `sprout daemon` (or any Claude Code prompt), then try again.');
    return undefined;
  }
}

export async function inbox(print: Print = console.log): Promise<number> {
  const v = await daemon<MessagesView>('GET', '/messages');
  if (!v) return 1;
  const modeText = { auto: 'messages reach your agent on your next prompt', ask: 'messages wait for your OK', off: 'messages never reach your agent' }[v.mode];
  print(`Inbox for ${v.me} (agent delivery: ${v.mode}, ${modeText})${v.connected ? '' : '  [OFFLINE: may be out of date]'}`);
  if (!v.inbox.length) { print('  (empty)'); return 0; }
  for (const m of v.inbox) {
    print(`  #${m.id}  from ${safeText(m.fromHandle)} · ${m.kind} · ${ago(m.sentAt)} · ${inboxState(m, v.mode)}`);
    print(`        ${safeText(m.body)}`);
  }
  print('');
  print('Reply: sprout reply <id> <text> · Done with it: sprout ack <id>' + (v.mode === 'auto' ? '' : ' · Pass to your agent: sprout allow <id|all>'));
  return 0;
}

export async function sent(print: Print = console.log): Promise<number> {
  const v = await daemon<MessagesView>('GET', '/messages');
  if (!v) return 1;
  print(`Sent by ${v.me} (last ${v.sent.length})`);
  if (!v.sent.length) { print('  (nothing yet)'); return 0; }
  for (const m of v.sent) {
    print(`  #${m.id}  to ${safeText(m.toHandle)} · ${m.kind} · ${ago(m.sentAt)} · ${sentState(m)}`);
    print(`        ${safeText(m.body)}`);
  }
  return 0;
}

export async function send(to: string, text: string, kind: 'finding' | 'request', print: Print = console.log): Promise<number> {
  const r = await daemon<SendResult>('POST', '/send', { to, body: text, kind });
  if (!r) return 1;
  if (!r.ok) { console.error(`not sent: ${r.error}`); return 1; }
  print(`sent to ${to.replace(/^@/, '')}${r.masked ? ' (something that looked like a secret was masked)' : ''}: ${safeText(r.body)}`);
  print('It reaches their agent on their next prompt; `sprout sent` shows when it lands.');
  return 0;
}

export async function reply(id: string, text: string, kind: 'finding' | 'request', print: Print = console.log): Promise<number> {
  const v = await daemon<MessagesView>('GET', '/messages');
  if (!v) return 1;
  const m = v.inbox.find((x) => x.id === id) ?? v.sent.find((x) => x.id === id);
  if (!m) { console.error(`no message #${id} in your inbox (sprout inbox lists them)`); return 1; }
  const to = m.fromHandle === v.me ? m.toHandle : m.fromHandle;
  return send(to, `re #${id}: ${text}`, kind, print);
}

export async function ack(ids: string[], print: Print = console.log): Promise<number> {
  const r = await daemon<{ results: { id: string; error?: string }[] }>('POST', '/ack', { ids });
  if (!r) return 1;
  let bad = 0;
  for (const x of r.results) {
    if (x.error) { bad++; console.error(`#${x.id}: ${x.error}`); } else print(`#${x.id} acked`);
  }
  return bad ? 1 : 0;
}

export async function allow(ids: string[] | 'all', print: Print = console.log): Promise<number> {
  const r = await daemon<{ allowed: string[] }>('POST', '/allow', { ids });
  if (!r) return 1;
  if (!r.allowed.length) {
    print('nothing let through. `sprout inbox` shows what is waiting; with `share inbox off` nothing reaches your agent (try `sprout share inbox ask`).');
    return ids === 'all' ? 0 : 1;
  }
  print(`let through: ${r.allowed.map((id) => '#' + id).join(', ')}. Your agent sees ${r.allowed.length > 1 ? 'them' : 'it'} on your next prompt.`);
  return 0;
}
