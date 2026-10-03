// Pure path planning on the garden floor: walkers go around beds, not through them.
// Visibility graph over the expanded corners of every bed + Dijkstra. No THREE dependency, so it is unit-tested.

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Pt { x: number; z: number }
export interface BedBox { x: number; z: number; w: number; d: number }

const SHRINK = 0.05; // grazing a bed's edge is fine

/** Does the segment a->b pass through the interior of r? (slab test) */
export function segmentHitsRect(ax: number, az: number, bx: number, bz: number, r: Rect): boolean {
  const minX = r.minX + SHRINK, maxX = r.maxX - SHRINK, minZ = r.minZ + SHRINK, maxZ = r.maxZ - SHRINK;
  if (minX >= maxX || minZ >= maxZ) return false;
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q, lo, hi] of [[ax, dx, minX, maxX], [az, dz, minZ, maxZ]] as const) {
    if (Math.abs(q) < 1e-9) { if (p <= lo || p >= hi) return false; continue; }
    let ta = (lo - p) / q, tb = (hi - p) / q;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 >= t1) return false;
  }
  return true;
}

export class Nav {
  private rects: Rect[];
  private nodes: Pt[] = [];
  private adj: Array<Array<{ to: number; w: number }>> = [];

  constructor(beds: BedBox[], private margin = 0.9) {
    this.rects = beds.map((b) => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 }));
    for (const r of this.rects) {
      for (const [x, z] of [[r.minX - margin, r.minZ - margin], [r.maxX + margin, r.minZ - margin], [r.maxX + margin, r.maxZ + margin], [r.minX - margin, r.maxZ + margin]] as const) {
        this.nodes.push({ x, z });
      }
    }
    this.adj = this.nodes.map(() => []);
    for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
      const a = this.nodes[i]!, b = this.nodes[j]!;
      if (!this.blocked(a.x, a.z, b.x, b.z, -1, -1)) {
        const w = Math.hypot(a.x - b.x, a.z - b.z);
        this.adj[i]!.push({ to: j, w }); this.adj[j]!.push({ to: i, w });
      }
    }
  }

  /** Index of the bed containing the point (or -1). */
  bedAt(x: number, z: number): number {
    return this.rects.findIndex((r) => x >= r.minX - 0.01 && x <= r.maxX + 0.01 && z >= r.minZ - 0.01 && z <= r.maxZ + 0.01);
  }

  private blocked(ax: number, az: number, bx: number, bz: number, ignoreA: number, ignoreB: number): boolean {
    for (let i = 0; i < this.rects.length; i++) {
      if (i === ignoreA || i === ignoreB) continue;
      if (segmentHitsRect(ax, az, bx, bz, this.rects[i]!)) return true;
    }
    return false;
  }

  /** Waypoints from (ax,az) to (bx,bz), excluding the start and ending at the goal. Straight line when nothing is in the way. */
  path(ax: number, az: number, bx: number, bz: number): Pt[] {
    const ia = this.bedAt(ax, az), ib = this.bedAt(bx, bz);
    if (!this.blocked(ax, az, bx, bz, ia, ib)) return [{ x: bx, z: bz }];
    const n = this.nodes.length, S = n, G = n + 1;
    const dist = new Array<number>(n + 2).fill(Infinity), prev = new Array<number>(n + 2).fill(-1), done = new Array<boolean>(n + 2).fill(false);
    const pt = (i: number): Pt => (i === S ? { x: ax, z: az } : i === G ? { x: bx, z: bz } : this.nodes[i]!);
    const visible = (i: number, fromStart: boolean) => {
      const p = this.nodes[i]!;
      return fromStart ? !this.blocked(ax, az, p.x, p.z, ia, -1) : !this.blocked(p.x, p.z, bx, bz, -1, ib);
    };
    dist[S] = 0;
    for (let step = 0; step < n + 2; step++) {
      let u = -1;
      for (let i = 0; i < n + 2; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
      if (u < 0) break;
      done[u] = true;
      if (u === G) break;
      const relax = (v: number, w: number) => { if (dist[u]! + w < dist[v]!) { dist[v] = dist[u]! + w; prev[v] = u; } };
      if (u === S) { for (let i = 0; i < n; i++) if (visible(i, true)) relax(i, Math.hypot(this.nodes[i]!.x - ax, this.nodes[i]!.z - az)); }
      else {
        for (const e of this.adj[u]!) relax(e.to, e.w);
        if (visible(u, false)) relax(G, Math.hypot(this.nodes[u]!.x - bx, this.nodes[u]!.z - bz));
      }
    }
    if (!isFinite(dist[G]!)) return [{ x: bx, z: bz }]; // boxed in (should not happen): go straight
    const out: Pt[] = [];
    for (let v = G; v !== S && v >= 0; v = prev[v]!) out.push(pt(v));
    return out.reverse();
  }
}
