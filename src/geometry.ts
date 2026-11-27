import { DungeonMap, EDGE, Rect, T, TERRAIN_BY_ID, Detail } from './model';
import type { ResolvedTheme } from './themes';
import { hash2, valueNoise } from './util';

// Toutes les coordonnées sont en "cases" (1 unité = 1 case de grille).
// Les polylignes sont des tableaux plats [x0, y0, x1, y1, ...].

export interface Piece {
  kind: number; // EDGE.WALL ou type de porte
  pts: number[];
  closed: boolean;
}

export interface Portal {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: number;
  boundary: boolean; // sur le contour (sol / vide) ou entre deux cases de sol
}

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: number; // EDGE.*
}

export interface TerrainGeo {
  id: number;
  fill: Path2D;
  detail: Path2D | null;
  detailWidth: number;
}

export interface Geometry {
  loops: Piece[][];
  floorPath: Path2D;
  wallPath: Path2D;
  wallPolys: { pts: number[]; closed: boolean }[];
  interiorWalls: Seg[];
  portals: Portal[];
  terrains: TerrainGeo[];
  /** Terrain extérieur (sous les bâtiments). */
  ground: TerrainGeo[];
  groundUnion: Path2D | null;
  floorCount: number;
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

// ---------- Tracé des contours ----------

/**
 * Trace les contours d'un masque de cases. Chaque boucle est une suite de pas [x, y, dir]
 * (sommet de départ + direction 0=E 1=S 2=O 3=N), intérieur à droite (sens horaire à l'écran).
 */
export function traceLoops(mask: Uint8Array, cols: number, rows: number): number[][] {
  const VW = cols + 1;
  const out = new Uint8Array(VW * (rows + 1));
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && mask[y * cols + x] !== 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y * cols + x]) continue;
      if (!at(x, y - 1)) out[y * VW + x] |= 1;
      if (!at(x + 1, y)) out[y * VW + x + 1] |= 2;
      if (!at(x, y + 1)) out[(y + 1) * VW + x + 1] |= 4;
      if (!at(x - 1, y)) out[(y + 1) * VW + x] |= 8;
    }
  }
  const loops: number[][] = [];
  for (let v = 0; v < out.length; v++) {
    while (out[v]) {
      const bits0 = out[v];
      const sd = bits0 & 1 ? 0 : bits0 & 2 ? 1 : bits0 & 4 ? 2 : 3;
      const sx = v % VW;
      const sy = (v / VW) | 0;
      let x = sx,
        y = sy,
        dir = sd;
      const loop: number[] = [];
      for (let guard = 0; guard < out.length * 4; guard++) {
        out[y * VW + x] &= ~(1 << dir);
        loop.push(x, y, dir);
        x += DX[dir];
        y += DY[dir];
        let bits = out[y * VW + x];
        const atStart = x === sx && y === sy;
        if (atStart) bits |= 1 << sd;
        const r = (dir + 1) & 3;
        const l = (dir + 3) & 3;
        let nd: number;
        if (bits & (1 << r)) nd = r;
        else if (bits & (1 << dir)) nd = dir;
        else if (bits & (1 << l)) nd = l;
        else nd = (dir + 2) & 3;
        if (atStart && nd === sd) break;
        if (!(bits & (1 << nd))) break; // sécurité
        dir = nd;
      }
      loops.push(loop);
    }
  }
  return loops;
}

// ---------- Lissage ----------

function chaikinClosed(p: number[], iters: number): number[] {
  for (let it = 0; it < iters; it++) {
    const n = p.length / 2;
    const q: number[] = new Array(n * 4);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = p[i * 2],
        y0 = p[i * 2 + 1],
        x1 = p[j * 2],
        y1 = p[j * 2 + 1];
      q[i * 4] = 0.75 * x0 + 0.25 * x1;
      q[i * 4 + 1] = 0.75 * y0 + 0.25 * y1;
      q[i * 4 + 2] = 0.25 * x0 + 0.75 * x1;
      q[i * 4 + 3] = 0.25 * y0 + 0.75 * y1;
    }
    p = q;
  }
  return p;
}

