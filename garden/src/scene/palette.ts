import * as THREE from 'three';

/** One cohesive palette for the whole garden: warm, soft, low-poly. */
export const PALETTE = {
  meadowInner: '#86bd5c', meadowOuter: '#6da24a', plaza: '#d8c79b', path: '#c9b787',
  soil: '#5b4129', mulch: '#5a4632', soilDark: '#47321f', furrow: '#3f2c1b',
  wood: '#8c5b34', woodDark: '#6e4526', woodLight: '#a8754a',
  stone: '#9a9a96', stoneDark: '#7c7c78',
  leaf: '#4f9a4a', leafDark: '#3f823f', trunk: '#76512f',
  shedWall: '#c98f5a', shedRoof: '#a5483d', shedTrim: '#efe3c8', paper: '#fff8e1',
  glass: '#bfe8f5', frame: '#e9efe6', cloud: '#ffffff',
} as const;

/** Sky by hour of day: [hour, horizon, top]. Night stays readable (never pure black) for projectors. */
export const SKY_STOPS: ReadonlyArray<readonly [number, string, string]> = [
  [0, '#26335c', '#0f1738'], [5, '#e8a07e', '#4a5f9c'], [8, '#bfe3f5', '#6aa6df'], [16, '#cfe6ee', '#78aee3'],
  [18.5, '#f6b073', '#6b79b8'], [20.5, '#3a3f74', '#161d4a'], [24, '#26335c', '#0f1738'],
];

const ca = new THREE.Color(), cb = new THREE.Color();
/** Horizon and zenith colours for an hour (0..24), written into the given colours. */
export function skyColors(hour: number, horizon: THREE.Color, top: THREE.Color) {
  for (let i = 1; i < SKY_STOPS.length; i++) {
    const [h1, hz1, tp1] = SKY_STOPS[i]!, [h0, hz0, tp0] = SKY_STOPS[i - 1]!;
    if (hour <= h1) {
      const k = (hour - h0) / (h1 - h0);
      horizon.copy(ca.set(hz0)).lerp(cb.set(hz1), k);
      top.copy(ca.set(tp0)).lerp(cb.set(tp1), k);
      return;
    }
  }
  horizon.set(SKY_STOPS[0]![1]); top.set(SKY_STOPS[0]![2]);
}

/** Deterministic 0..1 noise from integers, for scatter and vertex colour variation. */
export function hash2(a: number, b = 0): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
