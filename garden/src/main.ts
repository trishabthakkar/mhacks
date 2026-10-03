import { Store } from './data/store.ts';
import { startFake, type FakeController } from './data/fake.ts';
import { startBench } from './data/bench.ts';
import { connectLive, DEFAULT_DB, DEFAULT_HOST, type LiveState } from './data/spacetime.ts';
import { GardenWorld } from './scene/world.ts';
import { initShed, renderShed, tickFreshness } from './ui/shed.ts';
import { initPlan, renderPlan } from './ui/plan.ts';
import { CUE_STEPS, renderCue, resetCue, seen, toggleManual } from './ui/cue.ts';
import { applyShot } from './ui/shots.ts';
import type { GardenLayout } from './layout.ts';

const q = new URLSearchParams(location.search);
const store = new Store();
const app = document.getElementById('app')!;
const shed = document.getElementById('shed')!;
const plan = document.getElementById('plan')!;
const status = document.getElementById('status')!;
const emptyState = document.getElementById('empty')!;
const toasts = document.getElementById('toasts')!;
const cueEl = document.getElementById('cue')!;
const helpEl = document.getElementById('help')!;
let source: 'live' | 'fake' = q.get('source') === 'fake' ? 'fake' : 'live';
let layout: GardenLayout = { beds: [], plants: [], width: 0, depth: 0 };
let fake: FakeController | undefined;
const errors: string[] = [];
let lastToast = 0;
function toast(msg: string) {
  const now = Date.now();
  if (now - lastToast < 4000) return; // one at a time, never a flood
  lastToast = now;
  const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg;
  toasts.appendChild(el); setTimeout(() => el.remove(), 6000);
}
function reportError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  errors.push(`${new Date().toISOString()} ${msg}`); if (errors.length > 50) errors.shift();
  console.error('[garden]', e);
  toast('Something glitched, but the garden is still running.');
}
addEventListener('error', (e) => reportError(e.error ?? e.message));
addEventListener('unhandledrejection', (e) => reportError(e.reason));

const world = new GardenWorld(app, store);
world.onLayout = (l) => { layout = l; };
world.onError = reportError;

// Remember the shed's open/closed state (storage can be blocked: never depend on it).
const KEY = 'sprout.shed.collapsed';
let collapsed = false;
try { collapsed = localStorage.getItem(KEY) === '1'; } catch { /* private window */ }
if (innerWidth < 900) collapsed = true; // start small screens with the shed closed
function setCollapsed(v: boolean) {
  collapsed = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  document.body.classList.toggle('shed-collapsed', v);
  refresh();
  world.refit();
}

// ---- connection state ----
type Conn = { state: 'connecting' | 'live' | 'reconnecting' | 'demo'; attempt: number };
let conn: Conn = { state: source === 'live' ? 'connecting' : 'demo', attempt: 0 };
let stopLive: (() => void) | undefined;
const banner = document.getElementById('banner')!;

function setConn(c: Conn) {
  conn = c;
  source = c.state === 'demo' ? 'fake' : 'live';
  document.body.classList.toggle('stale', c.state === 'reconnecting'); // last known state, dimmed
  renderBanner();
  refresh();
}
function renderBanner() {
  if (conn.state === 'live' || (conn.state === 'demo' && q.get('badge') === '0')) { banner.hidden = true; return; }
  banner.hidden = false;
  const msg = conn.state === 'connecting' ? '<span class="spin" aria-hidden="true"></span> Connecting to the garden…'
    : conn.state === 'reconnecting' ? `<span class="spin" aria-hidden="true"></span> Connection lost: showing the last known garden. Reconnecting (attempt ${conn.attempt})…`
    : `Showing demo data${q.get('source') === 'fake' || q.get('bench') ? '' : ': couldn\'t reach the live garden'}. <button data-retry>Retry live</button>`;
  banner.innerHTML = msg;
}
banner.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-retry]')) void retryLive(); });

const liveHost = () => q.get('host') ?? import.meta.env?.VITE_STDB_HOST ?? DEFAULT_HOST;
const liveDb = () => q.get('db') ?? import.meta.env?.VITE_STDB_DB ?? DEFAULT_DB;
async function goLive(): Promise<boolean> {
  setConn({ state: 'connecting', attempt: 0 });
  try {
    stopLive = await connectLive(store, liveHost(), liveDb(), 10_000, (st: LiveState) =>
      setConn(st.state === 'live' ? { state: 'live', attempt: 0 } : { state: 'reconnecting', attempt: st.attempt }));
    setConn({ state: 'live', attempt: 0 });
    return true;
  } catch (e) {
    console.warn('live source failed, falling back to demo data:', e);
    return false;
  }
}
function goDemo() {
  fake?.stop();
  const stepParam = q.get('step');
  fake = startFake(store, {
    speed: Number(q.get('speed') ?? 1) || 1,
    step: stepParam !== null && stepParam !== '' ? Number(stepParam) : undefined,
    paused: q.get('paused') === '1',
    loop: q.get('loop') !== '0',
  });
  setConn({ state: 'demo', attempt: 0 });
}
async function retryLive() {
  fake?.stop(); fake = undefined; stopLive?.();
  if (!(await goLive())) goDemo();
}

async function start() {
  const bench = Number(q.get('bench'));
  if (bench > 0) { startBench(store, Math.min(bench, 5000)); setConn({ state: 'demo', attempt: 0 }); return; }
  if (source === 'live' && (await goLive())) return;
  goDemo();
}

