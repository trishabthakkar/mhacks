// All database access for the MCP server goes through this interface.
// Implementations: FakeDb (fakeDb.ts, in memory, follows CONTRACT.md) and the real
// SpacetimeDB client (stdbDb.ts, once P1's bindings land in src/module_bindings).
//
// Reads answer from a local cache (the SpacetimeDB client cache in the real one).
// Writes call reducers; a reducer error rejects with an Error whose message is shown
// to the agent. The module owns every rule — the MCP server only pre-checks to write
// friendlier messages.
import type { AgentStatus, HandoffStatus } from '../../shared/types.ts';
import type {
  AgentView, CertificationView, ClaimView, MemberView, MessageView,
} from '../../shared/types.ts';

export type { AgentView, CertificationView, ClaimView, MemberView, MessageView };

// TODO(contract): shared/types.ts has no HandoffView; fields mirror CONTRACT.md `handoff`.
export interface HandoffView {
  id: number; fromHandle: string; toHandle: string; task: string; notes: string;
  status: HandoffStatus; createdAt: number;
}

export type ReportableStatus = Extract<AgentStatus, 'working' | 'blocked' | 'needs_review'>;

export interface SproutDb {
  /** 'connected' once the cache is live. */
  connection(): 'connected' | 'disconnected';

  // ---- reads (cache) ----
  member(handle: string): MemberView | undefined;
  members(): MemberView[];
  agents(): AgentView[];
  /** Active (unexpired) claims. */
  claims(): ClaimView[];
  handoffs(): HandoffView[];
  messagesTo(handle: string): MessageView[];
  message(id: number): MessageView | undefined;
  certifications(): CertificationView[];
  config(key: 'claimMode' | 'claimTtlMinutes' | 'requireReview'): string | undefined;

  // ---- writes (reducers) ---- TODO(contract): argument lists are P1's; CONTRACT.md only names them.
  claimFiles(handle: string, paths: string[], ttlMinutes: number): Promise<void>;
  releaseFiles(handle: string, paths: string[]): Promise<void>;
  postMessage(fromHandle: string, toHandle: string, kind: MessageView['kind'], body: string): Promise<void>;
  markDelivered(handle: string, ids: number[]): Promise<void>;
  ackMessage(handle: string, id: number): Promise<void>;
  offerHandoff(fromHandle: string, toHandle: string, task: string, notes: string): Promise<void>;
  respondHandoff(handle: string, id: number, accept: boolean): Promise<void>;
  reportStatus(handle: string, sessionId: string, status: ReportableStatus): Promise<void>;
  submitEvidence(handle: string, path: string, task: string): Promise<void>;
  review(handle: string, path: string, ok: boolean): Promise<void>;

  /**
   * Resolve with the first certification row matching `pred` (already present or arriving
   * later), or undefined after `timeoutMs`.
   */
  waitForCertification(pred: (c: CertificationView) => boolean, timeoutMs: number): Promise<CertificationView | undefined>;
}
