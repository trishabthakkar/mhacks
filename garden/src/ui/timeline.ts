export interface TimelineState { t: number; start: number; end: number; playing: boolean; speed: number; replayLabel: string }
export interface TimelineHandlers {
  onPlayPause(): void; onScrub(t: number): void; onSpeed(dir: -1 | 1): void; onPlay30(): void; onExit(): void;
}

const fmt = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const SPEEDS = [1, 10, 60, 600];
export const speedLabel = (s: number) => (SPEEDS.includes(s) ? `${s}x` : 'fit 30s');

/** The replay bar: play/pause, scrubber with real timestamps, speed, "Play 30s", exit. */
export function initTimeline(el: HTMLElement, h: TimelineHandlers) {
  el.innerHTML = `
    <button data-tl="play" aria-label="Play or pause (Space)">▶</button>
    <input type="range" min="0" max="1000" value="0" aria-label="Scrub through the weekend" />
    <span class="tl-time" aria-live="off"></span>
    <button data-tl="slower" aria-label="Slower (,)">−</button><span class="tl-speed"></span><button data-tl="faster" aria-label="Faster (.)">+</button>
    <button data-tl="p30">Play 30s</button>
    <button data-tl="exit" aria-label="Leave the timelapse (T)">✕</button>
    <div class="tl-note">Replay: stages are rebuilt from the activity log (an approximation).</div>`;
  const range = el.querySelector('input')!;
  range.addEventListener('input', () => h.onScrub(Number(range.value) / 1000));
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tl]');
    if (!b) return;
    const a = b.dataset.tl;
    if (a === 'play') h.onPlayPause(); else if (a === 'slower') h.onSpeed(-1); else if (a === 'faster') h.onSpeed(1);
    else if (a === 'p30') h.onPlay30(); else if (a === 'exit') h.onExit();
  });
}

export function renderTimeline(el: HTMLElement, s: TimelineState) {
  const range = el.querySelector('input')!;
  if (document.activeElement !== range) range.value = String(Math.round(((s.t - s.start) / Math.max(1, s.end - s.start)) * 1000));
  el.querySelector('[data-tl="play"]')!.textContent = s.playing ? '⏸' : '▶';
  el.querySelector('.tl-time')!.textContent = `${fmt(Math.max(s.start, s.t))}  ·  ${fmt(s.start)} → ${fmt(s.end)}`;
  range.setAttribute('aria-valuetext', fmt(Math.max(s.start, s.t)));
  el.querySelector('.tl-speed')!.textContent = speedLabel(s.speed);
}

export const SPEED_STEPS = SPEEDS;
