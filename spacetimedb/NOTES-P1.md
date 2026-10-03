# NOTES-P1 — SpacetimeDB spike for Sprout

Verified on 2026-10-03 against **SpacetimeDB CLI 2.10.2** and the npm package **`spacetimedb@2.10.*`**, using Node 22.19 on macOS.
The working spike lives in `stdb-spike/`. Module: `stdb-spike/spacetimedb/src/index.ts`. Client: `stdb-spike/client/src/watch.ts`.
Unless a line says "per docs", everything below was run and confirmed. Lines marked "per docs" were not tested.

---

## 0. TL;DR gotchas (read these first)

1. **The CLI's default server is `maincloud`, not local.** Pass `--server local` on every command you mean for localhost. Otherwise `call`, `sql`, `publish` and `logs` go to the cloud.
2. **`spacetime init` writes `spacetime.json` with `"server": "maincloud"`, plus `spacetime.local.json` with a random db name** (e.g. `stdb-spike-bz3zz`). When you run `spacetime call/sql` from inside that folder, **that config overrides the db name you type**. The result is `Error: failed to find database 'stdb-spike-bz3zz'`. Fix: edit `spacetime.local.json` → `{"database": "sprout"}`, run from another directory, or pass `--no-config`.
3. **Put CLI flags BEFORE the positional args**: `spacetime call --server local <db> <reducer> args...`. Also, zsh does not word-split `$VARS`, so `C="--server local"; spacetime call $C ...` fails.
4. **Names are snake_cased on the server.** The TS export `addEvent` becomes reducer `add_event`, and the schema key `plantEvent` becomes table `plant_event`. Columns follow the same rule: `plantName` becomes `plant_name`. The CLI only accepts `add_event`; calling `addEvent` gives "No such reducer… similar: add_event". SQL accepted **both** `plant_event`/`plantEvent` and `plant_name`/`plantName`.
5. **The generated TS client is camelCase everywhere**: `conn.db.plantEvent`, `row.plantName`, `row.createdAt`, `conn.reducers.addEvent({...})`, `tables.plantEvent`.
6. **Import `ScheduleAt` from `'spacetimedb'`, NOT `'spacetimedb/server'`.** Import everything else (`schema`, `table`, `t`, `SenderError`) from `'spacetimedb/server'`.
7. **Every `t.u64()` is a `bigint`**: insert autoInc ids as `0n`, intervals are `60_000_000n` microseconds, and even `count()` returns `5n`. Don't `JSON.stringify` rows without a bigint replacer.
8. **An option column (`t.option(...)`) is `T | undefined` in TS.** On the CLI you write it as `'{"some":"x"}'` or `'{"none":[]}'`; a bare `null` also worked for none. A bare string `'"x"'` is **rejected**.
9. **CLI calls must pass every arg.** Option args can't be omitted; `add_event Oak` fails with "expected 2 elements".
10. **A scheduled interval does NOT fire immediately.** The first run comes one interval after insert (init at 20:13:27, ticks at 20:14:27 and 20:15:27, so it repeats on schedule). Scheduled reducers and private tables are **not** in the generated client bindings, which is good.
11. **A shared file outside the module that imports `spacetimedb` fails to build** unless `node_modules` is resolvable from that file's location (see §5).
12. Free tier: **5 databases per project**, and a db pauses after **1 week** idle (it resumes in under 1s on the next request). Fine for the hackathon.

---

## 1. Install / local server

```sh
curl -sSf https://install.spacetimedb.com | sh      # non-interactive: ... | sh -s -- -y
export PATH="$HOME/.local/bin:$PATH"                # binary is ~/.local/bin/spacetime
spacetime --version                                 # 2.10.2
spacetime start                                     # local server on 127.0.0.1:3000 (keep running)
spacetime server list                               # shows maincloud is DEFAULT (***)
# optional: make local the default so you can drop --server local
spacetime server set-default local
```

Scaffold a server-only TS module:

```sh
spacetime init --lang typescript --server-only --local --non-interactive --project-path sprout-db sprout-db
cd sprout-db/spacetimedb && npm install
```

(`spacetime dev --template basic-ts` is the docs' all-in-one option: it starts the server, publishes, and generates bindings for a full client+server template. I didn't use it.)

