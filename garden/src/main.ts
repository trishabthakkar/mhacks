import { Store } from './data/store.ts';
import { startFake, type FakeController } from './data/fake.ts';
import { startBench } from './data/bench.ts';
import { connectLive, DEFAULT_DB, DEFAULT_HOST, loadHistory, type LiveState } from './data/spacetime.ts';
import { historyFromSnapshot, Replay } from './data/timelapse.ts';
import { FAKE_STEPS, makeFakeSnapshots } from '../../shared/fake-data.ts';
import { initTimeline, renderTimeline, SPEED_STEPS } from './ui/timeline.ts';
import type { GardenSnapshot } from '../../shared/types.ts';
import { GardenWorld } from './scene/world.ts';
import { initShed, renderShed, tickFreshness } from './ui/shed.ts';
import { createAnnouncer, summarize } from './ui/announce.ts';
import './ui/board.css';
import './ui/shed.css';
import type { Pick } from './pick.ts';
import { inspect } from './ui/inspect.ts';
import { repoName } from './boundary.ts';
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
// The status chip: text plus a visible pause control for the looping demo timeline (WCAG 2.2.2).
const statusText = document.createElement('span');
const pauseBtn = document.createElement('button'); pauseBtn.hidden = true; pauseBtn.type = 'button';
status.append(statusText, pauseBtn);
pauseBtn.addEventListener('click', () => { fake?.toggle(); refresh(); });
const toasts = document.getElementById('toasts')!;
const cueEl = document.getElementById('cue')!;
const helpEl = document.getElementById('help')!;
const guideEl = document.getElementById('guide')!;
const timelineEl = document.getElementById('timeline')!;
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
world.onFollowEnd = () => refresh();
world.onError = reportError;
world.onShedClick = () => setCollapsed(!collapsed);
world.onSelect = (p) => setSelected(p);
const announcer = createAnnouncer(document.getElementById('announcer')!);
const srSummary = document.getElementById('sr-summary')!;
if (world.available) {
  const c = world.renderer.domElement;
  c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Interactive 3D garden. Drag to look around. Press the question mark for keys.'); c.setAttribute('aria-describedby', 'sr-summary');
}

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
// What the shed inspector shows (a plant, bed, gardener...), or null for the Team / Activity tabs.
let selected: Pick | null = null;
function setSelected(p: Pick | null) {
  if (p?.kind === 'shed') { setCollapsed(!collapsed); return; }
  selected = p;
  world.setSelected(p);
  if (p && collapsed) setCollapsed(false); else refresh();
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
// Live snapshots pass through a gate so a timelapse can borrow the Store without the live feed overwriting it.
let replaying = false;
let liveLatest: GardenSnapshot | undefined;
const liveSink = { set(snap: GardenSnapshot, reset = false) { liveLatest = snap; if (!replaying) store.set(snap, reset); } };

async function goLive(): Promise<boolean> {
  setConn({ state: 'connecting', attempt: 0 });
  try {
    stopLive = await connectLive(liveSink, liveHost(), liveDb(), 10_000, (st: LiveState) =>
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
/** ?scenario=handoff (demo data only, use with &paused=1): offer one handoff that is accepted and one that is declined. */
function runScenario(name: string) {
  if (name !== 'handoff') return;
  const base = store.snapshot;
  const [a, b, c] = base.members.map((m) => m.handle);
  if (!a || !b || !c) return;
  const row = (id: number, from: string, to: string, task: string, status: 'offered' | 'accepted' | 'declined') =>
    ({ id, fromHandle: from, toHandle: to, task, notes: '', status, createdAt: base.at });
  const set = (hs: ReturnType<typeof row>[]) => store.set({ ...store.snapshot, handoffs: hs });
  setTimeout(() => set([row(1, a, b, 'Finish the auth tests', 'offered')]), 1500);
  setTimeout(() => set([row(1, a, b, 'Finish the auth tests', 'accepted')]), 11000);
  setTimeout(() => set([row(1, a, b, 'Finish the auth tests', 'accepted'), row(2, b, c, 'Review the API docs', 'offered')]), 16000);
  setTimeout(() => set([row(1, a, b, 'Finish the auth tests', 'accepted'), row(2, b, c, 'Review the API docs', 'declined')]), 26000);
}

async function retryLive() {
  fake?.stop(); fake = undefined; stopLive?.();
  if (!(await goLive())) goDemo();
}

// ---- timelapse (seasons) ----
let replay: Replay | undefined;
let tNow = 0, playing = false, speed = 60;
let tlTimer: ReturnType<typeof setInterval> | undefined;
const speedTo30 = () => (replay ? (replay.end - replay.start) / 30 : 60);

function tlRender() { if (replay) renderTimeline(timelineEl, { t: tNow, start: replay.start, end: replay.end, playing, speed, replayLabel: 'replay' }); }
function tlApply(forward: boolean) {
  if (!replay) return;
  store.set(replay.snapshotAt(tNow), !forward);
  world.setSeason(replay.progress(tNow));
  tlRender();
}
function tlStart() {
  clearInterval(tlTimer);
  tlTimer = setInterval(() => {
    if (!replay || !playing) return;
    tNow = Math.min(replay.end, tNow + speed * 100); // 100 ms of real time * speed
    tlApply(true);
    if (tNow >= replay.end) { playing = false; tlRender(); }
  }, 100);
}
async function enterTimelapse(autoplay30 = false) {
  if (replaying) return;
  toast('Loading the weekend…');
  let hist;
  try { hist = source === 'live' ? await loadHistory(liveHost(), liveDb()) : historyFromSnapshot(makeFakeSnapshots(FAKE_STEPS + 1).at(-1)!); }
  catch (e) { console.warn('history failed, using demo story', e); toast('Could not load the live history: showing the demo story.'); hist = historyFromSnapshot(makeFakeSnapshots(FAKE_STEPS + 1).at(-1)!); }
  if (!hist.activity.length) { toast('Nothing to replay yet: the activity log is empty.'); return; }
  fake?.stop();
  replay = new Replay(hist); replaying = true; world.setCalm(world.calm); document.body.classList.add('timelapse');
  timelineEl.hidden = false;
  tNow = replay.start - 1; speed = 60; playing = false;
  tlApply(false); tlStart(); setPlan(false);
  if (autoplay30 && !world.reducedMotion) { speed = speedTo30(); playing = true; tlRender(); } // never auto-play for people who asked for less motion
}
function exitTimelapse() {
  if (!replaying) return;
  replaying = false; playing = false; clearInterval(tlTimer); replay = undefined;
  document.body.classList.remove('timelapse'); timelineEl.hidden = true; world.setSeason(null);
  if (conn.state === 'demo') goDemo(); else if (liveLatest) store.set(liveLatest, true);
}
initTimeline(timelineEl, {
  onPlayPause: () => { if (!replay) return; if (tNow >= replay.end) tNow = replay.start - 1; playing = !playing; tlRender(); },
  onScrub: (f) => { if (!replay) return; tNow = replay.start + f * (replay.end - replay.start); tlApply(false); },
  onSpeed: (dir) => {
    const i = SPEED_STEPS.indexOf(speed);
    speed = SPEED_STEPS[Math.min(SPEED_STEPS.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))]!; tlRender();
  },
  onPlay30: () => { if (!replay) return; tNow = replay.start - 1; speed = speedTo30(); playing = true; tlApply(false); },
  onExit: exitTimelapse,
});

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
  onSelect: (p) => { if (planOn) setPlan(false); setSelected(p); },
  onToggle: () => setCollapsed(!collapsed),
});
shed.addEventListener('shed-rerender', () => refresh());
initPlan(plan, {
  onShowIn3D: (path) => { setPlan(false); world.focus('fence', path); },
  onClose: () => setPlan(false),
});

function refresh() {
  const s = store.snapshot;
  const connection = conn.state === 'live' ? 'live' : conn.state === 'connecting' ? 'connecting…' : conn.state === 'reconnecting' ? `reconnecting (${conn.attempt})` : 'demo data';
  const repo = repoName(q, s, liveDb());
  if (selected && !inspect(selected, s, { repo })) { selected = null; world.setSelected(null); } // the subject left the garden
  renderShed(shed, s, { source, connection, collapsed, following: world.follow, selected, repo });
  emptyState.hidden = s.plants.length > 0 || conn.state === 'connecting';
  // The chip only carries what the shed pill doesn't: camera modes and the demo pause control.
  const modes = `${world.director ? 'director' : ''}${world.follow ? `${world.director ? ' · ' : ''}following ${world.followLabel}` : ''}${world.expandAll ? ' · all plants' : ''}`;
  statusText.textContent = conn.state === 'live' ? modes : `${connection}${modes ? ` · ${modes}` : ''}`;
  pauseBtn.hidden = !(fake && !replaying);
  status.hidden = !statusText.textContent && pauseBtn.hidden;
  if (fake) pauseBtn.textContent = fake.paused ? '▶ Resume demo' : '⏸ Pause demo';
  const sum = summarize(s); if (srSummary.textContent !== sum) srSummary.textContent = sum;
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
  for (const a of u.newActivity) { seen(a.kind); announcer.push(a); }
  if (cueOn && u.newActivity.length) renderCue(cueEl);
  requestAnimationFrame(refresh);
});
// Two small dialogs: keys (?) and the guide to what everything means (G). Opening one closes the other.
let dialogReturn: HTMLElement | null = null;
function setDialog(el: HTMLElement, cardSel: string, on: boolean) {
  if (on === !el.hidden) return;
  if (on) for (const other of [helpEl, guideEl]) if (other !== el) other.hidden = true;
  el.hidden = !on;
  if (on) { dialogReturn ??= document.activeElement as HTMLElement | null; el.querySelector<HTMLElement>(cardSel)?.focus(); }
  else { dialogReturn?.focus?.(); dialogReturn = null; }
}
const setHelp = (on: boolean) => setDialog(helpEl, '.help-card', on);
const setGuide = (on: boolean) => setDialog(guideEl, '.guide-card', on);
for (const [el, sel] of [[helpEl, '.help-card'], [guideEl, '.guide-card']] as const) {
  el.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); el.querySelector<HTMLElement>(sel)?.focus(); } }); // nothing else to tab to
  el.addEventListener('click', () => setDialog(el, sel, false));
}
document.getElementById('keys')?.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
  if (b?.dataset.open === 'help') setHelp(helpEl.hidden);
  else if (b?.dataset.open === 'guide') setGuide(guideEl.hidden);
});
setInterval(() => tickFreshness(shed), 1000);
document.body.classList.toggle('shed-collapsed', collapsed);

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === '?' || k === '/') { setHelp(helpEl.hidden); return; }
  if (k === 'g') { setGuide(guideEl.hidden); return; }
  if (k === 'escape' && selected && helpEl.hidden && guideEl.hidden) { setSelected(null); return; }
  if (k === 'escape' && !helpEl.hidden) { setHelp(false); return; }
  if (k === 'escape' && !guideEl.hidden) { setGuide(false); return; }
  if (k === 'c') { setCue(!cueOn); return; }
  if (k === 't') { if (replaying) exitTimelapse(); else void enterTimelapse(); return; }
  if (replaying && (k === ',' || k === '.')) { timelineEl.querySelector<HTMLElement>(k === ',' ? '[data-tl=slower]' : '[data-tl=faster]')?.click(); return; }
  if (replaying && k === ' ') { e.preventDefault(); timelineEl.querySelector<HTMLElement>('[data-tl=play]')?.click(); return; }
  if (k === 'p') setPlan(!planOn);
  else if (k === 's') setCollapsed(!collapsed);
  else if (k === 'd') { world.director = !world.director; if (world.director) world.follow = null; refresh(); }
  else if (k === 'h') document.body.classList.toggle('hide-ui');
  else if (k === 'b') { world.toggleExpand(); refresh(); }
  else if (k === 'm') { calm = !calm; world.setCalm(calm); toast(calm ? 'Calm mode on: gentler motion' : 'Calm mode off'); }
  else if (k === 'k') { document.body.classList.toggle('hc'); }
  else if (k === 'l') { world.setPlantLabels(!world.showPlantLabels); }
  else if (k === ' ' && fake && !replaying) { e.preventDefault(); fake.toggle(); }
  else if (k === 'arrowright' && fake && !planOn && !replaying) fake.next();
  else if (k === 'arrowleft' && fake && !planOn && !replaying) fake.prev();
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
void start().then(() => { world.frameGarden(true); if (q.get('mode') === 'timelapse') void enterTimelapse(q.get('present') === '1' || q.get('autoplay') === '1'); if (q.get('scenario') && source === 'fake') runScenario(q.get('scenario')!); if (shot) setTimeout(() => applyShot(shot, world, () => setPlan(true)), 400); });
