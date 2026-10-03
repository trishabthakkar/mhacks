// Picks the database implementation from env.
//   SPROUT_STDB_URI + SPROUT_DB  → real SpacetimeDB (TODO(contract): needs P1's bindings in src/module_bindings)
//   otherwise                    → FakeDb seeded with SPROUT_FAKE_MEMBERS (default trisha,alex,sam,jo)
import { FakeDb } from './fakeDb.ts';
import type { SproutDb } from './db.ts';

export async function openDb(): Promise<{ db: SproutDb; impl: 'fake' | 'spacetimedb' }> {
  const uri = process.env.SPROUT_STDB_URI;
  const name = process.env.SPROUT_DB;
  if (uri && name && process.env.SPROUT_FAKE_DB !== '1') {
    // TODO(contract): swap in `new StdbDb(uri, name)` once mcp/src/module_bindings exists.
    console.warn(`[sprout-mcp] SPROUT_STDB_URI is set but the real SpacetimeDB client isn't wired yet; using the in-memory fake db.`);
  }
  const db = new FakeDb();
  const members = (process.env.SPROUT_FAKE_MEMBERS ?? 'trisha,alex,sam,jo').split(',').map((s) => s.trim()).filter(Boolean);
  for (const m of members) db.seedMember(m);
  return { db, impl: 'fake' };
}
