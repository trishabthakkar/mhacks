// Picks the database implementation from env.
//   SPROUT_STDB_URI + SPROUT_DB → real SpacetimeDB (StdbDb, P1's generated bindings)
//   SPROUT_FAKE_DB=1 or no URI  → FakeDb seeded with SPROUT_FAKE_MEMBERS (default trisha,alex,sam,jo)
import { FakeDb } from './fakeDb.ts';
import type { SproutDb } from './db.ts';
import { StdbDb } from './stdbDb.ts';

export async function openDb(): Promise<{ db: SproutDb; impl: 'fake' | 'spacetimedb' }> {
  const uri = process.env.SPROUT_STDB_URI;
  const name = process.env.SPROUT_DB;
  if (uri && name && process.env.SPROUT_FAKE_DB !== '1') {
    const db = new StdbDb(uri, name);
    // Don't block startup: /health reports db:'disconnected' and tools ask to retry until live.
    db.ready(15_000).catch((e) => console.warn(`[sprout-mcp] ${e.message}; still retrying in the background`));
    return { db, impl: 'spacetimedb' };
  }
  console.warn('[sprout-mcp] SPROUT_STDB_URI/SPROUT_DB not set: using the in-memory fake db (state is lost on restart).');
  const db = new FakeDb();
  const members = (process.env.SPROUT_FAKE_MEMBERS ?? 'trisha,alex,sam,jo').split(',').map((s) => s.trim()).filter(Boolean);
  for (const m of members) db.seedMember(m);
  return { db, impl: 'fake' };
}
