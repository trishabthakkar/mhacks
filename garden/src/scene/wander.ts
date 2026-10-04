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

/** A place an idle gardener visits: stand at (x, z), face (fx, fz). */
export interface Spot { x: number; z: number; fx: number; fz: number }
const ROAM_PAIR = 18; // two stops per 18 s: the first lasts 6–12 s, the second the rest (also 6–12 s)

/**
 * Where an idle gardener is visiting at time t: a walk between places around the garden. O(1): stops come in pairs,
 * even stops pick from even-numbered spots and odd stops from odd ones, so the next stop is never the current spot.
 */
export function roamSpot(t: number, seed: number, spots: Spot[]): Spot | undefined {
  const n = spots.length;
  if (n < 2) return spots[0];
  const tt = Math.max(0, t + seed * 3.1), k = Math.floor(tt / ROAM_PAIR);
  const j = 2 * k + (tt - k * ROAM_PAIR >= 6 + 6 * hash2(k, seed) ? 1 : 0), odd = j % 2;
  const count = odd ? Math.floor(n / 2) : Math.ceil(n / 2);
  return spots[odd + 2 * Math.min(count - 1, Math.floor(hash2(j, seed + 17) * count))];
}
