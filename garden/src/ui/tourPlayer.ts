// Plays a judge tour: selects each stop in turn (the world flies the camera there and the shed explains it), shows
// its caption, and hands everything back at the end or on stop(). DOM-free: the caller supplies the hooks.
import type { Pick } from '../pick.ts';
import type { TourStop } from '../tour.ts';

export interface TourHooks { select(p: Pick | null): void; caption(text: string | null): void; done(): void }

export class TourPlayer {
  running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private hooks: TourHooks) {}

  start(stops: TourStop[], holdMs = 6500) {
    this.stop();
    if (!stops.length) return;
    this.running = true;
    const show = (i: number) => {
      if (!this.running) return;
      if (i >= stops.length) { this.stop(); return; }
      const s = stops[i]!;
      this.hooks.select(s.pick); this.hooks.caption(`${s.caption} (${i + 1}/${stops.length})`);
      this.timer = setTimeout(() => show(i + 1), holdMs);
    };
    show(0);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.hooks.select(null); this.hooks.caption(null); this.hooks.done();
  }
}