function chaikinOpen(p: number[], iters: number): number[] {
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

function jitter(p: number[], closed: boolean, amp: number): number[] {
  const n = p.length / 2;
  const out = p.slice();
  let total = 0;
  const cum = new Float64Array(n);
  if (!closed) {
    for (let i = 1; i < n; i++) {
      total += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      cum[i] = total;
    }
  }
  for (let i = 0; i < n; i++) {
    const x = p[i * 2],
      y = p[i * 2 + 1];
    let w = 1;
    if (!closed) w = Math.min(1, cum[i] / 0.9, (total - cum[i]) / 0.9);
    out[i * 2] = x + (valueNoise(x * 1.6, y * 1.6, 11) - 0.5) * 2 * amp * w;
    out[i * 2 + 1] = y + (valueNoise(x * 1.6 + 31.4, y * 1.6 + 17.2, 23) - 0.5) * 2 * amp * w;
  }
  return out;
}

function reduceCollinear(p: number[], closed: boolean): number[] {
  const n = p.length / 2;
  if (n < 3) return p;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(p[i * 2], p[i * 2 + 1]);
      continue;
    }
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const cross = (p[i * 2] - p[a * 2]) * (p[b * 2 + 1] - p[i * 2 + 1]) - (p[i * 2 + 1] - p[a * 2 + 1]) * (p[b * 2] - p[i * 2]);
    if (Math.abs(cross) > 1e-9) out.push(p[i * 2], p[i * 2 + 1]);
  }
  return out;
}

function dpRec(p: number[], i0: number, i1: number, tol2: number, keep: Uint8Array): void {
  const ax = p[i0 * 2],
    ay = p[i0 * 2 + 1],
    bx = p[i1 * 2],
    by = p[i1 * 2 + 1];
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-12;
  let maxD = -1,
    idx = -1;
  for (let i = i0 + 1; i < i1; i++) {
    const px = p[i * 2] - ax,
      py = p[i * 2 + 1] - ay;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
    const ex = px - t * dx,
      ey = py - t * dy;
    const d = ex * ex + ey * ey;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > tol2 && idx > 0) {
    keep[idx] = 1;
    dpRec(p, i0, idx, tol2, keep);
    dpRec(p, idx, i1, tol2, keep);
  }
}

/** Simplification Douglas-Peucker. */
export function simplify(p: number[], tol: number, closed: boolean): number[] {
  const n = p.length / 2;
  if (n < 4) return p;
  const keep = new Uint8Array(n);
  const tol2 = tol * tol;
  if (closed) {
    const mid = n >> 1;
    keep[0] = keep[mid] = 1;
    const ext = p.concat([p[0], p[1]]);
    const keepExt = new Uint8Array(n + 1);
    keepExt[0] = keepExt[mid] = keepExt[n] = 1;
    dpRec(ext, 0, mid, tol2, keepExt);
    dpRec(ext, mid, n, tol2, keepExt);
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (keepExt[i]) out.push(p[i * 2], p[i * 2 + 1]);
    return out;
  }
  keep[0] = keep[n - 1] = 1;
  dpRec(p, 0, n - 1, tol2, keep);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

const MODE_STRAIGHT = 0,
  MODE_ROUND = 1,
  MODE_ORGANIC = 2;

/** Remplace chaque arête unitaire par son milieu : un escalier devient une diagonale. */
function midpoints(p: number[], closed: boolean): number[] {
  const n = p.length / 2;
  const out: number[] = closed ? [] : [p[0], p[1]];
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n;
    out.push((p[i * 2] + p[j * 2]) / 2, (p[i * 2 + 1] + p[j * 2 + 1]) / 2);
  }
  if (!closed) out.push(p[n * 2 - 2], p[n * 2 - 1]);
  return out;
}

function shapePiece(pts: number[], closed: boolean, mode: number): number[] {
  if (mode === MODE_STRAIGHT) return reduceCollinear(pts, closed);
  if (mode === MODE_ORGANIC) pts = midpoints(pts, closed);
  const iters = 2;
  let p = closed ? chaikinClosed(pts, iters) : chaikinOpen(pts, iters);
  if (mode === MODE_ORGANIC) p = jitter(p, closed, 0.13);
  return simplify(p, 0.012, closed);
}

function addPoly(path: Path2D, p: number[], closed: boolean): void {
  if (p.length < 4) return;
  path.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]);
  if (closed) path.closePath();
}

// ---------- Construction de la géométrie ----------