let planOn = false;
let calm = false;
function setPlan(on: boolean) {
  planOn = on; plan.hidden = !on;
  document.body.classList.toggle('plan-open', on);
  if (on) renderPlan(store.snapshot, layout);
}

initShed(shed, {
  onFocus: (kind, key) => { if (planOn) setPlan(false); world.focus(kind, key); refresh(); },
  onToggle: () => setCollapsed(!collapsed),
});
shed.addEventListener('shed-rerender', () => refresh());
initPlan(plan, {
  onShowIn3D: (path) => { setPlan(false); world.focus('plant', path); },
  onClose: () => setPlan(false),
});

function refresh() {
  const s = store.snapshot;
  const connection = conn.state === 'live' ? 'live' : conn.state === 'connecting' ? 'connecting…' : conn.state === 'reconnecting' ? `reconnecting (${conn.attempt})` : 'demo data';
  renderShed(shed, s, { source, connection, collapsed });
  emptyState.hidden = s.plants.length > 0 || conn.state === 'connecting';
  status.textContent = `${connection}${world.director ? ' · director' : ''}${world.follow ? ` · following ${world.follow}` : ''}${world.expandAll ? ' · all plants' : ''}`;
  if (planOn) renderPlan(s, layout);
}
let cueOn = false;
function setCue(on: boolean) { cueOn = on; cueEl.hidden = !on; if (on) renderCue(cueEl); }
cueEl.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const step = t.closest<HTMLElement>('[data-cue]');
  if (step) toggleManual(Number(step.dataset.cue));
  if (t.closest('[data-cue-reset]')) resetCue();
  renderCue(cueEl);
});
store.subscribe((u) => {
  for (const a of u.newActivity) seen(a.kind);
  if (cueOn && u.newActivity.length) renderCue(cueEl);
  requestAnimationFrame(refresh);
});
function setHelp(on: boolean) { helpEl.hidden = !on; }
helpEl.addEventListener('click', () => setHelp(false));
setInterval(() => tickFreshness(shed), 1000);
document.body.classList.toggle('shed-collapsed', collapsed);

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === '?' || k === '/') { setHelp(helpEl.hidden); return; }
  if (k === 'escape' && !helpEl.hidden) { setHelp(false); return; }
  if (k === 'c') { setCue(!cueOn); return; }
  if (k === 'p') setPlan(!planOn);
  else if (k === 's') setCollapsed(!collapsed);
  else if (k === 'd') { world.director = !world.director; if (world.director) world.follow = null; refresh(); }
  else if (k === 'h') document.body.classList.toggle('hide-ui');
  else if (k === 'b') { world.toggleExpand(); refresh(); }
  else if (k === 'm') { calm = !calm; world.setCalm(calm); toast(calm ? 'Calm mode on: gentler motion' : 'Calm mode off'); }
  else if (k === 'k') { document.body.classList.toggle('hc'); }
  else if (k === 'l') { world.setPlantLabels(!world.showPlantLabels); }
  else if (k === ' ' && fake) { e.preventDefault(); fake.toggle(); }
  else if (k === 'arrowright' && fake && !planOn) fake.next();
  else if (k === 'arrowleft' && fake && !planOn) fake.prev();
  else if (k === 'f') { world.follow = null; world.director = false; world.frameGarden(); refresh(); }
});
plan.hidden = true;
if (!world.available) {
  // No WebGL: the plan view is a complete way to see the garden.
  document.body.classList.add('no-gl');
  toast('3D is unavailable on this device, so here is the garden plan.');
  setPlan(true);
}
// A weak machine: if frames arrive but slowly for a while, offer the plan view instead of a slideshow.
// (A hidden tab delivers almost no frames, which is not "slow", so it is ignored.)
let slowFor = 0;
setInterval(() => {
  if (!world.available || q.get('autofallback') === '0' || document.hidden || planOn) { slowFor = 0; return; }
  slowFor = world.fps >= 8 && world.fps < 20 ? slowFor + 1 : 0;
  if (slowFor === 6) toast('This machine is struggling with 3D. Press P for the garden plan, or add ?quality=low.');
}, 1000);
if (q.get('debug') === '1') {
  const el = document.getElementById('fps')!; el.hidden = false;
  setInterval(() => { el.textContent = `${world.fps} fps`; }, 500);
  (window as unknown as Record<string, unknown>).__garden = {
    store, world,
    setStep: (n: number) => fake?.setStep(n),
    next: () => fake?.next(),
    advance: (sec: number) => world.advance(sec),
    bench: (frames = 120) => world.benchFrames(frames),
    snapshot: () => store.snapshot,
    errors,
    get fps() { return world.fps; },
    get step() { return fake?.step; },
  };
}
if (q.get('badge') === '0') document.body.classList.add('no-badge');
void CUE_STEPS; // (the strip lists every step; see ui/cue.ts)
// ?shot=full|bed-src|botanist|plan: repeatable camera for screenshots.
const shot = q.get('shot');
// ?present=1: projector mode (big labels, no hints, director camera).
if (q.get('present') === '1') {
  document.body.classList.add('present');
  world.director = true;
}
// Keep the scene centered in the space the shed leaves free, whatever its size does.
new ResizeObserver(() => { if (!world.rig.userMoved) world.refit(); }).observe(shed);
void start().then(() => { world.frameGarden(true); if (shot) setTimeout(() => applyShot(shot, world, () => setPlan(true)), 400); });
