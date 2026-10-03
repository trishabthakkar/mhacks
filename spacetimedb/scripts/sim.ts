// Drives the REAL database with a fake team so the garden can be built before the companion exists.
//   npx tsx scripts/sim.ts [--host ws://127.0.0.1:3000] [--db sprout] [--speed 1] [--loop]
// Bots are ivy, moss, fern and reed (never real teammates' handles). Every write goes through reducers,
// so the module enforces the same rules as for real events (claims, botanist, bugs...).
import { DbConnection, tables } from './module_bindings/index.ts';

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
};
const HOST = arg('host', process.env.STDB_URI ?? 'ws://127.0.0.1:3000');
const DB = arg('db', process.env.STDB_DB ?? 'sprout');
const SPEED = Math.max(0.1, Number(arg('speed', '1')) || 1);
const LOOP = process.argv.includes('--loop');
const STEP_MS = 2500;

const REPO = 'sprout-sim';
const BOTS = ['ivy', 'moss', 'fern', 'reed'] as const;
type Bot = (typeof BOTS)[number];
const S = (h: Bot) => `sim-${h}`;

const FILES: Array<[string, number]> = [
  ['src/api/routes.ts', 120], ['src/api/auth.ts', 80], ['src/api/users.ts', 64], ['src/db.ts', 60],
  ['src/garden/scene.ts', 210], ['src/garden/plants.ts', 140], ['src/garden/bees.ts', 45],
  ['tests/api.test.ts', 90], ['tests/db.test.ts', 40], ['docs/README.md', 30], ['docs/pitch.md', 12],
  ['README.md', 20], ['package.json', 15],
];