function stepEdge(map: DungeonMap, x: number, y: number, d: number): { e: number; cx: number; cy: number } {
  switch (d) {
    case 0:
      return { e: map.hEdge(x, y), cx: x, cy: y };
    case 1:
      return { e: map.vEdge(x, y), cx: x - 1, cy: y };
    case 2:
      return { e: map.hEdge(x - 1, y), cx: x - 1, cy: y - 1 };
    default:
      return { e: map.vEdge(x, y - 1), cx: x, cy: y - 1 };
  }
}

export function buildGeometry(map: DungeonMap): Geometry {
  const { cols, rows, cells } = map;
  const globalMode = map.settings.wallStyle === 'organic' ? MODE_ORGANIC : map.settings.wallStyle === 'rounded' ? MODE_ROUND : MODE_STRAIGHT;
  const mask = new Uint8Array(cols * rows);
  let floorCount = 0;
  for (let i = 0; i < cells.length; i++)
    if (cells[i]) {
      mask[i] = 1;
      floorCount++;
    }

  const rawLoops = traceLoops(mask, cols, rows);
  const loops: Piece[][] = [];
  const portals: Portal[] = [];
  const floorPath = new Path2D();
  const wallPath = new Path2D();
  const wallPolys: { pts: number[]; closed: boolean }[] = [];

  for (const loop of rawLoops) {
    const n = loop.length / 3;
    const keys = new Int32Array(n);
    const kinds = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const x = loop[i * 3],
        y = loop[i * 3 + 1],
        d = loop[i * 3 + 2];
      const { e, cx, cy } = stepEdge(map, x, y, d);
      const kind = e >= EDGE.DOOR ? e : EDGE.WALL;
      kinds[i] = kind;
      const mode = kind === EDGE.WALL ? (map.get(cx, cy) === T.CAVE ? MODE_ORGANIC : globalMode) : MODE_STRAIGHT;
      keys[i] = kind * 4 + mode;
      if (kind !== EDGE.WALL) {
        portals.push({ x1: x, y1: y, x2: x + DX[d], y2: y + DY[d], type: kind, boundary: true });
      }
    }
    let start = -1;
    for (let i = 0; i < n; i++) {
      if (keys[i] !== keys[(i - 1 + n) % n]) {
        start = i;
        break;
      }
    }
    const pieces: Piece[] = [];
    if (start < 0) {
      const pts: number[] = [];
      for (let i = 0; i < n; i++) pts.push(loop[i * 3], loop[i * 3 + 1]);
      const mode = keys[0] & 3;
      pieces.push({ kind: kinds[0], pts: shapePiece(pts, true, mode), closed: true });
    } else {
      let i = 0;
      while (i < n) {
        const s = (start + i) % n;
        const key = keys[s];
        const pts: number[] = [loop[s * 3], loop[s * 3 + 1]];
        let j = i;
        while (j < n && keys[(start + j) % n] === key) {
          const k = (start + j) % n;
          pts.push(loop[k * 3] + DX[loop[k * 3 + 2]], loop[k * 3 + 1] + DY[loop[k * 3 + 2]]);
          j++;
        }
        pieces.push({ kind: kinds[s], pts: shapePiece(pts, false, key & 3), closed: false });
        i = j;
      }
    }
    // chemin du sol
    let first = true;
    for (const pc of pieces) {
      const p = pc.pts;
      for (let k = first ? 0 : 2; k < p.length; k += 2) {
        if (first && k === 0) floorPath.moveTo(p[0], p[1]);
        else floorPath.lineTo(p[k], p[k + 1]);
      }
      first = false;
    }
    floorPath.closePath();
    for (const pc of pieces) {
      if (pc.kind === EDGE.WALL) {
        addPoly(wallPath, pc.pts, pc.closed);
        wallPolys.push({ pts: pc.pts, closed: pc.closed });
      }
    }
    loops.push(pieces);
  }

  // Arêtes intérieures (entre deux cases de sol)
  const interiorWalls: Seg[] = [];
  for (let y = 1; y < rows; y++) {
    let run = -1;
    for (let x = 0; x <= cols; x++) {
      const e = x < cols ? map.hEdges[y * cols + x] : 0;
      const both = x < cols && cells[(y - 1) * cols + x] !== 0 && cells[y * cols + x] !== 0;
      const isWall = both && e === EDGE.WALL;
      if (isWall && run < 0) run = x;
      if (!isWall && run >= 0) {
        interiorWalls.push({ x1: run, y1: y, x2: x, y2: y, type: EDGE.WALL });
        run = -1;
      }
      if (both && e >= EDGE.DOOR) portals.push({ x1: x, y1: y, x2: x + 1, y2: y, type: e, boundary: false });
    }
  }
  for (let x = 1; x < cols; x++) {
    let run = -1;
    for (let y = 0; y <= rows; y++) {
      const e = y < rows ? map.vEdges[y * (cols + 1) + x] : 0;
      const both = y < rows && cells[y * cols + x - 1] !== 0 && cells[y * cols + x] !== 0;
      const isWall = both && e === EDGE.WALL;
      if (isWall && run < 0) run = y;
      if (!isWall && run >= 0) {
        interiorWalls.push({ x1: x, y1: run, x2: x, y2: y, type: EDGE.WALL });
        run = -1;
      }
      if (both && e >= EDGE.DOOR) portals.push({ x1: x, y1: y, x2: x, y2: y + 1, type: e, boundary: false });
    }
  }
  for (const s of interiorWalls) {
    wallPath.moveTo(s.x1, s.y1);
    wallPath.lineTo(s.x2, s.y2);
  }

  const ground = buildLayer(map.ground, cols, rows, GROUND_ORDER, false);
  let groundUnion: Path2D | null = null;
  if (ground.length) {
    groundUnion = new Path2D();
    for (const g of ground) groundUnion.addPath(g.fill);
  }
  return {
    loops,
    floorPath,
    wallPath,
    wallPolys,
    interiorWalls,
    portals,
    terrains: buildLayer(cells, cols, rows, FLOOR_ORDER, true),
    ground,
    groundUnion,
    floorCount,
  };
}

