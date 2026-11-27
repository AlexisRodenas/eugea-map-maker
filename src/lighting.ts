import { DungeonMap, EDGE, LightAnim } from './model';
import { Geometry, Seg, wallSegments } from './geometry';
import { PROP_BY_KIND, propLight } from './props';

export interface ResolvedLight {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  intensity: number;
  anim: LightAnim;
  fromProp: boolean;
}

/** Lumières posées + lumières émises par les objets (braseros, torches...). */
export function allLights(map: DungeonMap): ResolvedLight[] {
  const out: ResolvedLight[] = map.lights.map((l) => ({ ...l, fromProp: false }));
  for (const p of map.props) {
    const pl = propLight(p);
    if (pl) out.push({ id: 'p:' + p.id, x: p.x, y: p.y, radius: pl.radius, color: pl.color, intensity: pl.intensity, anim: pl.anim, fromProp: true });
  }
  return out;
}

/** Murs générés par les objets qui bloquent la vue (colonnes, stalagmites...). */
export function propBlockers(map: DungeonMap): Seg[] {
  const out: Seg[] = [];
  for (const p of map.props) {
    const def = PROP_BY_KIND[p.kind];
    if (!def?.blocks) continue;
    const pts: number[] = [];
    if (def.blocks === 'circle') {
      const r = Math.min(p.w, p.h) * 0.38;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        pts.push(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
      }
    } else {
      const r = (p.rot * Math.PI) / 180;
      const cs = Math.cos(r),
        sn = Math.sin(r);
      for (const [lx, ly] of [
        [-0.4, -0.4],
        [0.4, -0.4],
        [0.4, 0.4],
        [-0.4, 0.4],
      ]) {
        const x = lx * p.w,
          y = ly * p.h;
        pts.push(p.x + x * cs - y * sn, p.y + x * sn + y * cs);
      }
    }
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      out.push({ x1: pts[i * 2], y1: pts[i * 2 + 1], x2: pts[j * 2], y2: pts[j * 2 + 1], type: EDGE.WALL });
    }
  }
  return out;
}

const BLOCKS_LIGHT = new Set<number>([EDGE.WALL, EDGE.DOOR, EDGE.LOCKED, EDGE.SECRET]);

/** Polygone de visibilité (lancer de rayons vers les extrémités des segments proches). */
export function visibilityPolygon(lx: number, ly: number, r: number, segs: Seg[]): number[] {
  const near: Seg[] = [];
  for (const s of segs) {
    if (Math.max(s.x1, s.x2) < lx - r || Math.min(s.x1, s.x2) > lx + r || Math.max(s.y1, s.y2) < ly - r || Math.min(s.y1, s.y2) > ly + r) continue;
    near.push(s);
  }
  const angles: number[] = [];
  const N = 72;
  for (let i = 0; i < N; i++) angles.push((i / N) * Math.PI * 2 - Math.PI);
  for (const s of near) {
    for (const [px, py] of [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ]) {
      const a = Math.atan2(py - ly, px - lx);
      angles.push(a - 1e-4, a, a + 1e-4);
    }
  }
  angles.sort((a, b) => a - b);
  const out: number[] = [];
  for (const a of angles) {
    const dx = Math.cos(a),
      dy = Math.sin(a);
    let tmin = r;
    for (const s of near) {
      const ex = s.x2 - s.x1,
        ey = s.y2 - s.y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const ax = s.x1 - lx,
        ay = s.y1 - ly;
      const t = (ax * ey - ay * ex) / den;
      if (t <= 1e-6 || t >= tmin) continue;
      const u = (ax * dy - ay * dx) / den;
      if (u < -1e-6 || u > 1 + 1e-6) continue;
      tmin = t;
    }
    out.push(lx + dx * tmin, ly + dy * tmin);
  }
  return out;
}

export class LightingCache {
  private geo: Geometry | null = null;
  private sig = '';
  private segs: Seg[] = [];
  private polys = new Map<string, number[]>();

  private refresh(map: DungeonMap, geo: Geometry): void {
    const sig = map.props
      .filter((p) => PROP_BY_KIND[p.kind]?.blocks)
      .map((p) => `${p.x},${p.y},${p.w},${p.h},${p.rot}`)
      .join(';');
    if (geo === this.geo && sig === this.sig) return;
    this.geo = geo;
    this.sig = sig;
    this.segs = wallSegments(geo, 0.03).filter((s) => BLOCKS_LIGHT.has(s.type)).concat(propBlockers(map));
    this.polys.clear();
  }

  polygon(map: DungeonMap, geo: Geometry, x: number, y: number, r: number): number[] {
    this.refresh(map, geo);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${r}`;
    let p = this.polys.get(key);
    if (!p) {
      if (this.polys.size > 2000) this.polys.clear();
      p = visibilityPolygon(x, y, r, this.segs);
      this.polys.set(key, p);
    }
    return p;
  }
}
