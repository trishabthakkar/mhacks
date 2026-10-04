// Pure: what a file looks like in the garden (plant species) and how each bed is dressed. No three.js here.
import type { PlantView } from '../../shared/types.ts';
import { ROOT_BED } from './layout.ts';

export type Species = 'flower' | 'sunflower' | 'fern' | 'cactus' | 'shrub' | 'stone' | 'clover';

const GENERATED_RE = /(^|\/)module_bindings\//;
const TEST_RE = /(^|\/)tests\/|\.test\./;
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);
const CONFIG_EXT = new Set(['json', 'yml', 'yaml', 'toml', 'lock']);

/** Species by file type. Generated code beats tests, tests beat the extension. */
export function speciesOf(path: string): Species {
  if (GENERATED_RE.test(path)) return 'clover';
  if (TEST_RE.test(path)) return 'sunflower';
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (name.startsWith('.') || name.startsWith('tsconfig')) return 'cactus';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  if (ext === 'md') return 'fern';
  if (ext === 'sh') return 'shrub';
  if (IMAGE_EXT.has(ext)) return 'stone';
  if (CONFIG_EXT.has(ext)) return 'cactus';
  return 'flower';
}

/** Folder of a generated file, ending in "module_bindings/". */
const hedgeKey = (path: string) => { const m = GENERATED_RE.exec(path)!; return path.slice(0, m.index + m[0].length); };

/**
 * Generated code is half the repo: fold each module_bindings folder into one hedge plant (path = the folder),
 * so it reads as one low clover hedge instead of a field of identical plants. `hedgeOf` maps each folded file to its hedge.
 */
export function collapseGenerated(plants: PlantView[]): { plants: PlantView[]; hedgeOf: Map<string, string> } {
  const hedgeOf = new Map<string, string>();
  const hedges = new Map<string, PlantView>();
  const out: PlantView[] = [];
  for (const p of plants) {
    if (!GENERATED_RE.test(p.path)) { out.push(p); continue; }
    const key = hedgeKey(p.path);
    hedgeOf.set(p.path, key);
    const h = hedges.get(key);
    if (!h) { hedges.set(key, { path: key, bed: p.bed, lines: p.lines, stage: p.stage === 'dormant' ? 'dormant' : 'growing', bugs: 0, lastActivity: p.lastActivity }); continue; }
    h.lines += p.lines;
    h.lastActivity = Math.max(h.lastActivity, p.lastActivity);
    if (p.stage !== 'dormant') h.stage = 'growing';
  }
  return { plants: hedges.size ? [...out, ...[...hedges.values()].sort((a, b) => (a.path < b.path ? -1 : 1))] : out, hedgeOf };
}

/** Bed borders: a small fixed palette, picked by folder name. */
export const BED_PALETTE = [
  { name: 'stone grey', border: '#9a9a96', post: '#7c7c78' },
  { name: 'painted blue wood', border: '#5f86a8', post: '#47698a' },
  { name: 'terracotta', border: '#c46f4b', post: '#9e5537' },
  { name: 'dark walnut', border: '#5a3a22', post: '#432a17' },
  { name: 'sage', border: '#8fa882', post: '#6f8a63' },
] as const;

export interface BedStyle { kind: 'raised' | 'greenhouse' | 'stones'; border: string; post: string }

const hashName = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^ (h >>> 16)) >>> 0; };

export function bedStyleOf(name: string): BedStyle {
  const p = BED_PALETTE[hashName(name) % BED_PALETTE.length]!;
  return { kind: name === 'tests' ? 'greenhouse' : name === ROOT_BED ? 'stones' : 'raised', border: p.border, post: p.post };
}