// ---------- Terrains ----------

const DETAIL_WIDTH: Record<Detail, number> = {
  none: 0,
  planks: 0.03,
  tiles: 0.025,
  speckle: 0.07,
  grass: 0.035,
  ripples: 0.035,
  cracks: 0.045,
  weave: 0.02,
  pit: 0,
  rock: 0.05,
  leaves: 0.03,
  cobble: 0.03,
  rows: 0.035,
  snow: 0.06,
  pebbles: 0.08,
};

// Ordre d'affichage : sols "plats" d'abord, liquides ensuite. Le sol de base (dalle) n'est pas dessiné ici.
const FLOOR_ORDER = [T.WOOD, T.TILES, T.CARPET, T.DIRT, T.GRASS, T.CAVE, T.WATER, T.DEEP, T.LAVA, T.PIT];
const GROUND_ORDER = [T.FIELD, T.FOREST, T.GRASS, T.SNOW, T.SAND, T.ROCKY, T.DIRT, T.MUD, T.PATH, T.ROAD, T.WATER, T.DEEP, T.LAVA];

/**
 * Construit les zones de terrain d'un calque. Chaque masque déborde d'une case sur les voisines
 * dessinées ensuite (et, pour le sol bâti, sur le vide) : le terrain du dessous comble ainsi
 * les coins coupés par le lissage du terrain du dessus.
 */
function buildLayer(arr: Uint8Array, cols: number, rows: number, order: number[], dilateVoid: boolean): TerrainGeo[] {
  const present = new Set<number>();
  for (let i = 0; i < arr.length; i++) if (arr[i]) present.add(arr[i]);
  const out: TerrainGeo[] = [];
  const rank = new Int8Array(256).fill(-1);
  order.forEach((id, k) => (rank[id] = k));
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= cols || y >= rows ? -1 : arr[y * cols + x]);
  for (const id of order) {
    if (!present.has(id)) continue;
    const def = TERRAIN_BY_ID[id];
    const mask = new Uint8Array(cols * rows);
    const k = rank[id];
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const v = arr[i];
        if (v === id) mask[i] = 1;
        else if ((v === 0 && dilateVoid) || rank[v] > k) {
          let near = false;
          for (let dy = -1; dy <= 1 && !near; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (at(x + dx, y + dy) === id) {
                near = true;
                break;
              }
            }
          if (near) mask[i] = 1;
        }
      }
    const fill = new Path2D();
    if (def.smooth) {
      for (const loop of traceLoops(mask, cols, rows)) {
        const pts: number[] = [];
        for (let i = 0; i < loop.length; i += 3) pts.push(loop[i], loop[i + 1]);
        addPoly(fill, simplify(chaikinClosed(midpoints(pts, true), 2), 0.01, true), true);
      }
    } else {
      for (let y = 0; y < rows; y++) {
        let run = -1;
        for (let x = 0; x <= cols; x++) {
          const on = x < cols && mask[y * cols + x] === 1;
          if (on && run < 0) run = x;
          if (!on && run >= 0) {
            fill.rect(run, y, x - run, 1);
            run = -1;
          }
        }
      }
    }
    let detail: Path2D | null = null;
    if (def.detail !== 'none' && def.detail !== 'pit') {
      detail = new Path2D();
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) if (arr[y * cols + x] === id) addDetail(detail, def.detail, x, y);
    }
    out.push({ id, fill, detail, detailWidth: DETAIL_WIDTH[def.detail] });
  }
  return out;
}

