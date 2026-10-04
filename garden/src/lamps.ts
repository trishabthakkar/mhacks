// Pure: where the garden's night lights stand, and how bright they are at a given hour.
import type { GardenFence } from './boundary.ts';

export interface Lamp { x: number; z: number; kind: 'post' | 'arch' | 'path' | 'shed'; real: boolean }
type Box = { x: number; z: number; w: number; d: number };

const smooth = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
/** 0 by day, fading on 18:30→20:00, full through the night, fading off 5:30→6:30. */
export function lampLevel(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return h >= 12 ? smooth(18.5, 20, h) : 1 - smooth(5.5, 6.5, h);
}

const POST_STEP = 6, PATH_STEP = 4, MAX_PATH = 60;

/**
 * Lanterns on the fence every ~6 m (none in the gate gap), a pair on the arch, low path lights alongside the gravel
 * strips (never in a bed or the pond), and one by the shed door. `real` marks the few that get an actual light
 * (arch, shed, the back-left corner post): the rest only glow.
 */
export function lampSpots(f: GardenFence, paths: Box[], shed: { x: number; z: number }, avoid: { beds?: Box[]; pond?: { x: number; z: number; r: number } } = {}): Lamp[] {
  const { minX, maxX, minZ, maxZ } = f.rect, out: Lamp[] = [];
  const side = (x0: number, z0: number, x1: number, z1: number, front: boolean) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / POST_STEP));
    for (let i = 0; i < n; i++) { // the far corner is the next side's first point
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      if (front && Math.abs(x - f.gate.x) < f.gate.w / 2 + 0.6) continue;
      out.push({ x, z, kind: 'post', real: false });
    }
  };
  side(minX, minZ, maxX, minZ, false); side(maxX, minZ, maxX, maxZ, false);
  side(maxX, maxZ, minX, maxZ, true); side(minX, maxZ, minX, minZ, false);
  const corner = out.reduce((b, l) => (Math.hypot(l.x - minX, l.z - minZ) < Math.hypot(b.x - minX, b.z - minZ) ? l : b), out[0]!);
  if (corner) corner.real = true;
  for (const s of [-1, 1]) out.push({ x: f.gate.x + s * (f.gate.w / 2 + 0.2), z: maxZ, kind: 'arch', real: true });
  out.push({ x: shed.x + 0.9, z: shed.z + 1.3, kind: 'shed', real: true });

  const blocked = (x: number, z: number) =>
    x < minX + 0.3 || x > maxX - 0.3 || z < minZ + 0.3 || z > maxZ - 0.3 ||
    (avoid.beds ?? []).some((b) => Math.abs(x - b.x) < b.w / 2 + 0.3 && Math.abs(z - b.z) < b.d / 2 + 0.3) ||
    (!!avoid.pond && Math.hypot(x - avoid.pond.x, z - avoid.pond.z) < avoid.pond.r * 1.4) ||
    out.some((l) => Math.hypot(l.x - x, l.z - z) < 1.5);
  const total = paths.reduce((a, p) => a + Math.max(p.w, p.d), 0);
  const step = Math.max(PATH_STEP, total / MAX_PATH);
  let k = 0;
  for (const p of paths) {
    const along = p.w >= p.d, len = along ? p.w : p.d, half = (along ? p.d : p.w) / 2 + 0.25;
    for (let a = -len / 2 + step / 2; a <= len / 2; a += step, k++) {
      const off = k % 2 ? half : -half;
      const x = along ? p.x + a : p.x + off, z = along ? p.z + off : p.z + a;
      if (!blocked(x, z)) out.push({ x, z, kind: 'path', real: false });
    }
  }
  return out;
}
