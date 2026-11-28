// Plan de ville (1 case = 5 m) : cité fortifiée en quartiers, ou bourg rural le long des routes.
// Rivière et ponts, place du marché, cathédrale, château, îlots bâtis autour de cours,
// faubourgs, champs et bois alentour.
import { DungeonMap, Rampart, T } from '../model';
import { cutGate, hitRampart } from '../ramparts';
import { Rng, fbm, hashString, uid } from '../util';
import { Placer, distField, wobblyLine } from './outdoor';

export interface CityParams {
  cols: number;
  rows: number;
  seed: string;
  size: 'bourg' | 'ville' | 'cite';
  walls: boolean;
  river: boolean;
  castle: boolean;
  districts: number;
  density: number;
  countryside: number;
  names: boolean;
}

export const DEFAULT_CITY: CityParams = {
  cols: 140,
  rows: 100,
  seed: 'cynstefistone',
  size: 'cite',
  walls: true,
  river: true,
  castle: true,
  districts: 14,
  density: 0.8,
  countryside: 0.6,
  names: true,
};

const DISTRICT_NAMES = ['Quartier des Tanneurs', 'Les Halles', 'Bourg-Neuf', 'Quartier du Temple', 'La Basse-Cour', 'Les Forges', 'Quartier des Marchands', 'Le Vieux-Port', 'Les Jardins', 'La Butte', 'Quartier des Lices', 'Le Pré-aux-Clercs'];
const CITY_NAMES = ['Cynstefistone', 'Valombre', 'Hautepierre', 'Mirefleur', 'Port-Ardent', 'Corbelac', 'Aubeterre', 'Rochebrune'];

function inPoly(poly: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i],
      yi = poly[i + 1],
      xj = poly[j],
      yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function roofFor(rng: Rng, rich: boolean): string {
  return rich ? rng.pick(['roofTiles', 'roofTiles', 'roofSlate']) : rng.pick(['roofTiles', 'roofShingle', 'roofThatch', 'roofTiles']);
}

