import { FAKE_STEPS, makeFakeSnapshots } from '../../../shared/fake-data.ts';
import type { Store } from './store.ts';

/** Steps through the fake timeline, looping. Returns a stop function. */
export function startFake(store: Store, speed = 1): () => void {
  const frames = makeFakeSnapshots(FAKE_STEPS + 1);
  const stepMs = 3200 / speed;
  let i = 0;
  store.set(frames[0]!, true);
  const id = setInterval(() => {
    i++;
    if (i > FAKE_STEPS + 2) { i = 0; store.set(frames[0]!, true); return; } // hold the final bloom a couple of ticks
    const f = frames[Math.min(i, FAKE_STEPS)]!;
    store.set(f);
  }, stepMs);
  return () => clearInterval(id);
}
