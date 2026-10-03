import { Store } from './data/store.ts';
import { startFake, type FakeController } from './data/fake.ts';
import { connectLive, DEFAULT_DB, DEFAULT_HOST } from './data/spacetime.ts';
import { GardenWorld } from './scene/world.ts';
import { renderShed } from './ui/shed.ts';
import { renderPlan } from './ui/plan.ts';
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

async function start() {
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
function refresh() {
  const s = store.snapshot;
  renderShed(shed, s, { onFollow: (h) => world.focusOnMember(world.follow === h ? null : h), source });
  status.textContent = `${source === 'fake' ? 'demo data' : 'live'}${world.director ? ' · director' : ''}${world.follow ? ` · following ${world.follow}` : ''}`;
  if (planOn) renderPlan(plan, s, layout);
}
store.subscribe(() => requestAnimationFrame(refresh));

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'p') { planOn = !planOn; plan.hidden = !planOn; refresh(); }
  else if (k === 'd') { world.director = !world.director; if (world.director) world.follow = null; refresh(); }
  else if (k === 'h') document.body.classList.toggle('hide-ui');
  else if (k === ' ' && fake) { e.preventDefault(); fake.toggle(); }
  else if (k === 'arrowright' && fake) fake.next();
  else if (k === 'arrowleft' && fake) fake.prev();
  else if (k === 'f') { world.follow = null; world.director = false; world.frameGarden(); refresh(); }
});
plan.hidden = true;
if (q.get('debug') === '1') {
  (window as unknown as Record<string, unknown>).__garden = {
    store, world,
    setStep: (n: number) => fake?.setStep(n),
    next: () => fake?.next(),
    advance: (sec: number) => world.advance(sec),
    snapshot: () => store.snapshot,
    get fps() { return world.fps; },
    get step() { return fake?.step; },
  };
  const el = document.getElementById('fps')!; el.hidden = false;
  setInterval(() => { el.textContent = `${world.fps} fps`; }, 500);
}
// ?present=1: projector mode (big labels, no hints, director camera).
if (q.get('present') === '1') {
  document.body.classList.add('present');
  world.director = true;
}
// Keep the scene centered in the space the shed leaves free, whatever its height/width does.
new ResizeObserver(() => { if (!world.rig.userMoved) world.refit(); else world.rig.setReserved(world.reservedForShed()); }).observe(shed);
void start().then(() => world.frameGarden(true));
