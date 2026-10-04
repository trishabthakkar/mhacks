import type { ActivityView, GardenSnapshot } from '../../../shared/types.ts';

export type TableName = Exclude<keyof GardenSnapshot, 'at'>;
export interface StoreEvent { table: TableName; op: 'inserted' | 'updated' | 'deleted'; row: unknown; prev?: unknown }
export interface StoreUpdate { snapshot: GardenSnapshot; events: StoreEvent[]; newActivity: ActivityView[]; reset: boolean }

const KEYS: Record<TableName, string> = {
  members: 'handle', agents: 'sessionId', plants: 'path', claims: 'id', messages: 'id',
  testRuns: 'id', certifications: 'id', activity: 'id', handoffs: 'id',
  tasks: 'id', taskItems: 'id',
};

export const emptySnapshot = (): GardenSnapshot => ({
  at: 0, members: [], agents: [], plants: [], claims: [], messages: [], testRuns: [], certifications: [], activity: [],
});

/** The scene only talks to the Store: current snapshot + change events. */
export class Store {
  snapshot: GardenSnapshot = emptySnapshot();
  private listeners = new Set<(u: StoreUpdate) => void>();

  subscribe(cb: (u: StoreUpdate) => void): () => void {
    this.listeners.add(cb);
    cb({ snapshot: this.snapshot, events: [], newActivity: [], reset: true });
    return () => this.listeners.delete(cb);
  }

  /** Replace state and emit per-table inserted/updated/deleted events. `reset` skips diffing (e.g. timeline loop). */
  set(next: GardenSnapshot, reset = false): void {
    const events: StoreEvent[] = [];
    let newActivity: ActivityView[] = [];
    if (!reset) {
      for (const table of Object.keys(KEYS) as TableName[]) {
        const key = KEYS[table];
        const prev = new Map(((this.snapshot[table] ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r[key]), r]));
        const seen = new Set<string>();
        for (const row of (next[table] ?? []) as unknown as Record<string, unknown>[]) {
          const k = String(row[key]); seen.add(k);
          const old = prev.get(k);
          if (!old) events.push({ table, op: 'inserted', row });
          else if (JSON.stringify(old) !== JSON.stringify(row)) events.push({ table, op: 'updated', row, prev: old });
        }
        for (const [k, old] of prev) if (!seen.has(k)) events.push({ table, op: 'deleted', row: old });
      }
      newActivity = events.filter((e) => e.table === 'activity' && e.op === 'inserted').map((e) => e.row as ActivityView);
    }
    this.snapshot = next;
    for (const cb of this.listeners) cb({ snapshot: next, events, newActivity, reset });
  }
}
