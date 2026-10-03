import type { GardenWorld } from '../scene/world.ts';

export const SHOT_NAMES = ['full', 'bed-src', 'botanist', 'plan'] as const;
export type ShotName = (typeof SHOT_NAMES)[number];

/**
 * Repeatable camera for screenshots: ?shot=full|bed-src|botanist|plan. UI is hidden except for the plan shot,
 * so Devpost images look the same every time.
 */
export function applyShot(name: string, world: GardenWorld, openPlan: () => void) {
  if (!SHOT_NAMES.includes(name as ShotName)) return;
  if (name === 'plan') { openPlan(); return; }
  document.body.classList.add('hide-ui');
  world.director = false; world.follow = null;
  if (name === 'full') { world.frameGarden(true); return; }
  if (name === 'bed-src') { world.focusBed('src', 11); return; }
  if (name === 'botanist') world.focusBotanist(8);
}