export function generateCity(p: CityParams): DungeonMap {
  const rng = new Rng(hashString(p.seed || 'cite'));
  const seedN = hashString(p.seed) % 997;
  const { cols, rows } = p;
  const N = cols * rows;
  const map = new DungeonMap(cols, rows);
  map.name = rng.pick(CITY_NAMES);
  map.settings.gridDistance = 5;
  map.settings.gridUnits = 'm';
  map.settings.showGrid = false;
  map.settings.theme = 'pleinair';
  map.settings.darkness = 0;
  const G = map.ground;
  const P = new Placer(map, rng);
  const busy = new Uint8Array(N); // routes, eau, bâti
  const at = (x: number, y: number) => y * cols + x;

  // --- Terrain : prés, quelques taches de terre
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const n = fbm(x * 0.05, y * 0.05, 3, seedN);
      G[at(x, y)] = n > 0.68 ? T.DIRT : T.GRASS;
    }

  const cx = cols * rng.float(0.45, 0.55),
    cy = rows * rng.float(0.45, 0.55);
  const big = p.size === 'cite' ? 1 : p.size === 'ville' ? 0.75 : 0.5;
  const R = Math.min(cols, rows) * 0.36 * big;

  // --- Contour de la ville
  const poly: number[] = [];
  const nv = 14;
  for (let k = 0; k < nv; k++) {
    const a = (k / nv) * Math.PI * 2 + rng.float(-0.12, 0.12);
    const r = R * rng.float(0.82, 1.12) * (1 + 0.15 * Math.cos(a * 2 + seedN));
    poly.push(cx + Math.cos(a) * r * 1.15, cy + Math.sin(a) * r * 0.95);
  }
  const inside = new Uint8Array(N);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (inPoly(poly, x + 0.5, y + 0.5)) inside[at(x, y)] = 1;

  // --- Rivière
  let river: Float32Array | null = null;
  if (p.river) {
    const vertical = rng.chance(0.5);
    const off = rng.float(-0.15, 0.15);
    const pts = vertical
      ? wobblyLine(rng, cx + off * cols, -2, cx + rng.float(-0.25, 0.25) * cols, rows + 2, 8, 4)
      : wobblyLine(rng, -2, cy + off * rows, cols + 2, cy + rng.float(-0.25, 0.25) * rows, 8, 4);
    river = distField(cols, rows, pts, 6);
    for (let i = 0; i < N; i++) {
      if (river[i] <= 1.6) {
        G[i] = river[i] <= 0.8 ? T.DEEP : T.WATER;
        busy[i] = 1;
      } else if (river[i] <= 2.3 && !inside[i]) G[i] = T.SAND;
    }
  }

  // --- Routes principales : du centre vers les portes et au-delà
  const roads: number[][] = [];
  const nRoads = p.size === 'bourg' ? 3 : rng.int(3, 4);
  const a0 = rng.float(0, Math.PI * 2);
  for (let k = 0; k < nRoads; k++) {
    const a = a0 + (k / nRoads) * Math.PI * 2 + rng.float(-0.3, 0.3);
    const L = Math.max(cols, rows);
    roads.push(wobblyLine(rng, cx, cy, cx + Math.cos(a) * L, cy + Math.sin(a) * L, p.size === 'bourg' ? 5 : 3, 3));
  }
  const roadD = new Float32Array(N).fill(1e9);
  for (const r of roads) distField(cols, rows, r, 4, roadD);
  const paint = (i: number, t: number) => {
    if (G[i] === T.DEEP || G[i] === T.WATER) return;
    G[i] = t;
    busy[i] = 1;
  };
  for (let i = 0; i < N; i++) if (roadD[i] <= (inside[i] ? 1.3 : 0.9)) paint(i, inside[i] && p.size !== 'bourg' ? T.ROAD : T.PATH);

  // --- Place centrale
  const SQ = p.size === 'bourg' ? 3 : 5;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < SQ) paint(at(x, y), p.size === 'bourg' ? T.PATH : T.ROAD);
  P.put(p.size === 'bourg' ? 'well' : 'fountain', cx, cy, 0, { w: p.size === 'bourg' ? 1 : 2, h: p.size === 'bourg' ? 1 : 2, force: true });
  for (let k = 0; k < (p.size === 'bourg' ? 2 : 5); k++) {
    const a = rng.float(0, Math.PI * 2),
      d = rng.float(2, SQ - 1);
    P.put('stall', cx + Math.cos(a) * d, cy + Math.sin(a) * d, rng.int(0, 3) * 90, { w: 1.4, h: 1.1 });
  }

  // --- Quartiers (cellules de Voronoï) et rues
  const wards: { x: number; y: number; name: string }[] = [];
  const ward = new Int16Array(N).fill(-1);
  if (p.size !== 'bourg') {
    const nw = Math.max(4, Math.round(p.districts * big));
    for (let k = 0, tries = 0; k < nw && tries < 2000; tries++) {
      const a = rng.float(0, Math.PI * 2),
        d = R * Math.sqrt(rng.next()) * 0.95;
      const x = cx + Math.cos(a) * d * 1.15,
        y = cy + Math.sin(a) * d * 0.95;
      if (!inPoly(poly, x, y) || wards.some((w) => Math.hypot(w.x - x, w.y - y) < R * 0.28)) continue;
      wards.push({ x, y, name: DISTRICT_NAMES[k % DISTRICT_NAMES.length] });
      k++;
    }
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = at(x, y);
        if (!inside[i]) continue;
        let best = -1,
          bd = Infinity;
        // distance légèrement bruitée : rues moins rectilignes
        const jit = (fbm(x * 0.15, y * 0.15, 2, seedN + 7) - 0.5) * 3;
        wards.forEach((w, k) => {
          const d = Math.hypot(w.x - x, w.y - y) + jit * (k % 2 ? 1 : -1);
          if (d < bd) {
            bd = d;
            best = k;
          }
        });
        ward[i] = best;
      }
    for (let y = 1; y < rows - 1; y++)
      for (let x = 1; x < cols - 1; x++) {
        const i = at(x, y);
        if (ward[i] < 0) continue;
        if (ward[at(x + 1, y)] !== ward[i] || ward[at(x, y + 1)] !== ward[i]) paint(i, T.ROAD);
      }
  }

  // --- Îlots : parcelles bâties le long des rues, cours au milieu
  const streetD = new Float32Array(N).fill(1e9);
  {
    // distance (en cases) à la rue la plus proche, par passes successives
    const q: number[] = [];
    for (let i = 0; i < N; i++)
      if (busy[i] && (G[i] === T.ROAD || G[i] === T.PATH)) {
        streetD[i] = 0;
        q.push(i);
      }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % cols,
        y = (i / cols) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = at(nx, ny);
        if (streetD[j] <= streetD[i] + 1) continue;
        streetD[j] = streetD[i] + 1;
        q.push(j);
      }
    }
  }
  const lotOk = (x0: number, y0: number, w: number, h: number, zone: (i: number) => boolean) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        if (x < 1 || y < 1 || x >= cols - 1 || y >= rows - 1) return false;
        const i = at(x, y);
        if (busy[i] || !zone(i)) return false;
      }
    return true;
  };
  const build = (x0: number, y0: number, w: number, h: number, kind: string) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) busy[at(x, y)] = 1;
    map.props.push({ id: uid(), kind, x: x0 + w / 2, y: y0 + h / 2, w: w - 0.1, h: h - 0.1, rot: 0, gmOnly: false });
  };

  // monuments : cathédrale près de la place, château sur le pourtour
  const landmark = (w: number, h: number, near: [number, number], kind: string, label: string) => {
    for (let r = 0; r < 25; r++)
      for (let k = 0; k < 40; k++) {
        const x = Math.round(near[0] + rng.float(-r, r) - w / 2),
          y = Math.round(near[1] + rng.float(-r, r) - h / 2);
        if (lotOk(x, y, w, h, (i) => inside[i] === 1 || p.size === 'bourg')) {
          build(x, y, w, h, kind);
          if (p.names) map.addLabel({ x: x + w / 2, y: y + h + 0.8, text: label, size: 1.1, gmOnly: false });
          return [x, y] as [number, number];
        }
      }
    return null;
  };
  if (p.size !== 'bourg') {
    const a = rng.float(0, Math.PI * 2);
    landmark(5, 9, [cx + Math.cos(a) * (SQ + 5), cy + Math.sin(a) * (SQ + 5)], 'roofSlate', 'Cathédrale');
  } else landmark(3, 5, [cx + SQ + 3, cy], 'roofSlate', 'Chapelle');

  if (p.castle && p.size !== 'bourg') {
    // donjon carré entouré d'une enceinte, sur le bord de la ville
    const a = rng.float(0, Math.PI * 2);
    const kx = cx + Math.cos(a) * R * 0.75,
      ky = cy + Math.sin(a) * R * 0.62;
    const S = 9;
    let x0 = Math.round(kx - S / 2),
      y0 = Math.round(ky - S / 2);
    // cherche une place libre autour du point visé
    let found = lotOk(x0, y0, S, S, () => true);
    for (let r = 1; r < 14 && !found; r++)
      for (let k = 0; k < 16 && !found; k++) {
        const nx = x0 + rng.int(-r, r),
          ny = y0 + rng.int(-r, r);
        if (lotOk(nx, ny, S, S, () => true)) {
          x0 = nx;
          y0 = ny;
          found = true;
        }
      }
    if (found) {
      for (let y = y0; y < y0 + S; y++) for (let x = x0; x < x0 + S; x++) {
        busy[at(x, y)] = 1;
        G[at(x, y)] = T.ROCKY;
      }
      map.ramparts.push({ id: uid(), x: x0 + 0.5, y: y0 + 0.5, pts: [0, 0, S - 1, 0, S - 1, S - 1, 0, S - 1], closed: true, width: 0.8, style: 'stone', towers: true });
      map.props.push({ id: uid(), kind: 'roofSlate', x: x0 + S / 2, y: y0 + S / 2, w: 4, h: 4, rot: 0, gmOnly: false });
      if (p.names) map.addLabel({ x: x0 + S / 2, y: y0 + S + 1, text: 'Château', size: 1.1, gmOnly: false });
    }
  }

  // maisons : parcelles accolées le long des rues
  const zone = (i: number) => (p.size === 'bourg' ? roadD[i] < 4.5 && Math.hypot((i % cols) - cx, ((i / cols) | 0) - cy) < R * 1.6 : inside[i] === 1);
  const depth = p.size === 'bourg' ? 2 : 3;
  const order: number[] = [];
  for (let i = 0; i < N; i++) if (streetD[i] === 1 && zone(i)) order.push(i);
  rng.shuffle(order);
  for (const i of order) {
    if (busy[i] || !rng.chance(0.5 + 0.5 * p.density)) continue;
    const x = i % cols,
      y = (i / cols) | 0;
    // la façade donne sur la rue : la parcelle s'étend vers l'intérieur de l'îlot
    let dx = 0,
      dy = 0;
    if (streetD[at(x - 1, y)] === 0) dx = 1;
    else if (streetD[at(x + 1, y)] === 0) dx = -1;
    else if (streetD[at(x, y - 1)] === 0) dy = 1;
    else if (streetD[at(x, y + 1)] === 0) dy = -1;
    else continue;
    const fw = rng.int(2, p.size === 'bourg' ? 2 : 3),
      dd = rng.int(depth - (p.size === 'bourg' ? 0 : 1), depth);
    const w = dx ? dd : fw,
      h = dx ? fw : dd;
    const x0 = dx < 0 ? x - w + 1 : dx > 0 ? x : x - Math.floor(fw / 2);
    const y0 = dy < 0 ? y - h + 1 : dy > 0 ? y : y - Math.floor(fw / 2);
    if (lotOk(x0, y0, w, h, zone)) build(x0, y0, w, h, roofFor(rng, p.size === 'cite'));
  }
  // second passage : on comble les parcelles restantes en bord de rue
  for (const i of order) {
    if (busy[i]) continue;
    const x = i % cols,
      y = (i / cols) | 0;
    for (const [w, h] of [
      [2, 2],
      [2, 1],
      [1, 2],
    ])
      if (lotOk(x, y, w, h, zone)) {
        build(x, y, w, h, roofFor(rng, p.size === 'cite'));
        break;
      }
  }
  // cours et jardins au cœur des îlots
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = at(x, y);
      if (busy[i] || !inside[i] || p.size === 'bourg') continue;
      if (streetD[i] >= 3) {
        G[i] = T.GRASS;
        if (rng.chance(0.04)) P.put('tree', x + 0.5, y + 0.5, rng.int(0, 23) * 15, { w: 1.3, h: 1.3 });
      } else if (rng.chance(0.3 * p.density)) {
        // petites dépendances en second rang
        if (lotOk(x, y, 2, 2, zone)) build(x, y, 2, 2, roofFor(rng, false));
      }
    }

  // --- Remparts sur le contour, une porte par route
  if (p.walls && p.size !== 'bourg') {
    const pts: number[] = [];
    for (let k = 0; k < poly.length; k += 2) pts.push(poly[k] - poly[0], poly[k + 1] - poly[1]);
    let parts: Rampart[] = [{ id: uid(), x: poly[0], y: poly[1], pts, closed: true, width: 1, style: 'stone', towers: true }];
    for (const r of roads) {
      // premier point de la route hors de la ville
      for (let k = 0; k + 3 < r.length; k += 2) {
        if (inPoly(poly, r[k], r[k + 1]) && !inPoly(poly, r[k + 2], r[k + 3])) {
          const hx = (r[k] + r[k + 2]) / 2,
            hy = (r[k + 1] + r[k + 3]) / 2;
          const part = parts.find((q) => hitRampart(q, hx, hy));
          const cut = part && cutGate(part, hx, hy);
          if (part && cut) {
            parts = parts.flatMap((q) => (q === part ? cut.parts : [q]));
            map.props.push(cut.gate);
          }
          break;
        }
      }
    }
    map.ramparts.push(...parts);
  }

  // --- Ponts
  if (river)
    for (const r of roads) {
      let sx = 0,
        sy = 0,
        n = 0,
        ang = 0;
      for (let k = 0; k + 3 < r.length; k += 2) {
        const mx = Math.floor((r[k] + r[k + 2]) / 2),
          my = Math.floor((r[k + 1] + r[k + 3]) / 2);
        if (mx < 0 || my < 0 || mx >= cols || my >= rows) continue;
        if (river[at(mx, my)] <= 1.8) {
          sx += (r[k] + r[k + 2]) / 2;
          sy += (r[k + 1] + r[k + 3]) / 2;
          n++;
          ang = Math.atan2(r[k + 3] - r[k + 1], r[k + 2] - r[k]);
        }
      }
      if (n) P.put('bridge', sx / n, sy / n, Math.round(((ang * 180) / Math.PI - 90 + 360) % 360), { w: 2.2, h: 5, force: true });
    }

  // --- Campagne : champs le long des routes, bosquets, fermes isolées
  const outside = (x: number, y: number) => !inside[at(x, y)] && Math.hypot(x - cx, y - cy) > R * (p.size === 'bourg' ? 1.3 : 1.15);
  if (p.countryside > 0) {
    for (let k = 0; k < Math.round(120 * p.countryside); k++) {
      const x0 = rng.int(1, cols - 10),
        y0 = rng.int(1, rows - 8);
      const w = rng.int(5, 10),
        h = rng.int(4, 8);
      let ok = true;
      for (let y = y0; y < y0 + h && ok; y++) for (let x = x0; x < x0 + w; x++) if (busy[at(x, y)] || !outside(x, y) || roadD[at(x, y)] > 16) ok = false;
      if (!ok) continue;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        G[at(x, y)] = T.FIELD;
        busy[at(x, y)] = 1;
      }
    }
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = at(x, y);
        if (busy[i] || !outside(x, y)) continue;
        const f = fbm(x * 0.07, y * 0.07, 3, seedN + 3);
        if (f > 0.66 - 0.1 * p.countryside) {
          G[i] = T.FOREST;
          if (rng.chance(0.22)) P.put(rng.chance(0.3) ? 'pine' : 'tree', x + 0.5, y + 0.5, rng.int(0, 23) * 15, { w: 1.4, h: 1.4, force: true, mark: false });
        }
      }
    for (let k = 0; k < Math.round(8 * p.countryside); k++) {
      const x = rng.int(2, cols - 4),
        y = rng.int(2, rows - 4);
      if (outside(x, y) && roadD[at(x, y)] < 6 && lotOk(x, y, 2, 3, () => true)) build(x, y, 2, 3, 'roofThatch');
    }
  }

  // --- Noms
  if (p.names) {
    map.addLabel({ x: cx, y: Math.max(2, cy - R - 3), text: map.name, size: 2.4, gmOnly: false });
    for (const w of wards) if (rng.chance(0.5)) map.addLabel({ x: w.x, y: w.y, text: w.name, size: 0.9, gmOnly: false });
  }
  map.touchAll();
  return map;
}