The generated `spacetimedb/tsconfig.json` has required options. Keep `"target": "ESNext"`, `"module": "ESNext"`, `"isolatedModules": true`, `"noEmit": true`, and `"moduleResolution": "bundler"`.

---

## 2. Module code (working, published)

`spacetimedb/src/index.ts`:

```ts
import { ScheduleAt } from 'spacetimedb'; // NOTE: root package, not /server
import { schema, table, t, SenderError } from 'spacetimedb/server';
import { MAX_NOTE_LEN, shout } from '../../shared/constants'; // outside module folder: works

// Public table: autoInc id, optional field, timestamp.
const plantEvent = table(
  { public: true },                        // no name → DB name becomes plant_event
  {
    eventId: t.u64().primaryKey().autoInc(),
    plantName: t.string(),
    note: t.option(t.string()),            // optional → string | undefined
    createdAt: t.timestamp(),
  }
);

// Schedule table (private by default) driving `tick` every 60s.
const tickTimer = table(
  { name: 'tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const spacetimedb = schema({ plantEvent, tickTimer }); // keys = ctx.db accessors
export default spacetimedb;

export const init = spacetimedb.init(ctx => {
  ctx.db.tickTimer.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.interval(60_000_000n), // MICROseconds
  });
});

export const addEvent = spacetimedb.reducer(
  { plantName: t.string(), note: t.option(t.string()) },
  (ctx, { plantName, note }) => {
    if (note && note.length > MAX_NOTE_LEN) throw new SenderError('note too long');
    ctx.db.plantEvent.insert({ eventId: 0n, plantName, note, createdAt: ctx.timestamp });
  }
);

export const alwaysFails = spacetimedb.reducer(
  { reason: t.string() },
  (_ctx, { reason }) => {
    throw new SenderError(`nope: ${reason}`);
  }
);

// Scheduled reducer: bind with { onSchedule: table } (new style; the legacy
// `scheduled: (): any => fn` table option still works but is discouraged).
export const tick = spacetimedb.reducer(
  { onSchedule: tickTimer },
  { arg: tickTimer.rowType },
  (ctx, { arg }) => {
    ctx.db.plantEvent.insert({
      eventId: 0n, plantName: shout('tick'), note: `timer ${arg.scheduledId}`, createdAt: ctx.timestamp,
    });
  }
);
```

