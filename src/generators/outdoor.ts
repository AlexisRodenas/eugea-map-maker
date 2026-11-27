import { DungeonMap, Prop } from '../model';
import { PROP_BY_KIND, propBounds } from '../props';
import { Rng, fbm, uid } from '../util';

/** Lissage de Chaikin d'une polyligne ouverte (extrémités conservées). */
export function smoothOpen(p: number[], iters = 2): number[] {
  for (let it = 0; it < iters; it++) {
    const n = p.length / 2;
    if (n < 3) return p;
    const q: number[] = [p[0], p[1]];
    for (let i = 0; i < n - 1; i++) {
      const x0 = p[i * 2],
        y0 = p[i * 2 + 1],
        x1 = p[i * 2 + 2],
        y1 = p[i * 2 + 3];
      if (i > 0) q.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1);
      if (i < n - 2) q.push(0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
    }
    q.push(p[n * 2 - 2], p[n * 2 - 1]);
    p = q;
  }
  return p;
}

/** Ligne sinueuse de A à B (ondulation par bruit, nulle aux extrémités). */
export function wobblyLine(rng: Rng, ax: number, ay: number, bx: number, by: number, amp: number, step = 2.5): number[] {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const n = Math.max(2, Math.round(len / step));
  const nx = -(by - ay) / len,
    ny = (bx - ax) / len;
  const seed = rng.int(0, 9999);
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const w = Math.sin(t * Math.PI);
    const off = (fbm(t * len * 0.06, seed * 0.13, 3, seed) - 0.5) * 2 * amp * (0.35 + 0.65 * w);
    pts.push(ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off);
  }
  return smoothOpen(pts, 2);
}

/** Distance (centre de case → polyligne) ; garde le minimum dans `out`. */
export function distField(cols: number, rows: number, pts: number[], maxR: number, out?: Float32Array): Float32Array {
  const d = out ?? new Float32Array(cols * rows).fill(1e9);
  for (let s = 0; s + 3 < pts.length; s += 2) {
    const ax = pts[s],
      ay = pts[s + 1],
      bx = pts[s + 2],
      by = pts[s + 3];
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - maxR)),
      x1 = Math.min(cols - 1, Math.ceil(Math.max(ax, bx) + maxR));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - maxR)),
      y1 = Math.min(rows - 1, Math.ceil(Math.max(ay, by) + maxR));
    const ex = bx - ax,
      ey = by - ay;
    const l2 = ex * ex + ey * ey || 1e-9;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax,
          py = y + 0.5 - ay;
        const t = Math.max(0, Math.min(1, (px * ex + py * ey) / l2));
        const dx = px - t * ex,
          dy = py - t * ey;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = y * cols + x;
        if (dist < d[i]) d[i] = dist;
      }
  }
  return d;
}

/** Point et tangente à la fraction t (0..1, en nombre de points) d'une polyligne. */
export function pointAt(pts: number[], t: number): { x: number; y: number; dx: number; dy: number } {
  const n = pts.length / 2;
  const i = Math.max(0, Math.min(n - 2, Math.floor(t * (n - 1))));
  const x = pts[i * 2],
    y = pts[i * 2 + 1];
  const dx = pts[i * 2 + 2] - x,
    dy = pts[i * 2 + 3] - y;
  const l = Math.hypot(dx, dy) || 1;
  return { x, y, dx: dx / l, dy: dy / l };
}

/** Placement d'objets avec grille d'occupation. */
export class Placer {
  occ: Uint8Array;
  constructor(
    public map: DungeonMap,
    public rng: Rng,
  ) {
    this.occ = new Uint8Array(map.cols * map.rows);
  }

  block(x: number, y: number): void {
    if (this.map.inBounds(x, y)) this.occ[y * this.map.cols + x] = 1;
  }

  isFree(x: number, y: number): boolean {
    return this.map.inBounds(x, y) && !this.occ[y * this.map.cols + x];
  }

  /** Pose un objet si son empreinte est libre (ou `force`) ; marque l'occupation. */
  put(kind: string, x: number, y: number, rot = 0, opt: { w?: number; h?: number; force?: boolean; gmOnly?: boolean; mark?: boolean } = {}): Prop | null {
    const def = PROP_BY_KIND[kind];
    if (!def) return null;
    const p: Prop = { id: uid(), kind, x, y, w: opt.w ?? def.w, h: opt.h ?? def.h, rot, gmOnly: opt.gmOnly ?? !!def.gmOnly };
    const b = propBounds(p);
    const x0 = Math.floor(b.x0 + 0.05),
      y0 = Math.floor(b.y0 + 0.05),
      x1 = Math.ceil(b.x1 - 0.05),
      y1 = Math.ceil(b.y1 - 0.05);
    if (!opt.force) {
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) if (!this.isFree(xx, yy)) return null;
    }
    if (opt.mark !== false) for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.block(xx, yy);
    this.map.props.push(p);
    return p;
  }
}
