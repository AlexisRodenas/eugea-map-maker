import { DungeonMap, EDGE, Rampart, T } from '../model';
import { cutGate, hitRampart } from '../ramparts';
import { Rng, fbm, hashString, uid } from '../util';
import { Dresser, RoomInfo, RoomType } from './dressing';
import { Placer, distField, wobblyLine } from './outdoor';

export interface VillageParams {
  cols: number;
  rows: number;
  seed: string;
  buildings: number;
  town: boolean; // ville : rues pavées, bâtiments plus grands et serrés
  roadWidth: number;
  river: boolean;
  fields: number;
  trees: number;
  interiors: number;
  lights: number;
  names: boolean;
  roofs: boolean; // toits (tuiles Foundry au-dessus des jetons)
  wall: 'none' | 'palisade' | 'stone'; // enceinte autour des bâtiments, portes sur les routes
}

export const DEFAULT_VILLAGE: VillageParams = {
  cols: 56,
  rows: 42,
  seed: 'bourg-2048',
  buildings: 10,
  town: false,
  roadWidth: 2,
  river: false,
  fields: 0.4,
  trees: 0.5,
  interiors: 0.8,
  lights: 0.5,
  names: true,
  roofs: true,
  wall: 'none',
};

type Kind = 'maison' | 'taverne' | 'forge' | 'echoppe' | 'chapelle' | 'grange' | 'entrepot';

const NAMES: Record<Kind, string[]> = {
  maison: ['Maison'],
  taverne: ['Taverne du Sanglier', 'Auberge du Pendu', 'Le Chaudron Fêlé', 'Taverne de la Licorne', "L'Oie Grise"],
  forge: ['Forge'],
  echoppe: ['Échoppe', 'Herboriste', 'Marchand', 'Apothicaire', 'Tailleur'],
  chapelle: ['Chapelle', 'Temple'],
  grange: ['Grange', 'Écurie'],
  entrepot: ['Entrepôt'],
};

interface Building {
  x: number;
  y: number;
  w: number; // largeur (le long de la rue)
  d: number; // profondeur
  front: number; // côté donnant sur la rue : 0=N 1=E 2=S 3=O
  kind: Kind;
}

function roofKind(kind: Kind, town: boolean, rng: Rng): string {
  switch (kind) {
    case 'chapelle':
    case 'forge':
      return 'roofSlate';
    case 'taverne':
    case 'echoppe':
      return town ? 'roofTiles' : rng.pick(['roofTiles', 'roofShingle']);
    case 'grange':
      return town ? 'roofShingle' : 'roofThatch';
    case 'entrepot':
      return 'roofShingle';
    default:
      return town ? rng.pick(['roofTiles', 'roofTiles', 'roofSlate']) : rng.pick(['roofThatch', 'roofThatch', 'roofShingle']);
  }
}

