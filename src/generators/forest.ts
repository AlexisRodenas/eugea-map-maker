import { DungeonMap, T } from '../model';
import { Rng, fbm, hashString } from '../util';
import { Placer, distField, pointAt, smoothOpen, wobblyLine } from './outdoor';

export interface ForestParams {
  cols: number;
  rows: number;
  seed: string;
  trees: number; // densité des arbres
  pathWidth: number;
  branches: number;
  stream: boolean;
  clearing: boolean; // clairière avec campement
  ruins: boolean; // ruines anciennes
  winter: boolean;
  props: number;
  lights: number;
}

export const DEFAULT_FOREST: ForestParams = {
  cols: 50,
  rows: 38,
  seed: 'sylve-1234',
  trees: 0.65,
  pathWidth: 2,
  branches: 1,
  stream: true,
  clearing: true,
  ruins: false,
  winter: false,
  props: 0.6,
  lights: 0.5,
};

interface Spot {
  x: number;
  y: number;
  r: number;
}

export function generateForest(p: ForestParams): DungeonMap {
  const rng = new Rng(hashString(p.seed || 'foret'));
  const seedN = hashString(p.seed) % 1000;
  const { cols, rows } = p;
  const N = cols * rows;
  const map = new DungeonMap(cols, rows);
  map.name = (p.winter ? 'Forêt enneigée ' : 'Sentier forestier ') + p.seed;
  const G = map.ground;
  const base = p.winter ? T.SNOW : T.FOREST;

  // --- Terrain de base avec taches d'herbe / de rocaille
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const n = fbm(x * 0.07, y * 0.07, 3, seedN);
      G[y * cols + x] = n > 0.6 ? (p.winter ? T.ROCKY : T.GRASS) : base;
    }

  // --- Tracés : sentier principal, embranchements
  const horiz = cols >= rows;
  const W = Math.max(1, Math.min(4, p.pathWidth));
  const span = horiz ? rows : cols;
  const a = rng.float(0.3, 0.7) * span,
    b = rng.float(0.3, 0.7) * span;
  const main = horiz ? wobblyLine(rng, -1, a, cols + 1, b, rows * 0.22) : wobblyLine(rng, a, -1, b, rows + 1, cols * 0.22);
  const paths: { pts: number[]; w: number }[] = [{ pts: main, w: W }];
  const junctions: { x: number; y: number }[] = [];
  for (let k = 0; k < p.branches; k++) {
    const at = pointAt(main, rng.float(0.25, 0.75));
    const side = k % 2 === 0 ? -1 : 1;
    const tx = horiz ? at.x + rng.float(-0.25, 0.25) * cols : side < 0 ? -1 : cols + 1;
    const ty = horiz ? (side < 0 ? -1 : rows + 1) : at.y + rng.float(-0.25, 0.25) * rows;
    paths.push({ pts: wobblyLine(rng, at.x, at.y, tx, ty, span * 0.15), w: Math.max(1, W - 1) });
    junctions.push({ x: at.x, y: at.y });
  }

  // --- Clairière et ruines, à côté du sentier
  const besidePath = (t: number, side: number, r: number): Spot => {
    const at = pointAt(main, t);
    const off = r + W / 2 + 1.5;
    const x = Math.max(r + 1, Math.min(cols - r - 1, at.x - at.dy * off * side));
    const y = Math.max(r + 1, Math.min(rows - r - 1, at.y + at.dx * off * side));
    paths.push({ pts: smoothOpen([x, y, (x + at.x) / 2 + rng.float(-1, 1), (y + at.y) / 2 + rng.float(-1, 1), at.x, at.y], 2), w: 1 });
    return { x, y, r };
  };
  const clearing = p.clearing ? besidePath(rng.float(0.3, 0.45), rng.chance(0.5) ? 1 : -1, rng.float(3, 4.5)) : null;
  const ruins = p.ruins ? besidePath(rng.float(0.6, 0.75), clearing ? -1 : 1, rng.float(3, 4)) : null;
  for (const [spot, terrain] of [
    [clearing, p.winter ? T.SNOW : T.GRASS],
    [ruins, T.ROCKY],
  ] as [Spot | null, number][]) {
    if (!spot) continue;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const d = Math.hypot(x + 0.5 - spot.x, y + 0.5 - spot.y);
        if (d <= spot.r * (0.85 + 0.3 * fbm(x * 0.3, y * 0.3, 2, seedN + 3))) G[y * cols + x] = terrain;
      }
  }

  // --- Rasterisation des sentiers
  const pathDist = new Float32Array(N).fill(1e9);
  for (const pa of paths) {
    const d = distField(cols, rows, pa.pts, pa.w / 2 + 4);
    for (let i = 0; i < N; i++) {
      const e = d[i] - pa.w / 2;
      if (e < pathDist[i]) pathDist[i] = e;
      // rayon minimal : un sentier d'une case reste continu même entre deux centres de case
      if (d[i] <= Math.max(pa.w / 2, 0.75)) G[i] = T.PATH;
    }
  }

  // --- Ruisseau
  let streamDist: Float32Array | null = null;
  let SW = 0;
  if (p.stream) {
    SW = rng.float(2, 3.2);
    const c = rng.float(0.25, 0.75);
    const pts = horiz
      ? wobblyLine(rng, c * cols, -1, rng.float(0.25, 0.75) * cols, rows + 1, cols * 0.12)
      : wobblyLine(rng, -1, c * rows, cols + 1, rng.float(0.25, 0.75) * rows, rows * 0.12);
    streamDist = distField(cols, rows, pts, SW / 2 + 2);
    for (let i = 0; i < N; i++) {
      const d = streamDist[i];
      if (d <= SW / 2 - 0.9 && SW >= 2.6) G[i] = T.DEEP;
      else if (d <= SW / 2) G[i] = T.WATER;
      else if (d <= SW / 2 + 0.7 && pathDist[i] > 0) G[i] = p.winter ? T.ROCKY : T.MUD;
    }
  }

  const P = new Placer(map, rng);
  const isWater = (i: number) => G[i] === T.WATER || G[i] === T.DEEP;
  // les sentiers restent dégagés
  for (let i = 0; i < N; i++) if (pathDist[i] <= 0.2 || isWater(i)) P.occ[i] = 1;

  // --- Ponts aux croisements sentier / ruisseau
  if (streamDist) {
    for (const pa of paths) {
      if (pa.w < 1.5 && pa !== paths[0]) continue;
      const pts = pa.pts;
      let sx = 0,
        sy = 0,
        n = 0,
        first = -1;
      for (let k = 0; k < pts.length / 2; k++) {
        const x = Math.floor(pts[k * 2]),
          y = Math.floor(pts[k * 2 + 1]);
        if (!map.inBounds(x, y)) continue;
        if (streamDist[y * cols + x] <= SW / 2 + 0.3) {
          if (first < 0) first = k;
          sx += pts[k * 2];
          sy += pts[k * 2 + 1];
          n++;
        } else if (first >= 0) break;
      }
      if (!n) continue;
      const t = pointAt(pts, first / (pts.length / 2 - 1));
      const rot = Math.round((Math.atan2(-t.dx, t.dy) * 180) / Math.PI / 15) * 15;
      P.put('bridge', sx / n, sy / n, ((rot % 360) + 360) % 360, { w: Math.max(2, pa.w + 0.6), h: SW + 2.2, force: true, mark: false });
    }
  }

  // --- Campement dans la clairière
  if (clearing) {
    const { x, y } = clearing;
    if (rng.chance(0.4 + p.lights)) P.put('campfire', Math.floor(x) + 0.5, Math.floor(y) + 0.5, 0, { force: true });
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2 + rng.float(-0.3, 0.3);
      P.put('log', x + Math.cos(ang) * 1.7, y + Math.sin(ang) * 1.7, (((ang * 180) / Math.PI + 90) % 360 + 360) % 360);
    }
    const ta = rng.float(0, Math.PI * 2);
    P.put('tent', x + Math.cos(ta) * (clearing.r - 1.2), y + Math.sin(ta) * (clearing.r - 1.2), rng.int(0, 3) * 90);
    P.put(rng.chance(0.5) ? 'chest' : 'barrel', x + Math.cos(ta + 1.2) * 2.6, y + Math.sin(ta + 1.2) * 2.6, 0);
  }

  // --- Ruines : colonnes brisées autour d'une statue
  if (ruins) {
    P.put('statue', Math.floor(ruins.x) + 0.5, Math.floor(ruins.y) + 0.5, 0);
    const n = rng.int(5, 7);
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2;
      const x = Math.floor(ruins.x + Math.cos(ang) * (ruins.r - 0.8)) + 0.5,
        y = Math.floor(ruins.y + Math.sin(ang) * (ruins.r - 0.8)) + 0.5;
      P.put(rng.chance(0.65) ? 'pillar' : 'rubble', x, y, 0);
    }
    for (let k = 0; k < 3; k++) P.put('rubble', ruins.x + rng.float(-ruins.r, ruins.r), ruins.y + rng.float(-ruins.r, ruins.r), 0);
  }

  // --- Panneaux aux embranchements
  for (const j of junctions) {
    const sp = P.put('signpost', Math.floor(j.x + W) + 0.5, Math.floor(j.y + W) + 0.5, 0);
    if (sp && rng.chance(p.lights)) P.put('lantern', sp.x + 0.6, sp.y, 0, { force: true, mark: false });
  }

  // --- Arbres (grille perturbée, hors sentiers / eau / clairières)
  const avoid = (x: number, y: number, extra: number) =>
    [clearing, ruins].some((s) => s && Math.hypot(x - s.x, y - s.y) < s.r + extra);
  const spacing = 4.6 - 2.4 * Math.max(0, Math.min(1, p.trees));
  if (p.trees > 0)
    for (let gy = -0.5; gy < rows + 0.5; gy += spacing)
      for (let gx = -0.5; gx < cols + 0.5; gx += spacing) {
        const x = gx + rng.float(-0.45, 0.45) * spacing,
          y = gy + rng.float(-0.45, 0.45) * spacing;
        const cx = Math.max(0, Math.min(cols - 1, Math.floor(x))),
          cy = Math.max(0, Math.min(rows - 1, Math.floor(y)));
        const i = cy * cols + cx;
        if (pathDist[i] < 1.2 || isWater(i) || P.occ[i] || avoid(x, y, 0.8)) continue;
        if (streamDist && streamDist[i] < SW / 2 + 1) continue;
        const near = pathDist[i] < 3;
        const size = rng.float(1.6, 3) * (near ? 0.75 : 1);
        const kind = rng.chance(p.winter ? 0.75 : 0.4) ? 'pine' : 'tree';
        P.put(kind, x, y, rng.int(0, 23) * 15, { w: size, h: size, force: true, mark: false });
        P.block(cx, cy);
      }

  // --- Sous-bois
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (P.occ[i] || avoid(x + 0.5, y + 0.5, 0)) continue;
      const r = rng.next();
      const dens = p.props;
      if (pathDist[i] < 2.2 && r < 0.09 * dens) P.put('bush', x + 0.5, y + 0.5, rng.int(0, 3) * 90);
      else if (r < 0.015 * dens) P.put(rng.pick(['boulder', 'stump', 'stump']), x + 0.5, y + 0.5, rng.int(0, 3) * 90);
      else if (r < 0.025 * dens) P.put('log', x + 1, y + 0.5, rng.int(0, 3) * 90);
      else if (r < 0.04 * dens) P.put(G[i] === T.GRASS ? 'flowers' : p.winter ? 'boulder' : 'mushrooms', x + 0.5, y + 0.5, 0);
    }

  map.settings.wallStyle = 'straight';
  map.touchAll();
  return map;
}