API cheat notes:
- `table(OPTIONS, COLUMNS)`. Options are `name` (snake_case, optional), `public: true`, `indexes: [...]` and `event: true`.
- Lifecycle hooks: `spacetimedb.init`, `spacetimedb.clientConnected` and `spacetimedb.clientDisconnected`, each exported.
- The `ctx` fields are `ctx.db`, `ctx.sender` (Identity), `ctx.timestamp` and `ctx.connectionId`.
- Only export the schema, reducers, lifecycle hooks and views. Keep helpers unexported (per the docs' "export rules").
- Lookups by primary key use the column name: `ctx.db.plantEvent.eventId.find(5n)`, `.update(row)`, `.delete(5n)`.
- `throw new SenderError(msg)` means a client/input error. A plain `Error` means a bug. Either one **rolls back** the transaction.
- One-shot scheduling: `ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + 10_000_000n)`.
- Republishing with schema changes: adding a column needs a default value. Otherwise use `--delete-data` (see docs: /docs/databases/automatic-migrations).

---

## 3. Publish / call / sql / logs (local)

```sh
# from the project dir (contains spacetime.json); -p points at the module dir
spacetime publish sprout-spike --server local -p spacetimedb --yes=skip-login
spacetime publish sprout-spike --server local -p spacetimedb --delete-data -y   # wipe & republish

# run these OUTSIDE the project dir, or fix spacetime.local.json first (gotcha #2)
spacetime call --server local sprout-spike add_event Fern '{"some":"watered"}'
spacetime call --server local sprout-spike add_event Moss '{"none":[]}'
spacetime call --server local sprout-spike always_fails because
#   → "Error: Response text: nope: because"  (HTTP 530, exit code 1)

spacetime sql  --server local sprout-spike "SELECT * FROM plant_event"
spacetime sql  --server local sprout-spike "SELECT * FROM plant_event WHERE plant_name = 'Basil'"
spacetime sql  --server local sprout-spike "SELECT * FROM tick_timer"
spacetime logs --server local sprout-spike          # SenderErrors show here as ERROR lines
spacetime build                                      # (in module dir) typecheck+bundle only
```

Output looks like this:
```
 event_id | plant_name | note               | created_at
----------+------------+--------------------+----------------------------------
 4        | "TICK!"    | (some = "timer 1") | 2026-10-03T20:14:27.425730+00:00
```

---

## 4. Client bindings + Node watcher (working)

```sh
spacetime generate --lang typescript --out-dir client/src/module_bindings --module-path spacetimedb -y
cd client && npm i spacetimedb@2.10.* && npm i -D tsx typescript @types/node
npx tsx src/watch.ts
```
Generated files: `index.ts`, `plant_event_table.ts`, `add_event_reducer.ts`, `always_fails_reducer.ts` and `types/`. Regenerate after **every** schema or reducer signature change.

`client/src/watch.ts` (18 lines; tested live):

```ts
import { DbConnection, tables } from './module_bindings/index.ts';

const conn = DbConnection.builder()
  .withUri(process.env.STDB_URI ?? 'ws://127.0.0.1:3000') // maincloud: https://maincloud.spacetimedb.com
  .withDatabaseName(process.env.STDB_DB ?? 'sprout-spike')
  .onConnect((conn, identity) => {
    console.log('connected as', identity.toHexString().slice(0, 12));
    conn.subscriptionBuilder()
      .onApplied(ctx => console.log('subscribed; rows in cache:', ctx.db.plantEvent.count()))
      .subscribe(tables.plantEvent);
    conn.reducers.addEvent({ plantName: 'FromNode', note: 'hello' }).catch(e => console.log('addEvent err', e));
    conn.reducers.alwaysFails({ reason: 'test' }).catch(e => console.log('alwaysFails rejected:', e?.constructor?.name, String(e)));
  })
  .onConnectError((_ctx, err) => console.error('connect error', err))
  .build();

conn.db.plantEvent.onInsert((_ctx, row) =>
  console.log('INSERT', row.eventId, row.plantName, row.note ?? '(no note)', row.createdAt.toDate().toISOString()));
```

Actual output (rows inserted by the CLI and by the timer show up live):
```
connected as c200fe31b2c1
subscribed; rows in cache: 5n
INSERT 1n Moss (no note) ...          ← existing rows fire onInsert when the subscription applies
INSERT 4n TICK! timer 1 2026-10-03T20:14:27.425Z
INSERT 6n FromNode hello ...
alwaysFails rejected: SenderError SenderError: nope: test
INSERT 7n FromCLI (no note) ...       ← spacetime call from another terminal, live
```

**Casing summary**

| Where | Table | Field | Reducer |
|---|---|---|---|
| Module source (`ctx.db`) | `plantEvent` (the schema key) | `plantName` | export `addEvent` |
| Server / CLI / SQL | `plant_event` (camel also accepted in SQL) | `plant_name` (camel also accepted) | `add_event` (only this works) |
| Generated TS client | `conn.db.plantEvent`, `tables.plantEvent` | `row.plantName` | `conn.reducers.addEvent({ plantName, note })` |

Client notes:
- `onInsert` fires for existing rows when the subscription applies, not just new ones. Use `onApplied` to tell the initial load apart from live inserts.
- Reducer calls return a Promise. It rejects with a `SenderError` instance (import `SenderError` from `'spacetimedb'` for `instanceof`).
- `subscribe(tables.x)` is the type-safe form. Raw SQL `subscribe('SELECT * FROM plant_event')` also works per docs. `subscribeToAllTables()` is fine for quick hacks.
- `Timestamp` → `.toDate()`. `u64` → `bigint`.
- The React hooks `SpacetimeDBProvider`, `useTable` and `useReducer` exist in the SDK (per docs: /docs/clients/typescript).
- `.withToken(savedToken)` keeps the same identity across reconnects. You get the token as the 3rd arg of `onConnect`; save it to localStorage.

---

## 5. Importing shared TS from outside the module folder — **YES, with one condition**

Tested with `spacetime build` / `publish`:
- ✅ `import { X } from '../../shared/constants'`, a plain TS file outside `spacetimedb/`. Builds, publishes and runs (`shout('tick')` produced `TICK!`).
- ✅ `../../../somewhere/far.ts`, outside the whole project folder, also builds.
- ❌ A shared file that **itself imports `spacetimedb`** (e.g. it shares `t.*` column defs) fails with `TS2307: Cannot find module 'spacetimedb/server'`. Resolution starts from the shared file's own directory, and no `node_modules` sits above it.
- ✅ Fix: make `node_modules` with `spacetimedb` resolvable from the shared file. Put it in a common ancestor (repo-root `package.json` / npm workspaces), or add `spacetimedb` to `shared/package.json`. With that in place the same import built fine.

**Recommendation for the repo:** keep `shared/` to pure TS (constants, types, pure functions) and it just works. If shared code needs `spacetimedb`, install it at the repo root.

---

## 6. Maincloud (hosted)

```sh
spacetime login                      # opens browser → GitHub/Google; links CLI identity to web account
spacetime login --no-browser         # prints URL instead
spacetime login show
spacetime publish sprout --server maincloud -p spacetimedb    # (maincloud is the default anyway)
spacetime publish sprout --server maincloud -p spacetimedb --delete-data
spacetime call --server maincloud sprout add_event Fern '{"none":[]}'
spacetime sql  --server maincloud sprout "SELECT * FROM plant_event"
spacetime logs --server maincloud sprout
spacetime delete sprout --server maincloud      # irreversible
```

- **Client URI:** `https://maincloud.spacetimedb.com` plus `.withDatabaseName('sprout')`. Use `ws://127.0.0.1:3000` locally.
- **Dashboard:** `https://spacetimedb.com/sprout` or `https://spacetimedb.com/@<username>/sprout`. It has logs, a SQL console and usage.
- If you published **before** logging in, the db isn't linked to your web account. Run `spacetime logout && spacetime login`.
- Database names are global on maincloud, so pick something unique like `sprout-mhacks`.
- **Free tier limits** (from the pricing page): 2,500 TeV energy per month (about 3M function calls), about 12.5 GB egress, about 1 GB table storage, up to 5 databases per project, 20 projects, 5 collaborators per db, and 1 hr of metrics history. Free dbs auto-pause after inactivity (the docs page says "a period of inactivity", pricing says "1 week") and resume in under 1s on the next connection. Pro is $25/mo.
- Teammates: each person who runs `spacetime publish` needs to be an owner or collaborator. Simplest is for one person (P1) to own publishing.
- ✅ **Tested 2026-10-03.** After `spacetime login`, `login show` reports a new identity (different from the local-only one). Then:
  ```sh
  spacetime publish sprout-spike-p1 --server maincloud -p spacetimedb --yes=remote
  # → Created new database with name: sprout-spike-p1 ... Dashboard: https://spacetimedb.com/sprout-spike-p1
  STDB_URI=https://maincloud.spacetimedb.com STDB_DB=sprout-spike-p1 npx tsx src/watch.ts
  ```
  The same watcher script works unchanged against the cloud: it connects, subscribes, sees live inserts, and gets the `SenderError` rejection. `call`, `sql` and `logs` with `--server maincloud` all work. The 60s scheduled reducer also runs in the cloud (init at 20:21:17, first tick at 20:22:17). `--yes=remote` skips the "publish to a non-local server?" prompt (needed when running non-interactively).
- The spike db `sprout-spike-p1` is still live. Delete it once you're done: `spacetime delete sprout-spike-p1 --server maincloud`. It counts toward the 5-db free limit.

---

## 7. Files in this spike

```
stdb-spike/
  spacetime.json / spacetime.local.json   # init config (server=maincloud!, random db name)
  shared/constants.ts                     # cross-folder import test
  spacetimedb/src/index.ts                # module (§2)
  client/src/watch.ts                     # Node watcher (§4)
  client/src/module_bindings/             # generated
```
Docs worth bookmarking: /docs/databases/cheat-sheet, /docs/tables/schedule-tables, /docs/clients/typescript, /docs/how-to/deploy/maincloud, /llms.txt (an index of all docs pages). Note: the old URL `/docs/modules/typescript` redirects to `/docs/functions`.
