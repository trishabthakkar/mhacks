// Pure evidence gate. The SpacetimeDB module calls this; nothing else re-implements it.
export interface TestRunEvidence { repo: string; exitCode: number; at: number }
export interface ReviewEvidence { handle: string; ok: boolean; at: number }

export interface EvidenceInput {
  repo: string;
  /** Latest diff time touching the plant's file (ms), if any. */
  lastDiffAt?: number;
  /** Time of the plant's last bloom (ms), if any. */
  lastBloomAt?: number;
  testRuns: TestRunEvidence[];
  reviews: ReviewEvidence[];
  requireReview: boolean;
  /** Handle of the agent asking; their own review doesn't count. */
  requester: string;
}

export function checkEvidence(i: EvidenceInput): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const diffAt = i.lastDiffAt;
  if (diffAt === undefined || (i.lastBloomAt !== undefined && diffAt <= i.lastBloomAt)) {
    missing.push('no real diff seen for this file since its last bloom');
  } else if (!i.testRuns.some((t) => t.repo === i.repo && t.exitCode === 0 && t.at >= diffAt)) {
    missing.push('no passing test run seen after your last edit');
  }
  if (i.requireReview && !i.reviews.some((r) => r.ok && r.handle !== i.requester && (diffAt === undefined || r.at >= diffAt))) {
    missing.push('no passing teammate review after your last edit');
  }
  return { ok: missing.length === 0, missing };
}
