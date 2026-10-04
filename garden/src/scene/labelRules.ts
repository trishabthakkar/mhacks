// Pure declutter rules for floating labels, by CSS class.
export interface LabelRule { pri: number; nudge: boolean; maxDist: number }

/**
 * pri: who wins a collision (verdict 6 > speech bubble 5 > person 4 > botanist 3 > bed 2 > task/plant 1).
 * nudge: only people and bubbles move up out of the way; everything else hides instead of stacking into towers.
 * maxDist: task and plant labels only appear when the camera is close.
 */
export function labelRule(cls: string): LabelRule {
  if (cls.includes('big')) return { pri: 6, nudge: true, maxDist: Infinity };
  if (cls.includes('bubble')) return { pri: 5, nudge: true, maxDist: Infinity };
  if (cls.includes('member')) return { pri: 4, nudge: true, maxDist: Infinity };
  if (cls.includes('botanist')) return { pri: 3, nudge: false, maxDist: Infinity };
  if (cls.includes('bed')) return { pri: 2, nudge: false, maxDist: Infinity };
  return { pri: 1, nudge: false, maxDist: 32 };
}
