// In-memory SproutDb following CONTRACT.md. Used by tests and by `SPROUT_FAKE_DB=1`
// until the real SpacetimeDB bindings land. Rules here are a stand-in for the module's.
import { checkEvidence } from '../../shared/botanist.ts';
import { DEFAULT_CLAIM_TTL_MIN, MAX_MESSAGE_BODY, MEMBER_COLORS } from '../../shared/constants.ts';
import { clock } from './time.ts';
import type {
  AgentView, CertificationView, ClaimView, HandoffView, MemberView, MessageView, ReportableStatus, SproutDb,
} from './db.ts';

const overlaps = (a: string, b: string) =>
  a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));


export class FakeDb implements SproutDb {
  private _members = new Map<string, MemberView>();
  private _agents = new Map<string, AgentView>();
  private _claims: ClaimView[] = [];
  private _messages: MessageView[] = [];
  private _handoffs: HandoffView[] = [];
  private _certs: CertificationView[] = [];
  private _diffs: Array<{ handle: string; path: string; at: number }> = [];
  private _tests: Array<{ handle: string; repo: string; exitCode: number; at: number }> = [];
  private _reviews: Array<{ handle: string; path: string; ok: boolean; at: number }> = [];
  private _blooms = new Map<string, number>();
  private _config = new Map<string, string>();
  private _waiters = new Set<(c: CertificationView) => void>();
  private nextId = 1;

  constructor(private now: () => number = Date.now) {}

  // ---- seeding (tests / demo) ----
  seedMember(handle: string, online = true): void {
    const color = MEMBER_COLORS[this._members.size % MEMBER_COLORS.length]!;
    this._members.set(handle, { handle, color, online, paused: false, lastSeen: this.now() });
  }
  seedAgent(a: Partial<AgentView> & { sessionId: string; handle: string }): void {
    this._agents.set(a.sessionId, {
      kind: 'claude', status: 'working', currentAction: 'idle', lastSeen: this.now(), ...a,
    });
  }
  seedDiff(handle: string, path: string): void { this._diffs.push({ handle, path, at: this.now() }); }
  seedTestRun(handle: string, exitCode: number, repo = 'repo'): void {
    this._tests.push({ handle, repo, exitCode, at: this.now() });
  }
  setConfig(key: string, value: string): void { this._config.set(key, value); }

  // ---- reads ----
  connection() { return 'connected' as const; }
  member(handle: string) { return this._members.get(handle); }
  members() { return [...this._members.values()]; }
  agents() { return [...this._agents.values()]; }
  claims() { return this._claims.filter((c) => c.expiresAt > this.now()); }
  handoffs() { return [...this._handoffs]; }
  messagesTo(handle: string) { return this._messages.filter((m) => m.toHandle === handle); }
  message(id: number) { return this._messages.find((m) => m.id === id); }
  certifications() { return [...this._certs]; }
  config(key: string) { return this._config.get(key); }

  // ---- writes ----
  async claimFiles(handle: string, paths: string[], ttlMinutes = DEFAULT_CLAIM_TTL_MIN) {
    const active = this.claims();
    for (const p of paths) {
      const other = active.find((c) => c.handle !== handle && overlaps(c.path, p));
      if (other) throw new Error(`${other.path} is fenced by ${other.handle} until ${clock(other.expiresAt)}`);
    }
    const t = this.now();
    for (const p of paths) {
      const mine = active.find((c) => c.handle === handle && c.path === p);
      if (mine) mine.expiresAt = t + ttlMinutes * 60_000;
      else this._claims.push({ id: this.nextId++, path: p, handle, createdAt: t, expiresAt: t + ttlMinutes * 60_000 });
    }
  }

  async releaseFiles(handle: string, paths: string[]) {
    this._claims = this._claims.filter((c) => !(c.handle === handle && paths.includes(c.path)));
  }

  async postMessage(fromHandle: string, toHandle: string, kind: MessageView['kind'], body: string) {
    if (!this._members.has(toHandle)) throw new Error(`no member named ${toHandle}`);
    if (body.length > MAX_MESSAGE_BODY) throw new Error(`message body is over ${MAX_MESSAGE_BODY} chars`);
    this._messages.push({ id: this.nextId++, fromHandle, toHandle, kind, body, status: 'sent', sentAt: this.now() });
  }

  async markDelivered(handle: string, ids: number[]) {
    for (const m of this._messages) {
      if (ids.includes(m.id) && m.toHandle === handle && m.status === 'sent') {
        m.status = 'delivered';
        m.deliveredAt = this.now();
      }
    }
  }

  async ackMessage(handle: string, id: number) {
    const m = this.message(id);
    if (!m) throw new Error(`no message ${id}`);
    if (m.toHandle !== handle) throw new Error(`message ${id} is not addressed to you`);
    m.status = 'acked';
    m.deliveredAt ??= this.now();
    m.ackedAt = this.now();
  }

  async offerHandoff(fromHandle: string, toHandle: string, task: string, notes: string) {
    if (!this._members.has(toHandle)) throw new Error(`no member named ${toHandle}`);
    this._handoffs.push({ id: this.nextId++, fromHandle, toHandle, task, notes, status: 'offered', createdAt: this.now() });
  }

  async respondHandoff(handle: string, id: number, accept: boolean) {
    const h = this._handoffs.find((x) => x.id === id);
    if (!h) throw new Error(`no handoff ${id}`);
    if (h.toHandle !== handle) throw new Error(`handoff ${id} was not offered to you`);
    if (h.status !== 'offered') throw new Error(`handoff ${id} is already ${h.status}`);
    h.status = accept ? 'accepted' : 'declined';
  }

  async reportStatus(handle: string, sessionId: string, status: ReportableStatus) {
    const a = this._agents.get(sessionId);
    if (!a || a.handle !== handle) throw new Error(`no session ${sessionId} for ${handle}`);
    a.status = status;
    a.lastSeen = this.now();
  }

  async submitEvidence(handle: string, path: string, task: string) {
    const diffs = this._diffs.filter((d) => d.path === path).map((d) => d.at);
    const verdict = checkEvidence({
      repo: 'repo',
      lastDiffAt: diffs.length ? Math.max(...diffs) : undefined,
      lastBloomAt: this._blooms.get(path),
      testRuns: this._tests.filter((t) => t.handle === handle),
      reviews: this._reviews.filter((r) => r.path === path),
      requireReview: this._config.get('requireReview') === 'true',
      requester: handle,
    });
    const at = this.now();
    if (verdict.ok) this._blooms.set(path, at);
    const cert: CertificationView = {
      id: this.nextId++, path, handle, task, at,
      result: verdict.ok ? 'bloom' : 'refused', reason: verdict.missing.join('; '),
    };
    this._certs.push(cert);
    // Deliver asynchronously, like a subscription update arriving after the reducer.
    setTimeout(() => { for (const w of [...this._waiters]) w(cert); }, 5);
  }

  async review(handle: string, path: string, ok: boolean) {
    this._reviews.push({ handle, path, ok, at: this.now() });
  }

  waitForCertification(pred: (c: CertificationView) => boolean, timeoutMs: number) {
    const existing = this._certs.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise<CertificationView | undefined>((resolve) => {
      const done = (c: CertificationView | undefined) => {
        clearTimeout(timer);
        this._waiters.delete(onCert);
        resolve(c);
      };
      const onCert = (c: CertificationView) => { if (pred(c)) done(c); };
      const timer = setTimeout(() => done(undefined), timeoutMs);
      this._waiters.add(onCert);
    });
  }
}
