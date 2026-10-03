import type {
  ActivityView, AgentView, CertificationView, ClaimView, GardenSnapshot, MemberView, MessageView, PlantStage, PlantView,
} from '../../../shared/types.ts';

/** What a replay needs: the final plants (for layout), the whole activity log, verdicts and members. */
export interface HistoryInput {
  plants: PlantView[];
  activity: ActivityView[];
  certifications: CertificationView[];
  members: MemberView[];
}

const MIN = 60_000;
const CLAIM_SPAN = 3 * 60 * MIN;
const ACTIVE_MS = 90_000;
const WINDOW = 40;
const ORDER: Record<PlantStage, number> = { seed: 0, sprout: 1, growing: 2, bud: 3, bloom: 4, dormant: 0 };

interface Plant extends PlantView { }

/**
 * Rebuilds the garden at any moment of the weekend from the activity log. It is an approximation (stages follow
 * activity order, the way the live rules do), labelled "replay" in the UI. Pure and deterministic.
 */
export class Replay {
  readonly start: number;
  readonly end: number;
  private events: ActivityView[];
  private final: PlantView[];
  private members: MemberView[];
  private certs: CertificationView[];
  // incremental state
  private cursor = 0;
  private lastT = -Infinity;
  private plants = new Map<string, Plant>();
  private claims = new Map<string, ClaimView>();
  private messages = new Map<number, MessageView>();
  private lastAct = new Map<string, { at: number; path?: string; kind: string; first: number; sessionEnded: boolean }>();
  private nextClaimId = 1;

  constructor(h: HistoryInput) {
    this.events = h.activity.slice().sort((a, b) => a.at - b.at || a.id - b.id);
    this.final = h.plants;
    this.members = h.members;
    this.certs = h.certifications.slice().sort((a, b) => a.at - b.at);
    this.start = this.events[0]?.at ?? Date.now();
    this.end = this.events.length ? Math.max(this.events.at(-1)!.at, ...this.certs.map((c) => c.at)) : this.start + 1;
    this.reset();
  }

  get eventCount() { return this.events.length; }

  private reset() {
    this.cursor = 0; this.lastT = -Infinity; this.nextClaimId = 1;
    this.plants.clear(); this.claims.clear(); this.messages.clear(); this.lastAct.clear();
    for (const p of this.final) {
      this.plants.set(p.path, { path: p.path, bed: p.bed, lines: p.lines, stage: 'seed', bugs: 0, lastActivity: this.start - 1 });
    }
  }

  private plant(path: string): Plant {
    let p = this.plants.get(path);
    if (!p) {
      const bed = path.includes('/') ? path.split('/')[0]! : '(root)';
      p = { path, bed, lines: 0, stage: 'seed', bugs: 0, lastActivity: this.start };
      this.plants.set(path, p);
    }
    return p;
  }
  private raise(p: Plant, to: PlantStage) { if (ORDER[to] > ORDER[p.stage]) p.stage = to; }