function dot(p: Path2D, x: number, y: number): void {
  p.moveTo(x, y);
  p.lineTo(x + 0.001, y);
}

function addDetail(p: Path2D, kind: Detail, x: number, y: number): void {
  const h = (k: number) => hash2(x, y, k);
  switch (kind) {
    case 'planks': {
      for (let k = 0; k < 3; k++) {
        const yy = y + k / 3;
        p.moveTo(x, yy);
        p.lineTo(x + 1, yy);
        if (h(k) < 0.55) {
          const jx = x + 0.15 + h(k + 10) * 0.7;
          p.moveTo(jx, yy);
          p.lineTo(jx, yy + 1 / 3);
        }
      }
      break;
    }
    case 'tiles': {
      p.moveTo(x, y);
      p.lineTo(x + 1, y);
      p.moveTo(x, y);
      p.lineTo(x, y + 1);
      p.moveTo(x, y + 0.5);
      p.lineTo(x + 1, y + 0.5);
      p.moveTo(x + 0.5, y);
      p.lineTo(x + 0.5, y + 1);
      break;
    }
    case 'speckle': {
      for (let k = 0; k < 5; k++) if (h(k) < 0.7) dot(p, x + h(k + 20), y + h(k + 40));
      break;
    }
    case 'rock': {
      for (let k = 0; k < 3; k++) if (h(k) < 0.45) dot(p, x + h(k + 20), y + h(k + 40));
      if (h(77) < 0.25) {
        const cx = x + 0.2 + h(78) * 0.6,
          cy = y + 0.2 + h(79) * 0.6;
        p.moveTo(cx - 0.12, cy + 0.04);
        p.quadraticCurveTo(cx, cy - 0.1, cx + 0.12, cy + 0.04);
      }
      break;
    }
    case 'grass': {
      for (let k = 0; k < 3; k++) {
        if (h(k) > 0.6) continue;
        const cx = x + 0.1 + h(k + 20) * 0.8,
          cy = y + 0.15 + h(k + 40) * 0.8;
        p.moveTo(cx - 0.07, cy - 0.11);
        p.lineTo(cx, cy);
        p.lineTo(cx + 0.02, cy - 0.14);
        p.moveTo(cx, cy);
        p.lineTo(cx + 0.09, cy - 0.09);
      }
      break;
    }
    case 'ripples': {
      if (h(1) < 0.55) {
        const cx = x + 0.2 + h(2) * 0.6,
          cy = y + 0.2 + h(3) * 0.6;
        p.moveTo(cx - 0.22, cy);
        p.quadraticCurveTo(cx - 0.11, cy - 0.07, cx, cy);
        p.quadraticCurveTo(cx + 0.11, cy + 0.07, cx + 0.22, cy);
      }
      break;
    }
    case 'cracks': {
      if (h(1) < 0.7) {
        let cx = x + h(2),
          cy = y + h(3);
        p.moveTo(cx, cy);
        for (let k = 0; k < 3; k++) {
          cx += (h(k + 4) - 0.5) * 0.6;
          cy += (h(k + 8) - 0.5) * 0.6;
          p.lineTo(cx, cy);
        }
      }
      break;
    }
    case 'leaves': {
      for (let k = 0; k < 3; k++) {
        if (h(k) > 0.55) continue;
        const cx = x + h(k + 20),
          cy = y + h(k + 40);
        const a = h(k + 60) * Math.PI;
        const dx = Math.cos(a) * 0.09,
          dy = Math.sin(a) * 0.09;
        p.moveTo(cx - dx, cy - dy);
        p.quadraticCurveTo(cx - dy * 0.8, cy + dx * 0.8, cx + dx, cy + dy);
      }
      if (h(90) < 0.12) {
        const cx = x + h(91),
          cy = y + h(92);
        p.moveTo(cx - 0.2, cy + 0.05);
        p.lineTo(cx + 0.2, cy - 0.05);
      }
      break;
    }
    case 'cobble': {
      // pavés en quinconce
      p.moveTo(x, y);
      p.lineTo(x + 1, y);
      p.moveTo(x, y + 0.5);
      p.lineTo(x + 1, y + 0.5);
      p.moveTo(x + 0.5, y);
      p.lineTo(x + 0.5, y + 0.5);
      p.moveTo(x + 0.25, y + 0.5);
      p.lineTo(x + 0.25, y + 1);
      p.moveTo(x + 0.75, y + 0.5);
      p.lineTo(x + 0.75, y + 1);
      break;
    }
    case 'rows': {
      for (const f of [0.17, 0.5, 0.83]) {
        p.moveTo(x, y + f);
        p.lineTo(x + 1, y + f);
      }
      for (let k = 0; k < 3; k++) if (h(k) < 0.5) dot(p, x + h(k + 10), y + 0.33 + Math.floor(h(k + 20) * 2) * 0.33);
      break;
    }
    case 'snow': {
      for (let k = 0; k < 2; k++) if (h(k) < 0.4) dot(p, x + h(k + 20), y + h(k + 40));
      break;
    }
    case 'pebbles': {
      for (let k = 0; k < 4; k++) if (h(k) < 0.55) dot(p, x + h(k + 20), y + h(k + 40));
      break;
    }
    case 'weave': {
      for (let u = 0.25; u < 2; u += 0.25) {
        const ax = Math.max(0, u - 1),
          ay = Math.min(1, u);
        const bx = Math.min(1, u),
          by = Math.max(0, u - 1);
        p.moveTo(x + ax, y + ay);
        p.lineTo(x + bx, y + by);
      }
      break;
    }
  }
}

