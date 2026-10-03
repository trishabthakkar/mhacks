import { FAKE_STEPS, makeFakeSnapshots } from '../../../shared/fake-data.ts';
import type { Store } from './store.ts';

export interface FakeController {
  /** Jump to a timeline step (0 = bare soil .. FAKE_STEPS = full bloom) without replaying events. */
  setStep(n: number): void;
  /** Move one frame; forward emits events (animations play), backward resets. */
  next(): void;
  prev(): void;
  pause(): void;
  resume(): void;
  toggle(): boolean;
  readonly step: number;
  readonly paused: boolean;
  stop(): void;
}

export interface FakeOptions {
  speed?: number;
  /** Freeze on this step and never advance. */
  step?: number;
  paused?: boolean;
  /** Restart after the final frame (default true). */
  loop?: boolean;
}

/** Steps through the fake timeline. */
export function startFake(store: Store, opts: FakeOptions = {}): FakeController {
  const frames = makeFakeSnapshots(FAKE_STEPS + 1);
  const stepMs = 3200 / (opts.speed && opts.speed > 0 ? opts.speed : 1);
  const loop = opts.loop ?? true;
  const clamp = (n: number) => Math.max(0, Math.min(FAKE_STEPS, Math.round(n)));
  let i = opts.step !== undefined ? clamp(opts.step) : 0;
  let paused = opts.paused === true || opts.step !== undefined;
  let hold = 0; // ticks to hold the final bloom before looping

  store.set(frames[i]!, true);

  const tick = () => {
    if (paused) return;
    if (i >= FAKE_STEPS) {
      if (!loop) return;
      if (++hold > 2) { hold = 0; i = 0; store.set(frames[0]!, true); }
      return;
    }
    i++;
    store.set(frames[i]!);
  };
  const id = setInterval(tick, stepMs);

  return {
    setStep(n) { i = clamp(n); hold = 0; store.set(frames[i]!, true); },
    next() { if (i < FAKE_STEPS) { i++; store.set(frames[i]!); } },
    prev() { if (i > 0) { i--; store.set(frames[i]!, true); } },
    pause() { paused = true; },
    resume() { paused = false; },
    toggle() { paused = !paused; return paused; },
    get step() { return i; },
    get paused() { return paused; },
    stop() { clearInterval(id); },
  };
}
