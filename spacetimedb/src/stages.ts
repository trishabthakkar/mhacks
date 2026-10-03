// Plant dormancy rules. Pure (no spacetimedb imports) so scripts/stages.test.ts can run them in plain Node.

/** A plant with no activity for this long goes dormant (sweep, every 60s). Blooms never go dormant. */
export const PLANT_DORMANT_AFTER_US = 3n * 60n * 60_000_000n; // 3 hours

interface PlantTimes {
  stage: string;
  lines: number;
  lastActivity: { microsSinceUnixEpoch: bigint };
  lastDiffAt?: { microsSinceUnixEpoch: bigint };
  lastBloomAt?: { microsSinceUnixEpoch: bigint };
}

export function shouldGoDormant(p: PlantTimes, nowUs: bigint): boolean {
  return p.stage !== 'dormant' && p.stage !== 'bloom' && nowUs - p.lastActivity.microsSinceUnixEpoch > PLANT_DORMANT_AFTER_US;
}

/** Stage a plant returns to when it wakes: what its evidence says it is (bloom, bud), else growing or seed. */
export function wakeStage(p: PlantTimes): string {
  if (p.stage !== 'dormant') return p.stage;
  const diff = p.lastDiffAt?.microsSinceUnixEpoch;
  const bloom = p.lastBloomAt?.microsSinceUnixEpoch;
  if (diff !== undefined && (bloom === undefined || diff > bloom)) return 'bud';
  if (bloom !== undefined) return 'bloom';
  return p.lines > 0 ? 'growing' : 'seed';
}
