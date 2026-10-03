import { Store } from './data/store.ts';
import { startFake, type FakeController } from './data/fake.ts';
import { startBench } from './data/bench.ts';
import { connectLive, DEFAULT_DB, DEFAULT_HOST } from './data/spacetime.ts';
import { GardenWorld } from './scene/world.ts';
import { initShed, renderShed, tickFreshness } from './ui/shed.ts';
import { initPlan, renderPlan } from './ui/plan.ts';
import type { GardenLayout } from './layout.ts';

const q = new URLSearchParams(location.search);
const store = new Store();
const app = document.getElementById('app')!;
const shed = document.getElementById('shed')!;
const plan = document.getElementById('plan')!;
const status = document.getElementById('status')!;
let source = q.get('source') === 'fake' ? 'fake' : 'live';
let layout: GardenLayout = { beds: [], plants: [], width: 0, depth: 0 };
let fake: FakeController | undefined;

const world = new GardenWorld(app, store);
world.onLayout = (l) => { layout = l; };

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

async function start() {
  const bench = Number(q.get('bench'));
  if (bench > 0) { source = 'fake'; startBench(store, Math.min(bench, 5000)); return; }
  if (source === 'live') {
    try {
      await connectLive(store, q.get('host') ?? import.meta.env?.VITE_STDB_HOST ?? DEFAULT_HOST, q.get('db') ?? import.meta.env?.VITE_STDB_DB ?? DEFAULT_DB);
      return;
    } catch (e) {
      console.warn('live source failed, falling back to demo data:', e);
      source = 'fake';
    }
  }
  const stepParam = q.get('step');
  fake = startFake(store, {
    speed: Number(q.get('speed') ?? 1) || 1,
    step: stepParam !== null && stepParam !== '' ? Number(stepParam) : undefined,
    paused: q.get('paused') === '1',
  });
}

let planOn = false;
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
  const connection = source === 'fake' ? 'demo data' : 'live';
  renderShed(shed, s, { source, connection, collapsed });
  status.textContent = `${connection}${world.director ? ' · director' : ''}${world.follow ? ` · following ${world.follow}` : ''}${world.expandAll ? ' · all plants' : ''}`;
  if (planOn) renderPlan(s, layout);
}
store.subscribe(() => requestAnimationFrame(refresh));
setInterval(() => tickFreshness(shed), 1000);
document.body.classList.toggle('shed-collapsed', collapsed);

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'p') setPlan(!planOn);
  else if (k === 's') setCollapsed(!collapsed);
  else if (k === 'd') { world.director = !world.director; if (world.director) world.follow = null; refresh(); }
  else if (k === 'h') document.body.classList.toggle('hide-ui');
  else if (k === 'b') { world.toggleExpand(); refresh(); }
  else if (k === ' ' && fake) { e.preventDefault(); fake.toggle(); }
  else if (k === 'arrowright' && fake && !planOn) fake.next();
  else if (k === 'arrowleft' && fake && !planOn) fake.prev();
  else if (k === 'f') { world.follow = null; world.director = false; world.frameGarden(); refresh(); }
});
plan.hidden = true;
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
    get fps() { return world.fps; },
    get step() { return fake?.step; },
  };
}
// ?present=1: projector mode (big labels, no hints, director camera).
if (q.get('present') === '1') {
  document.body.classList.add('present');
  world.director = true;
}
// Keep the scene centered in the space the shed leaves free, whatever its size does.
new ResizeObserver(() => { if (!world.rig.userMoved) world.refit(); }).observe(shed);
void start().then(() => world.frameGarden(true));
