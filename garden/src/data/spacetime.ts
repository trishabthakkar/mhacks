import type { Store } from './store.ts';

/**
 * Live source: subscribes to every public table via the generated bindings and
 * pushes GardenSnapshots into the Store.
 * TODO(contract): implement once P1 pushes garden/src/module_bindings (run `git pull`, then `npm run gen` output appears).
 */
export async function connectLive(_store: Store, _host: string, _db: string): Promise<() => void> {
  throw new Error('live source not available yet: waiting for P1 module_bindings');
}
