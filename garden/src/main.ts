import { Store } from './data/store.ts';
import { startFake } from './data/fake.ts';
import { connectLive } from './data/spacetime.ts';
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

const world = new GardenWorld(app, store);
world.onLayout = (l) => { layout = l; };

async function start() {
  if (source === 'live') {
    try {
      await connectLive(store, q.get('host') ?? import.meta.env?.VITE_STDB_HOST ?? '', q.get('db') ?? import.meta.env?.VITE_STDB_DB ?? 'sprout');
      return;
    } catch (e) {
      console.warn('live source failed, falling back to demo data:', e);
      source = 'fake';
    }
  }
  startFake(store, Number(q.get('speed') ?? 1) || 1);
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
  else if (k === 'f') { world.follow = null; world.director = false; world.frameGarden(); refresh(); }
});
plan.hidden = true;
if (q.get('debug') === '1') {
  const el = document.getElementById('fps')!; el.hidden = false;
  setInterval(() => { el.textContent = `${world.fps} fps`; }, 500);
}
void start().then(() => world.frameGarden());