// ---------- Hachures (par blocs de 16×16 cases, reconstruits localement) ----------

const CHUNK = 16;

export class HatchCache {
  chunks = new Map<number, Path2D>();
  private key = '';
  private cols = 0;
  private rows = 0;

  update(map: DungeonMap, theme: ResolvedTheme, dirty: Rect | null): void {
    const key = `${theme.hatchStyle}|${theme.hatchWidth}|${map.cols}x${map.rows}`;
    let area: Rect | null = dirty;
    if (key !== this.key) {
      this.key = key;
      this.chunks.clear();
      this.cols = map.cols;
      this.rows = map.rows;
      area = { x0: 0, y0: 0, x1: map.cols, y1: map.rows };
    }
    if (!area || theme.hatchStyle === 'none') return;
    const R = Math.ceil(theme.hatchWidth + 0.5);
    const cx0 = Math.max(0, Math.floor((area.x0 - R) / CHUNK));
    const cy0 = Math.max(0, Math.floor((area.y0 - R) / CHUNK));
    const cx1 = Math.min(Math.ceil(this.cols / CHUNK) - 1, Math.floor((area.x1 + R) / CHUNK));
    const cy1 = Math.min(Math.ceil(this.rows / CHUNK) - 1, Math.floor((area.y1 + R) / CHUNK));
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const path = buildHatchChunk(map, theme, cx * CHUNK, cy * CHUNK, R);
        const k = cy * 10000 + cx;
        if (path) this.chunks.set(k, path);
        else this.chunks.delete(k);
      }
  }

  /** Blocs visibles dans le rectangle monde donné. */
  visible(x0: number, y0: number, x1: number, y1: number): Path2D[] {
    const out: Path2D[] = [];
    const cx0 = Math.floor(x0 / CHUNK) - 1,
      cy0 = Math.floor(y0 / CHUNK) - 1;
    const cx1 = Math.floor(x1 / CHUNK) + 1,
      cy1 = Math.floor(y1 / CHUNK) + 1;
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const p = this.chunks.get(cy * 10000 + cx);
        if (p) out.push(p);
      }
    return out;
  }
}