  private apply(e: ActivityView) {
    const who = e.handle;
    const la = this.lastAct.get(who) ?? { at: e.at, kind: e.kind, first: e.at, sessionEnded: false };
    la.at = e.at; la.kind = e.kind; if (e.path) la.path = e.path; la.sessionEnded = e.kind === 'session_end';
    this.lastAct.set(who, la);
    // Only these kinds mean the agent worked on the file; a blocked edit or a subagent glance does not.
    const WORK = new Set(['read', 'search', 'bash', 'edit', 'create', 'delete', 'file_change', 'certify_bloom', 'certify_refused']);
    const p = e.path && WORK.has(e.kind) ? this.plant(e.path) : undefined;
    if (p) {
      p.lastActivity = e.at;
      if (['edit', 'create', 'delete', 'file_change'].includes(e.kind)) p.lastTouchedBy = who;
    }
    switch (e.kind) {
      case 'read': case 'search': case 'bash': if (p) this.raise(p, 'sprout'); break;
      case 'create': if (p) { this.raise(p, 'sprout'); } break;
      case 'edit':
        if (p) { if (p.stage === 'bloom') p.stage = 'bud'; else this.raise(p, 'growing'); }
        break;
      case 'file_change': if (p) { p.stage = 'bud'; p.lastDiffAt = e.at; } break;
      case 'delete': if (p) { p.stage = 'seed'; p.bugs = 0; } break;
      case 'claim': if (e.path) this.claims.set(e.path, { id: this.nextClaimId++, path: e.path, handle: who, createdAt: e.at, expiresAt: e.at + CLAIM_SPAN }); break;
      case 'release': if (e.path) this.claims.delete(e.path); break;
      case 'message_sent': {
        const m = /→\s*(\S+)\s*\((\w+)\)\s*#(\d+)/.exec(e.detail);
        if (m) this.messages.set(Number(m[3]), { id: Number(m[3]), fromHandle: who, toHandle: m[1]!, kind: m[2] as MessageView['kind'], body: '', status: 'sent', sentAt: e.at });
        break;
      }
      case 'message_delivered': case 'message_acked': {
        const id = Number(/#(\d+)/.exec(e.detail)?.[1]);
        const m = this.messages.get(id);
        if (m) { m.status = e.kind === 'message_acked' ? 'acked' : 'delivered'; if (m.status === 'acked') m.ackedAt = e.at; else m.deliveredAt = e.at; }
        break;
      }
      case 'test_fail': case 'test_pass':
        for (const q of this.plants.values()) {
          if (q.lastTouchedBy !== who || (q.stage !== 'growing' && q.stage !== 'bud')) continue;
          q.bugs = e.kind === 'test_pass' ? 0 : Math.min(5, q.bugs + 1);
        }
        break;
      case 'certify_bloom': if (p) { p.stage = 'bloom'; p.bugs = 0; p.lastBloomAt = e.at; } break;
      case 'certify_refused': if (p) p.stage = p.stage === 'bloom' ? 'bud' : p.stage; break;
      default: break;
    }
  }

  /** The garden at time `t` (ms since epoch). Moving forward is incremental; moving back replays from the start. */
  snapshotAt(t: number): GardenSnapshot {
    if (t < this.lastT) this.reset();
    this.lastT = t;
    while (this.cursor < this.events.length && this.events[this.cursor]!.at <= t) this.apply(this.events[this.cursor++]!);

    const upTo = this.cursor;
    const activity = this.events.slice(Math.max(0, upTo - WINDOW), upTo);
    const members: MemberView[] = [], agents: AgentView[] = [];
    for (const m of this.members) {
      const la = this.lastAct.get(m.handle);
      const online = !!la && t - la.at < 10 * MIN && !la.sessionEnded;
      members.push({ handle: m.handle, color: m.color, online, paused: false, lastSeen: la?.at ?? m.lastSeen });
      if (!la) continue;
      const working = t - la.at < ACTIVE_MS;
      if (online) agents.push({
        sessionId: `${m.handle}:replay`, handle: m.handle, kind: 'claude', status: working ? 'working' : 'idle',
        ...(working && la.path ? { currentPath: la.path } : {}), currentAction: working ? la.kind : 'idle', lastSeen: la.at,
      });
    }
    return {
      at: t,
      members: members.filter((m) => this.lastAct.has(m.handle)), // gardeners appear when they first show up
      agents,
      plants: [...this.plants.values()].map((p) => ({ ...p })),
      claims: [...this.claims.values()],
      messages: [...this.messages.values()],
      testRuns: [],
      certifications: this.certs.filter((c) => c.at <= t),
      activity,
    };
  }

  /** 0..1 progress of `t` through the log. */
  progress(t: number) { return Math.min(1, Math.max(0, (t - this.start) / Math.max(1, this.end - this.start))); }
}

/** Build a replay input from a snapshot that carries the whole story (the fake timeline's final frame). */
export function historyFromSnapshot(s: GardenSnapshot): HistoryInput {
  return { plants: s.plants, activity: s.activity, certifications: s.certifications, members: s.members };
}