export function generateVillage(p: VillageParams): DungeonMap {
  const rng = new Rng(hashString(p.seed || 'village'));
  const seedN = hashString(p.seed) % 1000;
  const { cols, rows } = p;
  const N = cols * rows;
  const map = new DungeonMap(cols, rows);
  map.name = (p.town ? 'Ville ' : 'Village ') + p.seed;
  const G = map.ground;
  const roadT = p.town ? T.ROAD : T.PATH;
  const RW = Math.max(1, Math.min(4, p.roadWidth)) + (p.town ? 0.5 : 0);

  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const n = fbm(x * 0.08, y * 0.08, 3, seedN);
      G[y * cols + x] = !p.town && n > 0.66 ? T.DIRT : T.GRASS;
    }

  // --- Rues
  const y0 = rng.float(0.4, 0.6) * rows,
    x0 = rng.float(0.38, 0.62) * cols;
  const roads: { pts: number[]; w: number }[] = [];
  if (p.town) {
    roads.push({ pts: [-1, y0, cols + 1, y0], w: RW });
    roads.push({ pts: [x0, -1, x0, rows + 1], w: RW });
    const extra = rng.int(2, 4);
    for (let k = 0; k < extra; k++) {
      if (k % 2 === 0) {
        const yy = y0 + (rng.chance(0.5) ? -1 : 1) * rng.float(9, 12);
        if (yy > 4 && yy < rows - 4) roads.push({ pts: [rng.chance(0.5) ? -1 : x0, yy, rng.chance(0.5) ? cols + 1 : x0, yy], w: RW - 0.5 });
      } else {
        const xx = x0 + (rng.chance(0.5) ? -1 : 1) * rng.float(11, 15);
        if (xx > 4 && xx < cols - 4) roads.push({ pts: [xx, rng.chance(0.5) ? -1 : y0, xx, rng.chance(0.5) ? rows + 1 : y0], w: RW - 0.5 });
      }
    }
  } else {
    roads.push({ pts: wobblyLine(rng, -1, y0, cols + 1, y0 + rng.float(-3, 3), 3), w: RW });
    const up = rng.chance(0.5);
    roads.push({ pts: wobblyLine(rng, x0, y0, x0 + rng.float(-6, 6), up ? -1 : rows + 1, 3), w: RW - 0.5 });
    if (rng.chance(0.5)) roads.push({ pts: wobblyLine(rng, x0, y0, x0 + rng.float(-6, 6), up ? rows + 1 : -1, 3), w: RW - 0.5 });
  }
  const roadDist = new Float32Array(N).fill(1e9);
  for (const r of roads) {
    const d = distField(cols, rows, r.pts, r.w / 2 + 6);
    for (let i = 0; i < N; i++) {
      const e = d[i] - r.w / 2;
      if (e < roadDist[i]) roadDist[i] = e;
    }
  }
  // place centrale
  const SQ = p.town ? 4.5 : 3.5;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const ds = Math.hypot(x + 0.5 - x0, y + 0.5 - y0) - SQ;
      if (ds < roadDist[i]) roadDist[i] = ds;
      if (roadDist[i] <= 0) G[i] = roadT;
    }

  // --- Rivière
  let riverDist: Float32Array | null = null;
  const RV = 3.2;
  if (p.river) {
    const rx = (rng.chance(0.5) ? rng.float(0.12, 0.25) : rng.float(0.75, 0.88)) * cols;
    riverDist = distField(cols, rows, wobblyLine(rng, rx, -1, rx + rng.float(-5, 5), rows + 1, 4), RV / 2 + 2);
    for (let i = 0; i < N; i++) {
      const d = riverDist[i];
      if (d <= RV / 2 - 1) G[i] = T.DEEP;
      else if (d <= RV / 2) G[i] = T.WATER;
      else if (d <= RV / 2 + 0.8 && roadDist[i] > 0) G[i] = T.SAND;
    }
  }

  const P = new Placer(map, rng);
  const blocked = new Uint8Array(N); // rues, eau, bâtiments (+ marge)
  for (let i = 0; i < N; i++) {
    if (roadDist[i] <= 0.3 || G[i] === T.WATER || G[i] === T.DEEP) {
      blocked[i] = 1;
      P.occ[i] = 1;
    }
  }

  // --- Ponts
  if (riverDist) {
    for (const r of roads) {
      const pts = r.pts;
      const dense: number[] = [];
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const steps = Math.ceil(Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]) * 2);
        for (let s = 0; s < steps; s++) dense.push(pts[k] + ((pts[k + 2] - pts[k]) * s) / steps, pts[k + 1] + ((pts[k + 3] - pts[k + 1]) * s) / steps);
      }
      let sx = 0,
        sy = 0,
        n = 0,
        dx = 0,
        dy = 0;
      for (let k = 0; k < dense.length / 2 - 1; k++) {
        const x = Math.floor(dense[k * 2]),
          y = Math.floor(dense[k * 2 + 1]);
        if (!map.inBounds(x, y) || riverDist[y * cols + x] > RV / 2 + 0.2) {
          if (n) break;
          continue;
        }
        sx += dense[k * 2];
        sy += dense[k * 2 + 1];
        dx = dense[k * 2 + 2] - dense[k * 2];
        dy = dense[k * 2 + 3] - dense[k * 2 + 1];
        n++;
      }
      if (!n) continue;
      const rot = Math.round((Math.atan2(-dx, dy) * 180) / Math.PI / 15) * 15;
      P.put('bridge', sx / n, sy / n, ((rot % 360) + 360) % 360, { w: r.w + 1, h: RV + 2.4, force: true, mark: false });
    }
  }

  // --- Bâtiments le long des rues
  const kinds: [Kind, number][] = p.town
    ? [
        ['maison', 4],
        ['taverne', 1.5],
        ['echoppe', 3],
        ['forge', 1],
        ['chapelle', 0.6],
        ['entrepot', 1],
      ]
    : [
        ['maison', 6],
        ['taverne', 1],
        ['forge', 1],
        ['echoppe', 1],
        ['chapelle', 0.5],
        ['grange', 1.5],
      ];
  const unique = new Set<Kind>(['taverne', 'chapelle', 'forge']);
  const used = new Map<Kind, number>();
  const buildings: Building[] = [];
  const candidates: { x: number; y: number; horiz: boolean }[] = [];
  for (const r of roads) {
    const pts = r.pts;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const len = Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
      const steps = Math.max(1, Math.round(len));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        candidates.push({
          x: pts[k] + (pts[k + 2] - pts[k]) * t,
          y: pts[k + 1] + (pts[k + 3] - pts[k + 1]) * t,
          horiz: Math.abs(pts[k + 2] - pts[k]) >= Math.abs(pts[k + 3] - pts[k + 1]),
        });
      }
    }
  }
  rng.shuffle(candidates);
  const fits = (bx: number, by: number, bw: number, bh: number) => {
    if (bx < 1 || by < 1 || bx + bw > cols - 1 || by + bh > rows - 1) return false;
    for (let y = by - 1; y <= by + bh; y++) for (let x = bx - 1; x <= bx + bw; x++) if (map.inBounds(x, y) && blocked[y * cols + x]) return false;
    return true;
  };
  for (const c of candidates) {
    if (buildings.length >= p.buildings) break;
    let kind = rng.weighted(kinds);
    if (unique.has(kind) && (used.get(kind) ?? 0) >= (p.town ? 2 : 1)) kind = 'maison';
    const big = kind === 'taverne' || kind === 'chapelle' || kind === 'grange' || kind === 'entrepot';
    const w = rng.int(p.town ? 5 : 4, (p.town ? 9 : 7) + (big ? 2 : 0));
    const d = rng.int(p.town ? 5 : 4, (p.town ? 8 : 6) + (big ? 2 : 0));
    const gap = p.town ? 1 : rng.int(1, 2);
    for (const side of rng.shuffle([-1, 1])) {
      let b: Building;
      // distance du bord de la rue au centre de l'échantillon
      const edge = (c.horiz ? RW : RW) / 2 + gap;
      if (c.horiz) {
        const bx = Math.round(c.x - w / 2);
        b = side < 0 ? { x: bx, y: Math.floor(c.y - edge - d), w, d, front: 2, kind } : { x: bx, y: Math.ceil(c.y + edge), w, d, front: 0, kind };
        if (!fits(b.x, b.y, w, d)) continue;
      } else {
        const by = Math.round(c.y - w / 2);
        b = side < 0 ? { x: Math.floor(c.x - edge - d), y: by, w, d, front: 1, kind } : { x: Math.ceil(c.x + edge), y: by, w, d, front: 3, kind };
        if (!fits(b.x, b.y, d, w)) continue;
      }
      buildings.push(b);
      used.set(kind, (used.get(kind) ?? 0) + 1);
      const bw = c.horiz ? w : d,
        bh = c.horiz ? d : w;
      for (let y = b.y - 1; y <= b.y + bh; y++) for (let x = b.x - 1; x <= b.x + bw; x++) if (map.inBounds(x, y)) blocked[y * cols + x] = 1;
      // l'emprise du bâtiment est interdite aux objets d'extérieur
      for (let y = b.y; y < b.y + bh; y++) for (let x = b.x; x < b.x + bw; x++) P.block(x, y);
      break;
    }
  }

  // --- Construction : sols, portes, fenêtres, cloisons, aménagement
  const roomId = new Int16Array(N).fill(-1);
  const rooms: RoomInfo[] = [];
  const doors: { x: number; y: number; front: number }[] = [];
  for (const b of buildings) {
    const horiz = b.front === 0 || b.front === 2;
    const bw = horiz ? b.w : b.d,
      bh = horiz ? b.d : b.w;
    // (u le long de la façade, v en profondeur depuis la façade) -> case
    const cell = (u: number, v: number): [number, number] =>
      b.front === 2 ? [b.x + u, b.y + bh - 1 - v] : b.front === 0 ? [b.x + u, b.y + v] : b.front === 1 ? [b.x + bw - 1 - v, b.y + u] : [b.x + v, b.y + u];
    // arête entre la profondeur v-1 et v (v = 0 : façade, v = d : mur du fond) en position u
    const depthEdge = (u: number, v: number, val: number) => {
      if (b.front === 2) map.setHEdge(b.x + u, b.y + bh - v, val);
      else if (b.front === 0) map.setHEdge(b.x + u, b.y + v, val);
      else if (b.front === 1) map.setVEdge(b.x + bw - v, b.y + u, val);
      else map.setVEdge(b.x + v, b.y + u, val);
    };
    // arête latérale (s = 0 : gauche, 1 : droite) à la profondeur v
    const sideEdge = (s: number, v: number, val: number) => {
      const u = s === 0 ? 0 : b.w;
      if (b.front === 2) map.setVEdge(b.x + u, b.y + bh - 1 - v, val);
      else if (b.front === 0) map.setVEdge(b.x + u, b.y + v, val);
      else if (b.front === 1) map.setHEdge(b.x + bw - 1 - v, b.y + u, val);
      else map.setHEdge(b.x + v, b.y + u, val);
    };
    const floor = b.kind === 'grange' ? T.DIRT : b.kind === 'forge' || b.kind === 'chapelle' || b.kind === 'entrepot' ? T.STONE : T.WOOD;
    for (let v = 0; v < b.d; v++)
      for (let u = 0; u < b.w; u++) {
        const [x, y] = cell(u, v);
        map.set(x, y, floor);
      }
    // porte de façade (+ chemin jusqu'à la rue)
    const du = rng.int(1, b.w - 2);
    depthEdge(du, 0, EDGE.DOOR);
    const [dx, dy] = cell(du, 0);
    doors.push({ x: dx, y: dy, front: b.front });
    const out = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ][b.front];
    for (let k = 1; k <= 4; k++) {
      const x = dx + out[0] * k,
        y = dy + out[1] * k;
      if (!map.inBounds(x, y) || roadDist[y * cols + x] <= 0) break;
      if (G[y * cols + x] === T.GRASS || G[y * cols + x] === T.DIRT) G[y * cols + x] = roadT;
      P.occ[y * cols + x] = 1;
    }
    // cloison : pièce de devant + chambre au fond
    const split = b.kind === 'maison' && b.d >= 6 && b.w >= 4;
    const sv = split ? Math.floor(b.d * 0.55) : b.d;
    if (split) {
      const door = rng.int(1, b.w - 2);
      for (let u = 0; u < b.w; u++) depthEdge(u, sv, u === door ? EDGE.DOOR : EDGE.WALL);
    }
    // porte de derrière
    if (b.d >= 5 && rng.chance(0.25)) depthEdge(rng.int(1, b.w - 2), b.d, EDGE.DOOR);
    // fenêtres
    for (let u = 1; u < b.w - 1; u++) if (Math.abs(u - du) > 1 && rng.chance(0.35)) depthEdge(u, 0, EDGE.WINDOW);
    for (let u = 1; u < b.w - 1; u++) if (rng.chance(0.2)) depthEdge(u, b.d, EDGE.WINDOW);
    for (let s = 0; s < 2; s++) for (let v = 1; v < b.d - 1; v++) if (rng.chance(0.18)) sideEdge(s, v, EDGE.WINDOW);
    // pièces (pour l'aménagement)
    const parts: [number, number, RoomType][] = split
      ? [
          [0, sv, 'cuisine'],
          [sv, b.d, 'chambre'],
        ]
      : [[0, b.d, b.kind]];
    for (const [v0, v1, type] of parts) {
      const id = rooms.length;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (let v = v0; v < v1; v++)
        for (let u = 0; u < b.w; u++) {
          const [x, y] = cell(u, v);
          roomId[y * cols + x] = id;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      rooms.push({ id, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, shape: 'rect', type });
    }
    if (p.names) {
      const [cx0, cy0] = cell(Math.floor(b.w / 2), Math.floor(b.d / 2));
      map.addLabel({ x: cx0 + 0.5, y: cy0 + 0.5, text: rng.pick(NAMES[b.kind]), size: 0.6, gmOnly: true });
    }
  }
  if (p.interiors > 0) {
    const occ = new Uint8Array(N);
    const dresser = new Dresser(map, roomId, occ, rng, p.interiors, p.lights * 0.6);
    for (const r of rooms) dresser.dress(r);
  }
  // les labels ne doivent pas recouvrir les tables : on les laisse au centre (texte MJ discret)

  // --- Place : puits ou fontaine, étals
  P.put(p.town ? 'fountain' : 'well', Math.floor(x0) + (p.town ? 1 : 0.5), Math.floor(y0) + (p.town ? 1 : 0.5), 0, { force: true });
  if (p.town) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      P.put('stall', x0 + Math.cos(a) * (SQ - 1.3), y0 + Math.sin(a) * (SQ - 1.3), k % 2 ? 90 : 0, { force: true });
    }
  }
  P.put('signpost', x0 + SQ + 0.6, y0 + SQ * 0.5, 0, { force: true });

  // --- Éclairage public : lanternes près des portes et le long des rues
  if (p.lights > 0) {
    for (const d of doors) {
      if (!rng.chance(p.lights)) continue;
      const out = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ][d.front];
      const side = d.front % 2 === 0 ? [1, 0] : [0, 1];
      P.put('lantern', d.x + 0.5 + out[0] * 0.8 + side[0] * 0.9, d.y + 0.5 + out[1] * 0.8 + side[1] * 0.9, 0, { force: true, mark: false });
    }
    if (p.town)
      for (const r of roads) {
        const pts = r.pts;
        for (let k = 0; k + 3 < pts.length; k += 2) {
          const len = Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
          const ux = (pts[k + 2] - pts[k]) / (len || 1),
            uy = (pts[k + 3] - pts[k + 1]) / (len || 1);
          for (let s = 4; s < len; s += 8) {
            const off = r.w / 2 + 0.5;
            const x = pts[k] + ux * s - uy * off,
              y = pts[k + 1] + uy * s + ux * off;
            const cx = Math.floor(x),
              cy = Math.floor(y);
            if (!map.inBounds(cx, cy) || map.get(cx, cy) || (riverDist ? riverDist[cy * cols + cx] : 1e9) < RV / 2 + 0.5) continue;
            P.put('lantern', x, y, 0, { force: true, mark: false });
          }
        }
      }
  }

  // --- Enceinte : palissade ou muraille autour des bâtiments, une porte sur chaque route
  if (p.wall && p.wall !== 'none' && buildings.length) {
    let bx0 = Infinity,
      by0 = Infinity,
      bx1 = -Infinity,
      by1 = -Infinity;
    for (const b of buildings) {
      const horiz = b.front === 0 || b.front === 2;
      bx0 = Math.min(bx0, b.x);
      by0 = Math.min(by0, b.y);
      bx1 = Math.max(bx1, b.x + (horiz ? b.w : b.d));
      by1 = Math.max(by1, b.y + (horiz ? b.d : b.w));
    }
    const m = 3;
    const x0 = Math.max(1, Math.floor(bx0) - m) + 0.5,
      y0 = Math.max(1, Math.floor(by0) - m) + 0.5;
    const x1 = Math.min(cols - 2, Math.ceil(bx1) + m - 1) + 0.5,
      y1 = Math.min(rows - 2, Math.ceil(by1) + m - 1) + 0.5;
    const stone = p.wall === 'stone';
    let parts: Rampart[] = [
      { id: uid(), x: x0, y: y0, pts: [0, 0, x1 - x0, 0, x1 - x0, y1 - y0, 0, y1 - y0], closed: true, width: stone ? 1 : 0.6, style: stone ? 'stone' : 'palisade', towers: true },
    ];
    // croisements route / enceinte
    const ring = [x0, y0, x1, y0, x1, y1, x0, y1];
    const hits: [number, number][] = [];
    for (const r of roads)
      for (let k = 0; k + 3 < r.pts.length; k += 2)
        for (let e = 0; e < 4; e++) {
          const ax = ring[e * 2],
            ay = ring[e * 2 + 1],
            bx = ring[((e + 1) % 4) * 2],
            by = ring[((e + 1) % 4) * 2 + 1];
          const px = r.pts[k],
            py = r.pts[k + 1],
            qx = r.pts[k + 2],
            qy = r.pts[k + 3];
          const d = (bx - ax) * (qy - py) - (by - ay) * (qx - px);
          if (Math.abs(d) < 1e-9) continue;
          const t = ((px - ax) * (qy - py) - (py - ay) * (qx - px)) / d;
          const u = ((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / d;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const hx = ax + t * (bx - ax),
            hy = ay + t * (by - ay);
          const corner = Math.min(Math.hypot(hx - x0, hy - y0), Math.hypot(hx - x1, hy - y0), Math.hypot(hx - x1, hy - y1), Math.hypot(hx - x0, hy - y1));
          if (corner > 3 && !hits.some(([x, y]) => Math.hypot(x - hx, y - hy) < 5)) hits.push([hx, hy]);
        }
    for (const [hx, hy] of hits) {
      const r = parts.find((q) => hitRampart(q, hx, hy));
      const cut = r && cutGate(r, hx, hy);
      if (!r || !cut) continue;
      parts = parts.flatMap((q) => (q === r ? cut.parts : [q]));
      map.props.push(cut.gate);
    }
    map.ramparts.push(...parts);
    // pas d'arbres ni de champs sur le tracé
    for (let x = Math.floor(x0) - 1; x <= Math.ceil(x1) + 1; x++)
      for (const yy of [y0, y1])
        for (let dy = -1; dy <= 1; dy++) {
          const cx = x,
            cy = Math.floor(yy) + dy;
          if (map.inBounds(cx, cy)) {
            blocked[cy * cols + cx] = 1;
            P.occ[cy * cols + cx] = 1;
          }
        }
    for (let y = Math.floor(y0) - 1; y <= Math.ceil(y1) + 1; y++)
      for (const xx of [x0, x1])
        for (let dx = -1; dx <= 1; dx++) {
          const cx = Math.floor(xx) + dx,
            cy = y;
          if (map.inBounds(cx, cy)) {
            blocked[cy * cols + cx] = 1;
            P.occ[cy * cols + cx] = 1;
          }
        }
  }

  // --- Champs clôturés (village)
  const nFields = p.town ? 0 : Math.round(p.fields * 6);
  for (let k = 0, tries = 0; k < nFields && tries < 200; tries++) {
    const fw = rng.int(5, 9),
      fh = rng.int(4, 7);
    const fx = rng.int(1, cols - fw - 2),
      fy = rng.int(1, rows - fh - 2);
    let ok = true;
    for (let y = fy - 2; y < fy + fh + 2 && ok; y++)
      for (let x = fx - 2; x < fx + fw + 2; x++) {
        const i = y * cols + x;
        if (!map.inBounds(x, y)) continue;
        if (blocked[i] || P.occ[i] || map.get(x, y) || roadDist[i] < 1.5) {
          ok = false;
          break;
        }
      }
    if (!ok) continue;
    k++;
    for (let y = fy; y < fy + fh; y++)
      for (let x = fx; x < fx + fw; x++) {
        G[y * cols + x] = T.FIELD;
        blocked[y * cols + x] = 1;
        P.occ[y * cols + x] = 1;
      }
    // clôture par segments de 2 cases, avec une barrière ouverte
    const gate = rng.int(0, 3);
    for (let x = fx; x + 2 <= fx + fw; x += 2) {
      if (gate !== 0 || x !== fx + 2) P.put('fence', x + 1, fy - 0.2, 0, { force: true, mark: false });
      if (gate !== 2 || x !== fx + 2) P.put('fence', x + 1, fy + fh + 0.2, 0, { force: true, mark: false });
    }
    for (let y = fy; y + 2 <= fy + fh; y += 2) {
      if (gate !== 3 || y !== fy) P.put('fence', fx - 0.2, y + 1, 90, { force: true, mark: false });
      if (gate !== 1 || y !== fy) P.put('fence', fx + fw + 0.2, y + 1, 90, { force: true, mark: false });
    }
    if (rng.chance(0.5)) P.put('haystack', fx - 1.5, fy + 0.5, 0);
  }

  // --- Abords des bâtiments : tonneaux, caisses, charrettes, fleurs
  for (const b of buildings) {
    const horiz = b.front === 0 || b.front === 2;
    const bw = horiz ? b.w : b.d,
      bh = horiz ? b.d : b.w;
    const n = b.kind === 'grange' || b.kind === 'entrepot' || b.kind === 'forge' ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const side = rng.int(0, 3);
      const t = rng.float(0.2, 0.8);
      const kind = b.kind === 'grange' ? rng.pick(['haystack', 'cart', 'barrel']) : rng.pick(['barrel', 'crate', 'flowers', 'bush']);
      // objet adossé au mur, grand côté parallèle au mur
      const cart = kind === 'cart';
      const off = cart ? 0.9 : 0.5;
      const x = side === 1 ? b.x + bw + off : side === 3 ? b.x - off : Math.floor(b.x + t * bw) + 0.5;
      const y = side === 0 ? b.y - off : side === 2 ? b.y + bh + off : Math.floor(b.y + t * bh) + 0.5;
      P.put(kind, x, y, cart ? (side % 2 ? 0 : 90) : rng.int(0, 3) * 90);
    }
  }

  // --- Toits : un par bâtiment, léger débord pour couvrir les murs
  if (p.roofs)
    for (const b of buildings) {
      const horiz = b.front === 0 || b.front === 2;
      const bw = horiz ? b.w : b.d,
        bh = horiz ? b.d : b.w;
      const kind = roofKind(b.kind, p.town, rng);
      map.props.push({ id: uid(), kind, x: b.x + bw / 2, y: b.y + bh / 2, w: bw + 0.3, h: bh + 0.3, rot: 0, gmOnly: false });
    }

  // --- Arbres et buissons sur l'herbe libre (plus denses vers les bords)
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (P.occ[i] || blocked[i] || map.get(x, y) || roadDist[i] < 1.5) continue;
      const edge = Math.min(x, y, cols - 1 - x, rows - 1 - y);
      const pr = p.trees * (edge < 4 ? 0.12 : 0.03);
      const r = rng.next();
      if (r < pr) {
        const size = rng.float(1.6, 2.6);
        P.put(rng.chance(0.25) ? 'pine' : 'tree', x + 0.5, y + 0.5, rng.int(0, 23) * 15, { w: size, h: size, force: true, mark: false });
        P.block(x, y);
      } else if (r < pr + 0.015 * p.trees) P.put(rng.chance(0.6) ? 'bush' : 'flowers', x + 0.5, y + 0.5, 0);
    }

  map.settings.wallStyle = 'straight';
  map.touchAll();
  return map;
}
