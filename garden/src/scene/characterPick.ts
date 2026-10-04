// Pure: which Kenney "Mini Characters" model (CC0) a person or the botanist uses.
export const BOTANIST_MODEL = 'character-male-e'; // white coat and glasses: the scientist
export const GARDENER_MODELS = ['character-female-a', 'character-male-a', 'character-male-b', 'character-female-b', 'character-male-c', 'character-female-c',
  'character-male-d', 'character-female-d', 'character-female-e', 'character-male-f', 'character-female-f'] as const;

/** A stable character per handle. */
export function characterFor(handle: string): string {
  let h = 2166136261;
  for (let i = 0; i < handle.length; i++) { h ^= handle.charCodeAt(i); h = Math.imul(h, 16777619); }
  h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13;
  return GARDENER_MODELS[(h >>> 0) % GARDENER_MODELS.length]!;
}
