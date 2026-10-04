import type { AgentView, GardenSnapshot, PlantStage, PlantView } from '../../../shared/types.ts';
import { MEMBER_COLORS } from '../../../shared/constants.ts';
import type { Store } from './store.ts';

/** Small deterministic PRNG so benchmark runs are comparable. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const STAGES: PlantStage[] = ['seed', 'sprout', 'growing', 'growing', 'growing', 'bud', 'bloom', 'dormant'];
const NAMES = ['seno', 'manahil', 'shriya', 'trisha'];

/** A synthetic garden of `n` plants across ~n/30 beds, with mixed stages, bugs, claims and agents. */
export function makeBenchSnapshot(n: number, seed = 7, at = Date.UTC(2026, 9, 3, 16, 0, 0)): GardenSnapshot {
  const r = rng(seed);
  const beds = Math.max(3, Math.round(n / 30));
  const plants: PlantView[] = [];
  for (let i = 0; i < n; i++) {
    const bed = `dir${i % beds}`;
    const stage = STAGES[Math.floor(r() * STAGES.length)]!;
    plants.push({
      path: `${bed}/file${i}.ts`, bed, lines: Math.floor(10 + r() * 400), stage,
      bugs: stage === 'growing' && r() < 0.1 ? 1 + Math.floor(r() * 4) : 0,
      lastActivity: at - (r() < 0.1 ? Math.floor(r() * 20 * 60_000) : 60 * 60_000 + Math.floor(r() * 5 * 3_600_000)),
    });
  }
  const members = NAMES.map((handle, i) => ({ handle, color: MEMBER_COLORS[i]!, online: true, paused: false, lastSeen: at }));
  const agents: AgentView[] = NAMES.map((handle, i) => ({
    sessionId: `b${i}`, handle, kind: 'claude', status: 'working', currentPath: plants[Math.floor(r() * n)]!.path, currentAction: 'edit', lastSeen: at,
  }));
  return {
    at, members, agents, plants,
    claims: [{ id: 1, path: 'dir0/', handle: 'seno', createdAt: at, expiresAt: at + 3_600_000 }],
    messages: [], testRuns: [], certifications: [], activity: [],
  };
}

/** Feed the store a snapshot that keeps changing (stages, bugs, who works where), like a busy team. */
export function startBench(store: Store, n: number): () => void {
  let snap = makeBenchSnapshot(n);
  store.set(snap, true);
  const r = rng(99);
  let tick = 0;
  const id = setInterval(() => {
    tick++;
    const next: GardenSnapshot = { ...snap, at: snap.at + 5_000, plants: snap.plants.slice(), agents: snap.agents.slice() };
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(r() * next.plants.length), p = next.plants[i]!;
      const stage = STAGES[Math.floor(r() * STAGES.length)]!;
      next.plants[i] = { ...p, stage, bugs: stage === 'growing' && r() < 0.3 ? 1 + Math.floor(r() * 3) : 0, lastActivity: next.at };
    }
    next.agents = next.agents.map((a) => ({ ...a, currentPath: next.plants[Math.floor(r() * next.plants.length)]!.path, lastSeen: next.at }));
    snap = next;
    store.set(snap);
  }, 600);
  return () => clearInterval(id);
}
