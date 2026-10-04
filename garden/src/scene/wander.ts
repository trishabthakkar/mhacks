// Pure: where a gardener stands over time, so people move around instead of standing still. Offsets, not world positions.
import { hash2 } from './palette.ts';

/** Sides of a plant a gardener tends from (radius ~0.85), all clear of the bot, which works at +x,+z. */
const TEND_ANGLES = [2.5, 3.4, 4.2, 5.0, 1.9];
const TEND_R = 0.85, TEND_HOLD = 4, IDLE_HOLD = 6;

/** Offset from the plant a working gardener stands at, at time t (seconds). Moves to another side every few seconds. */
export function tendSpot(t: number, seed: number): { x: number; z: number } {
  const k = Math.floor((t + seed * 1.37) / TEND_HOLD);
  // consecutive spots step 2 or 3 around the 5 sides, so a gardener never "moves" to where they already are
  const i = (((seed + k * 2 + Math.floor(hash2(k, seed) * 2)) % TEND_ANGLES.length) + TEND_ANGLES.length) % TEND_ANGLES.length;
  const a = TEND_ANGLES[i]!;
  return { x: Math.cos(a) * TEND_R, z: Math.sin(a) * TEND_R };
}

/** Offset from home an idle gardener strolls to: mostly sideways along the lane, a new spot every few seconds. */
export function idleSpot(t: number, seed: number): { x: number; z: number } {
  const k = Math.floor((t + seed * 2.11) / IDLE_HOLD);
  return { x: (hash2(k, seed) * 2 - 1) * 1.5, z: (hash2(k, seed + 9) * 2 - 1) * 0.5 };
}