function buildHatchChunk(map: DungeonMap, theme: ResolvedTheme, bx: number, by: number, R: number): Path2D | null {
  const path = new Path2D();
  let any = false;
  const W = theme.hatchWidth;
  const near: number[] = [];
  const ex = Math.min(map.cols, bx + CHUNK),
    ey = Math.min(map.rows, by + CHUNK);
  const distTo = (px: number, py: number) => {
    let best = 1e9;
    for (let i = 0; i < near.length; i += 2) {
      const fx = near[i],
        fy = near[i + 1];
      const dx = Math.max(fx - px, 0, px - fx - 1);
      const dy = Math.max(fy - py, 0, py - fy - 1);
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const cells = map.cells,
    ground = map.ground;
  for (let y = by; y < ey; y++) {
    for (let x = bx; x < ex; x++) {
      const ci = y * map.cols + x;
      // pas de hachures sur le sol ni sur le terrain extérieur
      if (cells[ci] || ground[ci]) continue;
      near.length = 0;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) if (map.get(x + dx, y + dy)) near.push(x + dx, y + dy);
      if (!near.length) continue;
      if (theme.hatchStyle === 'clusters') {
        for (let k = 0; k < 3; k++) {
          const cx = x + hash2(x, y, k * 7 + 1);
          const cy = y + hash2(x, y, k * 7 + 2);
          const d = distTo(cx, cy);
          if (d > W * (0.75 + 0.5 * hash2(x, y, k * 7 + 3))) continue;
          const ang = hash2(x, y, k * 7 + 4) * Math.PI;
          const nl = 3 + Math.floor(hash2(x, y, k * 7 + 5) * 3);
          const len = 0.34 + hash2(x, y, k * 7 + 6) * 0.22;
          const ux = Math.cos(ang),
            uy = Math.sin(ang);
          const sp = 0.085;
          for (let i = 0; i < nl; i++) {
            const off = (i - (nl - 1) / 2) * sp;
            const l = len * (0.8 + 0.4 * hash2(x * 3 + i, y, k));
            const mx = cx - uy * off,
              my = cy + ux * off;
            path.moveTo(mx - (ux * l) / 2, my - (uy * l) / 2);
            path.lineTo(mx + (ux * l) / 2, my + (uy * l) / 2);
          }
          any = true;
        }
      } else if (theme.hatchStyle === 'lines') {
        const s = 0.2;
        for (let u = s; u < 2; u += s) {
          const ax = Math.max(0, u - 1),
            ay = Math.min(1, u);
          const bx2 = Math.min(1, u),
            by2 = Math.max(0, u - 1);
          const mx = x + (ax + bx2) / 2,
            my = y + (ay + by2) / 2;
          if (distTo(mx, my) > W) continue;
          path.moveTo(x + ax, y + ay);
          path.lineTo(x + bx2, y + by2);
          any = true;
        }
      } else if (theme.hatchStyle === 'dots') {
        for (let k = 0; k < 7; k++) {
          const px = x + hash2(x, y, k * 5 + 1),
            py = y + hash2(x, y, k * 5 + 2);
          const d = distTo(px, py);
          if (hash2(x, y, k * 5 + 3) > 1 - d / W) continue;
          dot(path, px, py);
          any = true;
        }
      }
    }
  }
  return any ? path : null;
}

// ---------- Cache global ----------

export class GeoCache {
  private version = -1;
  private style = '';
  private geo: Geometry | null = null;
  private mapRef: DungeonMap | null = null;
  hatch = new HatchCache();

  get(map: DungeonMap, theme: ResolvedTheme): Geometry {
    if (map !== this.mapRef) {
      this.reset();
      this.mapRef = map;
    }
    if (!this.geo || this.version !== map.version || this.style !== map.settings.wallStyle) {
      this.geo = buildGeometry(map);
      this.version = map.version;
      this.style = map.settings.wallStyle;
    }
    this.hatch.update(map, theme, map.dirty);
    map.dirty = null;
    return this.geo;
  }

  reset(): void {
    this.version = -1;
    this.geo = null;
    this.hatch = new HatchCache();
  }
}

// ---------- Segments de murs (export Foundry / éclairage) ----------

export function wallSegments(geo: Geometry, tol = 0.05): Seg[] {
  const out: Seg[] = [];
  for (const poly of geo.wallPolys) {
    const p = simplify(poly.pts, tol, poly.closed);
    const n = p.length / 2;
    const m = poly.closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n;
      out.push({ x1: p[i * 2], y1: p[i * 2 + 1], x2: p[j * 2], y2: p[j * 2 + 1], type: EDGE.WALL });
    }
  }
  for (const s of geo.interiorWalls) out.push({ ...s });
  for (const d of geo.portals) out.push({ x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, type: d.type });
  return out;
}
