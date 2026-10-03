// Pure, deterministic garden layout: same plants in, same positions out (any input order).
export const SPACING = 1.7;
export const BED_PAD = 1.0;
export const BED_GAP = 2.4;
export const MAX_ROW_WIDTH = 30;
export const ROOT_BED = '(root)';

export interface LayoutInput { path: string; bed: string; lines: number }
export interface BedLayout { name: string; x: number; z: number; w: number; d: number; greenhouse: boolean }
export interface PlantLayout { path: string; bed: string; x: number; z: number; size: number }
export interface GardenLayout { beds: BedLayout[]; plants: PlantLayout[]; width: number; depth: number }

export const normalizeBed = (bed: string): string => (bed === '' || bed === '.' ? ROOT_BED : bed);

/** log-scale plant size, clamped. */
export const plantSize = (lines: number): number =>
  Math.min(1.6, Math.max(0.6, 0.45 + Math.log10(Math.max(0, lines) + 1) * 0.45));

const round = (n: number) => Math.round(n * 1000) / 1000;

export function layoutGarden(input: LayoutInput[]): GardenLayout {
  const groups = new Map<string, LayoutInput[]>();
  for (const p of input) {
    const bed = normalizeBed(p.bed);
    const g = groups.get(bed);
    if (g) g.push(p); else groups.set(bed, [p]);
  }
  const names = [...groups.keys()].sort((a, b) =>
    a === ROOT_BED ? -1 : b === ROOT_BED ? 1 : a < b ? -1 : a > b ? 1 : 0);

  type Placed = { bed: BedLayout; items: LayoutInput[]; cols: number };
  const placed: Placed[] = [];
  let cx = 0, cz = 0, rowDepth = 0, maxX = 0;
  for (const name of names) {
    const items = groups.get(name)!.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const cols = Math.max(1, Math.ceil(Math.sqrt(items.length)));
    const rows = Math.ceil(items.length / cols);
    const w = cols * SPACING + BED_PAD * 2;
    const d = rows * SPACING + BED_PAD * 2;
    if (cx > 0 && cx + w > MAX_ROW_WIDTH) { cz += rowDepth + BED_GAP; cx = 0; rowDepth = 0; }
    placed.push({ bed: { name, x: cx + w / 2, z: cz + d / 2, w, d, greenhouse: name === 'tests' }, items, cols });
    cx += w + BED_GAP;
    maxX = Math.max(maxX, cx - BED_GAP);
    rowDepth = Math.max(rowDepth, d);
  }
  const width = maxX, depth = cz + rowDepth;
  const ox = width / 2, oz = depth / 2;

  const beds: BedLayout[] = [];
  const plants: PlantLayout[] = [];
  for (const { bed, items, cols } of placed) {
    const b = { ...bed, x: round(bed.x - ox), z: round(bed.z - oz), w: round(bed.w), d: round(bed.d) };
    beds.push(b);
    items.forEach((it, k) => {
      plants.push({
        path: it.path, bed: bed.name, size: round(plantSize(it.lines)),
        x: round(b.x - b.w / 2 + BED_PAD + SPACING * ((k % cols) + 0.5)),
        z: round(b.z - b.d / 2 + BED_PAD + SPACING * (Math.floor(k / cols) + 0.5)),
      });
    });
  }
  return { beds, plants, width, depth };
}