const sleep = (steps: number) => new Promise((r) => setTimeout(r, (steps * STEP_MS) / SPEED));
const say = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${s}`);

function connect(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      .onConnect((conn) => {
        // The sim only reads messages and handoffs back (to get their ids).
        conn.subscriptionBuilder().onApplied(() => resolve(conn)).subscribe([tables.message, tables.handoff]);
      })
      .onConnectError((_ctx, err) => reject(err))
      .build();
  });
}

async function main() {
  say(`connecting to ${HOST} db=${DB} speed=${SPEED}${LOOP ? ' (loop)' : ''}`);
  const conn = await connect();
  const r = conn.reducers;

  // Every call is awaited; rule violations (SenderError) are expected in places and just logged.
  const tryCall = async (label: string, p: Promise<unknown>) => {
    try { await p; return true; } catch (e) { say(`  ↳ ${label} refused: ${(e as Error).message}`); return false; }
  };
  const act = (handle: Bot, kind: string, path?: string, extra: { lines?: number; detail?: string; sessionId?: string; parent?: string } = {}) =>
    tryCall(`${handle} ${kind}`, r.ingestActivity({
      handle, sessionId: extra.sessionId ?? S(handle), kind, path, lines: extra.lines, detail: extra.detail,
      parentSessionId: extra.parent,
    }));

  // Heartbeats every 30s keep the bots online between loops.
  const beat = () => BOTS.forEach((h) => r.heartbeat({ handle: h }).catch(() => {}));
  const hb = setInterval(beat, 30_000);

  const lines = new Map(FILES);
  const grow = (p: string, n: number) => { lines.set(p, (lines.get(p) ?? 0) + n); return lines.get(p)!; };

  let round = 0;
  do {
    round++;
    say(`— round ${round}`);

    // 1. The team arrives; the repo is seeded.
    for (const h of BOTS) await r.joinMember({ handle: h, color: '' });
    await r.seedRepo({ files: FILES.map(([path, n]) => ({ path, lines: lines.get(path) ?? n })) });
    for (const h of BOTS) await act(h, 'session_start', undefined, { detail: 'session started' });
    say('team joined, repo seeded');
    await sleep(1);

    // 2. Everyone gets to work.
    await act('ivy', 'prompt');
    await act('moss', 'prompt');
    await act('fern', 'prompt');
    await sleep(1);
    await act('ivy', 'read', 'src/api/routes.ts', { detail: 'Read' });
    await act('moss', 'search', 'src/garden/', { detail: 'Grep "Bee"' });
    await act('fern', 'read', 'tests/api.test.ts', { detail: 'Read' });
    await sleep(1);

    // 3. ivy fences src/api/ and edits inside it.
    await tryCall('ivy claim', r.claimFiles({ handle: 'ivy', paths: ['src/api/'], ttlMinutes: 20 }));
    say('ivy claimed src/api/');
    await act('ivy', 'edit', 'src/api/routes.ts', { lines: grow('src/api/routes.ts', 14), detail: 'Edit' });
    await act('moss', 'edit', 'src/garden/bees.ts', { lines: grow('src/garden/bees.ts', 22), detail: 'Edit' });
    await sleep(1);

    // 4. fern's bot wanders into the fence: the claim refuses, and the hook would log blocked_edit.
    const got = await tryCall('fern claim', r.claimFiles({ handle: 'fern', paths: ['src/api/auth.ts'], ttlMinutes: undefined }));
    if (!got) await act('fern', 'blocked_edit', 'src/api/auth.ts', { detail: 'src/api/auth.ts is fenced by ivy' });
    say('fern blocked by the fence');
    await sleep(1);

    // 5. A bee: fern asks ivy, the message is delivered on ivy's next prompt, then acked.
    await r.postMessage({ fromHandle: 'fern', fromSession: S('fern'), toHandle: 'ivy', kind: 'request', body: 'Can you export verifyToken from auth.ts? I need it for the tests.' });
    say('bee: fern → ivy');
    await act('fern', 'waiting', undefined, { detail: 'waiting for ivy' });
    await sleep(2);
    const msg = [...conn.db.message.iter()].filter((m) => m.toHandle === 'ivy' && m.status === 'sent').at(-1);
    if (msg) {
      await act('ivy', 'prompt');
      await r.markDelivered({ handle: 'ivy', id: msg.id });
      say(`message #${msg.id} delivered`);
      await sleep(1);
      await r.ackMessage({ handle: 'ivy', id: msg.id });
    }
    await act('ivy', 'edit', 'src/api/auth.ts', { lines: grow('src/api/auth.ts', 6), detail: 'Edit' });
    await act('fern', 'prompt');
    await sleep(1);

    // 6. moss spins up a subagent; a new file is planted.
    await act('moss', 'subagent_start', undefined, { sessionId: `${S('moss')}-sub${round}`, parent: S('moss'), detail: 'Explore' });
    await act('moss', 'read', 'src/garden/scene.ts', { sessionId: `${S('moss')}-sub${round}`, detail: 'Read' });
    await act('moss', 'create', `src/garden/pollen-${round}.ts`, { lines: 18, detail: 'Write' });
    await sleep(1);
    await act('moss', 'subagent_stop', undefined, { sessionId: `${S('moss')}-sub${round}` });
    await act('moss', 'edit', `src/garden/pollen-${round}.ts`, { lines: 31, detail: 'Edit' });
    await sleep(1);

    // 7. The botanist: refused (no diff), refused (no passing test), tests fail (bugs), pass, bloom.
    await r.submitEvidence({ handle: 'ivy', path: 'src/api/routes.ts', task: 'return 404 on missing ids' });
    say('botanist: refused (no diff yet)');
    await sleep(1);
    await r.recordDiff({ handle: 'ivy', paths: ['src/api/routes.ts', 'src/api/auth.ts'], commit: undefined });
    await r.submitEvidence({ handle: 'ivy', path: 'src/api/routes.ts', task: 'return 404 on missing ids' });
    say('botanist: refused (no passing test)');
    await sleep(1);
    await act('ivy', 'bash', undefined, { detail: 'npm test' });
    await r.recordTestRun({ handle: 'ivy', repo: REPO, command: 'npm test', exitCode: 1 });
    say('tests fail → bugs');
    await sleep(2);
    await act('ivy', 'edit', 'src/api/routes.ts', { lines: grow('src/api/routes.ts', 3), detail: 'Edit' });
    await r.recordDiff({ handle: 'ivy', paths: ['src/api/routes.ts'], commit: undefined });
    await r.recordTestRun({ handle: 'ivy', repo: REPO, command: 'npm test', exitCode: 0 });
    say('tests pass → bugs cleared');
    await sleep(1);
    await r.submitEvidence({ handle: 'ivy', path: 'src/api/routes.ts', task: 'return 404 on missing ids' });
    say('botanist: bloom 🌸');
    await sleep(2);

    // 8. A commit: rain on the beds, ivy's fence auto-releases.
    await r.recordDiff({ handle: 'ivy', paths: ['src/api/auth.ts', 'README.md'], commit: `${(0xabc000 + round).toString(16)}f00d` });
    say('ivy committed: rain on src and (root), fence released');
    await act('ivy', 'idle');
    await sleep(1);

    // 9. A handoff: reed picks up the docs from fern.
    await act('reed', 'prompt');
    await r.offerHandoff({ fromHandle: 'fern', toHandle: 'reed', task: 'write the pitch doc', notes: 'outline in docs/pitch.md' });
    await sleep(1);
    const h = [...conn.db.handoff.iter()].filter((x) => x.toHandle === 'reed' && x.status === 'offered').at(-1);
    if (h) {
      await act('reed', 'prompt');
      await r.respondHandoff({ handle: 'reed', id: h.id, accept: true });
      say(`handoff #${h.id} accepted`);
    }
    await act('reed', 'edit', 'docs/pitch.md', { lines: grow('docs/pitch.md', 25), detail: 'Edit' });
    await act('fern', 'edit', 'tests/api.test.ts', { lines: grow('tests/api.test.ts', 12), detail: 'Edit' });
    await sleep(2);

    // 10. Wind down.
    await act('fern', 'idle');
    await act('reed', 'waiting', undefined, { detail: 'needs input' });
    await act('moss', 'idle');
    await sleep(3);
    if (!LOOP) for (const h of BOTS) await act(h, 'session_end');
  } while (LOOP);

  clearInterval(hb);
  say('done');
  conn.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
