import { DungeonMap, EDGE, T } from '../model';
import { Rng, hashString } from '../util';
import { Dresser, Flavor, RoomInfo, RoomType, Shape, pickRoomType } from './dressing';

export interface DungeonParams {
  cols: number;
  rows: number;
  seed: string;
  layout: 'scatter' | 'bsp';
  rooms: number;
  roomMin: number;
  roomMax: number;
  corridorWidth: number;
  loops: number;
  doors: number;
  secret: number;
  water: number;
  roundRooms: number;
  props: number;
  lights: number;
  flavor: Flavor;
  numbers: boolean;
}

export const DEFAULT_DUNGEON: DungeonParams = {
  cols: 50,
  rows: 38,
  seed: 'crypte-1234',
  layout: 'scatter',
  rooms: 12,
  roomMin: 4,
  roomMax: 9,
  corridorWidth: 1,
  loops: 0.3,
  doors: 0.75,
  secret: 0.12,
  water: 0.15,
  roundRooms: 0.15,
  props: 0.7,
  lights: 0.6,
  flavor: 'mixte',
  numbers: true,
};

// ---------- Tas binaire (A*) ----------

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(v: number, k: number): void {
    const keys = this.keys,
      vals = this.vals;
    let i = keys.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }
  pop(): number {
    const keys = this.keys,
      vals = this.vals;
    const top = vals[0];
    const lk = keys.pop()!,
      lv = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lk) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = lk;
      vals[i] = lv;
    }
    return top;
  }
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

interface Room extends RoomInfo {
  cx: number;
  cy: number;
}

export function generateDungeon(p: DungeonParams): DungeonMap {
  const rng = new Rng(hashString(p.seed || 'donjon'));
  const { cols, rows } = p;
  const map = new DungeonMap(cols, rows);
  map.name = 'Donjon ' + p.seed;
  const roomId = new Int16Array(cols * rows).fill(-1);
  const corridor = new Uint8Array(cols * rows);
  const rooms: Room[] = [];
  const minS = Math.max(3, Math.min(p.roomMin, p.roomMax));
  const maxS = Math.max(minS, p.roomMax);

  // --- Placement des salles
  const addRoom = (x: number, y: number, w: number, h: number) => {
    let shape: Shape = 'rect';
    if (Math.min(w, h) >= 5 && rng.chance(p.roundRooms)) shape = 'round';
    else if (w >= 7 && h >= 7 && rng.chance(0.12)) shape = 'cross';
    else if (w >= 6 && h >= 6 && rng.chance(0.18)) shape = 'pillared';
    rooms.push({ id: rooms.length, x, y, w, h, shape, type: 'vide', cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2) });
  };

  if (p.layout === 'bsp') {
    const leaves: [number, number, number, number][] = [];
    const minLeaf = minS + 3;
    const split = (x: number, y: number, w: number, h: number, depth: number) => {
      const canH = h >= minLeaf * 2,
        canV = w >= minLeaf * 2;
      const bigEnough = w <= maxS + 4 && h <= maxS + 4;
      if ((!canH && !canV) || depth > 8 || (bigEnough && rng.chance(0.35))) {
        leaves.push([x, y, w, h]);
        return;
      }
      let horiz = canH && (!canV || h > w * 1.2 || (w <= h * 1.2 && rng.chance(0.5)));
      if (horiz) {
        const s = rng.int(minLeaf, h - minLeaf);
        split(x, y, w, s, depth + 1);
        split(x, y + s, w, h - s, depth + 1);
      } else {
        const s = rng.int(minLeaf, w - minLeaf);
        split(x, y, s, h, depth + 1);
        split(x + s, y, w - s, h, depth + 1);
      }
    };
    split(1, 1, cols - 2, rows - 2, 0);
    rng.shuffle(leaves);
    for (const [lx, ly, lw, lh] of leaves) {
      if (rooms.length >= p.rooms) break;
      const w = rng.int(minS, Math.max(minS, Math.min(maxS, lw - 3)));
      const h = rng.int(minS, Math.max(minS, Math.min(maxS, lh - 3)));
      if (w > lw - 2 || h > lh - 2) continue;
      const x = lx + rng.int(1, Math.max(1, lw - w - 1));
      const y = ly + rng.int(1, Math.max(1, lh - h - 1));
      addRoom(x, y, w, h);
    }
  } else {
    let attempts = p.rooms * 60;
    while (rooms.length < p.rooms && attempts-- > 0) {
      const w = rng.int(minS, maxS);
      const h = rng.int(minS, maxS);
      if (w > cols - 4 || h > rows - 4) continue;
      const x = rng.int(2, cols - w - 2);
      const y = rng.int(2, rows - h - 2);
      let ok = true;
      for (const r of rooms) {
        if (x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y) {
          ok = false;
          break;
        }
      }
      if (ok) addRoom(x, y, w, h);
    }
  }
  if (!rooms.length) addRoom(Math.floor(cols / 2) - 3, Math.floor(rows / 2) - 3, 6, 6);

  // --- Types de salles et sols
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    r.type = i === 0 ? 'vide' : pickRoomType(rng, p.flavor);
  }
  const floorFor = (t: RoomType): number => {
    if ((t === 'bibliotheque' || t === 'caserne' || t === 'cuisine') && rng.chance(0.55)) return T.WOOD;
    if ((t === 'temple' || t === 'trone' || t === 'fontaine') && rng.chance(0.55)) return T.TILES;
    if (t === 'repaire' && rng.chance(0.5)) return T.DIRT;
    return T.STONE;
  };

  // --- Creusage des salles
  for (const r of rooms) {
    const terrain = floorFor(r.type);
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        let inside = true;
        if (r.shape === 'round') {
          const dx = (x + 0.5 - (r.x + r.w / 2)) / (r.w / 2);
          const dy = (y + 0.5 - (r.y + r.h / 2)) / (r.h / 2);
          inside = dx * dx + dy * dy <= 1.08;
        } else if (r.shape === 'cross') {
          const cw = Math.floor(r.w / 3),
            ch = Math.floor(r.h / 3);
          const inX = x >= r.x + cw && x < r.x + r.w - cw;
          const inY = y >= r.y + ch && y < r.y + r.h - ch;
          inside = inX || inY;
        }
        if (inside) {
          map.set(x, y, terrain);
          roomId[y * cols + x] = r.id;
        }
      }
    if (roomId[r.cy * cols + r.cx] !== r.id) {
      // centre hors forme (rare) : prend la première case de la salle
      for (let i = 0; i < roomId.length; i++)
        if (roomId[i] === r.id) {
          r.cx = i % cols;
          r.cy = (i / cols) | 0;
          break;
        }
    }
  }

  // --- Graphe de connexions : arbre couvrant minimal + boucles
  const n = rooms.length;
  const dist = (a: Room, b: Room) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
  const edges: [number, number][] = [];
  const inTree = new Uint8Array(n);
  inTree[0] = 1;
  for (let k = 1; k < n; k++) {
    let best = Infinity,
      bi = -1,
      bj = -1;
    for (let i = 0; i < n; i++) {
      if (!inTree[i]) continue;
      for (let j = 0; j < n; j++) {
        if (inTree[j]) continue;
        const d = dist(rooms[i], rooms[j]);
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    inTree[bj] = 1;
    edges.push([bi, bj]);
  }
  const has = (a: number, b: number) => edges.some(([i, j]) => (i === a && j === b) || (i === b && j === a));
  for (let i = 0; i < n; i++) {
    const near = rooms
      .map((r, j) => [j, dist(rooms[i], r)] as [number, number])
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3);
    for (const [j] of near) if (!has(i, j) && rng.chance(p.loops * 0.5)) edges.push([i, j]);
  }

  // --- Couloirs (A* avec pénalité de virage, réutilise les couloirs existants)
  const W = Math.max(1, Math.min(3, p.corridorWidth));
  const carve = (x: number, y: number) => {
    for (let dy = 0; dy < W; dy++)
      for (let dx = 0; dx < W; dx++) {
        const cx = x + dx,
          cy = y + dy;
        if (cx < 1 || cy < 1 || cx >= cols - 1 || cy >= rows - 1) continue;
        const i = cy * cols + cx;
        if (roomId[i] >= 0) continue;
        if (!map.get(cx, cy)) map.set(cx, cy, T.STONE);
        corridor[i] = 1;
      }
  };
  const nearOtherRoom = (x: number, y: number, a: number, b: number) => {
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d],
        ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const id = roomId[ny * cols + nx];
      if (id >= 0 && id !== a && id !== b) return true;
    }
    return false;
  };
  const N = cols * rows;
  const gScore = new Float64Array(N * 4);
  const came = new Int32Array(N * 4);
  for (const [ai, bi] of edges) {
    const a = rooms[ai],
      b = rooms[bi];
    gScore.fill(Infinity);
    came.fill(-1);
    const heap = new MinHeap();
    const start = a.cy * cols + a.cx;
    const goal = b.cy * cols + b.cx;
    for (let d = 0; d < 4; d++) {
      gScore[start * 4 + d] = 0;
      heap.push(start * 4 + d, 0);
    }
    let end = -1;
    while (heap.size) {
      const s = heap.pop();
      const cell = s >> 2,
        dir = s & 3;
      if (cell === goal) {
        end = s;
        break;
      }
      const g = gScore[s];
      const x = cell % cols,
        y = (cell / cols) | 0;
      for (let d = 0; d < 4; d++) {
        if (d === ((dir + 2) & 3)) continue;
        const nx = x + DX[d],
          ny = y + DY[d];
        if (nx < 1 || ny < 1 || nx >= cols - W || ny >= rows - W) continue;
        const ni = ny * cols + nx;
        const rid = roomId[ni];
        let cost: number;
        if (rid === a.id || rid === b.id) cost = 1;
        else if (rid >= 0) cost = 25;
        else if (corridor[ni]) cost = 1.2;
        else cost = 3;
        if (rid < 0 && nearOtherRoom(nx, ny, a.id, b.id)) cost += 8;
        if (d !== dir) cost += 4;
        const ng = g + cost;
        const ns = ni * 4 + d;
        if (ng < gScore[ns]) {
          gScore[ns] = ng;
          came[ns] = s;
          heap.push(ns, ng + Math.abs(nx - b.cx) + Math.abs(ny - b.cy));
        }
      }
    }
    for (let s = end; s >= 0; s = came[s]) {
      const cell = s >> 2;
      carve(cell % cols, (cell / cols) | 0);
    }
  }

  // --- Portes aux entrées des salles
  const doorType = () => (rng.chance(p.secret) ? EDGE.SECRET : rng.chance(0.18) ? EDGE.LOCKED : EDGE.DOOR);
  for (const r of rooms) {
    // ouvertures par côté : collecte des arêtes salle -> extérieur
    const groups = new Map<string, { edges: [boolean, number, number][]; }>();
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        if (roomId[y * cols + x] !== r.id) continue;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d],
            ny = y + DY[d];
          if (!map.get(nx, ny) || roomId[ny * cols + nx] === r.id) continue;
          // arête : horizontale (d = 1 ou 3) ou verticale (d = 0 ou 2)
          let e: [boolean, number, number];
          if (d === 0) e = [false, x + 1, y];
          else if (d === 2) e = [false, x, y];
          else if (d === 1) e = [true, x, y + 1];
          else e = [true, x, y];
          const line = e[0] ? `h${e[2]}` : `v${e[1]}`;
          if (!groups.has(line)) groups.set(line, { edges: [] });
          groups.get(line)!.edges.push(e);
        }
      }
    for (const g of groups.values()) {
      // découpe en segments contigus
      const es = g.edges.sort((a, b) => (a[0] ? a[1] - b[1] : a[2] - b[2]));
      let run: [boolean, number, number][] = [];
      const flush = () => {
        if (run.length && run.length <= W && rng.chance(p.doors)) {
          const t = doorType();
          for (const [h, x, y] of run) {
            if (h) map.setHEdge(x, y, t);
            else map.setVEdge(x, y, t);
          }
        }
        run = [];
      };
      for (const e of es) {
        const prev = run[run.length - 1];
        if (prev && (e[0] ? e[1] - prev[1] : e[2] - prev[2]) !== 1) flush();
        run.push(e);
      }
      flush();
    }
  }

  // --- Eau
  for (const r of rooms) {
    if (r.type === 'bibliotheque' || r.type === 'tresor' || !rng.chance(p.water)) continue;
    if (r.w >= 6 && r.h >= 6 && rng.chance(0.7)) {
      const rx = r.w / 2 - 1.6,
        ry = r.h / 2 - 1.6;
      const cx = r.x + r.w / 2,
        cy = r.y + r.h / 2;
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          if (roomId[y * cols + x] !== r.id) continue;
          const dx = (x + 0.5 - cx) / rx,
            dy = (y + 0.5 - cy) / ry;
          const d = dx * dx + dy * dy;
          if (d <= 0.35 && rx > 2 && ry > 2) map.set(x, y, T.DEEP);
          else if (d <= 1) map.set(x, y, T.WATER);
        }
      r.type = 'vide';
    } else {
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) if (roomId[y * cols + x] === r.id && rng.chance(0.85)) map.set(x, y, T.WATER);
    }
  }

  // --- Ordre de visite (BFS depuis l'entrée) pour la numérotation
  const adj: number[][] = rooms.map(() => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const order: number[] = [];
  const depth = new Int32Array(n).fill(-1);
  depth[0] = 0;
  const queue = [0];
  while (queue.length) {
    const i = queue.shift()!;
    order.push(i);
    for (const j of adj[i].sort((a, b) => dist(rooms[i], rooms[a]) - dist(rooms[i], rooms[b])))
      if (depth[j] < 0) {
        depth[j] = depth[i] + 1;
        queue.push(j);
      }
  }
  for (let i = 0; i < n; i++) if (depth[i] < 0) order.push(i);

  // --- Aménagement
  const occ = new Uint8Array(cols * rows);
  for (let i = 0; i < occ.length; i++) {
    const t = map.cells[i];
    if (t === T.WATER || t === T.DEEP) occ[i] = 1;
  }
  const dresser = new Dresser(map, roomId, occ, rng, p.props, p.lights);
  const entrance = rooms[0];
  let far = 0;
  for (let i = 0; i < n; i++) if (depth[i] > depth[far]) far = i;
  for (const r of [entrance, ...(far !== 0 ? [rooms[far]] : [])]) {
    const spots = rng.shuffle(dresser.wallSpots(r));
    for (const s of spots) if (dresser.placeAgainst(r, 'stairs', s.x, s.y, s.side)) break;
  }
  if (p.props > 0) for (const r of rooms) dresser.dress(r);

  // --- Numéros de salles (MJ)
  if (p.numbers) {
    order.forEach((ri, k) => {
      const r = rooms[ri];
      let lx = r.x + r.w / 2,
        ly = r.y + r.h / 2;
      // évite de recouvrir un objet central
      const blocked = (x: number, y: number) => occ[Math.floor(y) * cols + Math.floor(x)] === 1 || roomId[Math.floor(y) * cols + Math.floor(x)] !== r.id;
      if (blocked(lx, ly)) {
        outer: for (let rad = 1; rad < Math.max(r.w, r.h); rad++)
          for (let dy = -rad; dy <= rad; dy++)
            for (let dx = -rad; dx <= rad; dx++) {
              const x = Math.floor(r.x + r.w / 2) + dx,
                y = Math.floor(r.y + r.h / 2) + dy;
              if (map.inBounds(x, y) && !blocked(x + 0.5, y + 0.5)) {
                lx = x + 0.5;
                ly = y + 0.5;
                break outer;
              }
            }
      }
      map.addLabel({ x: lx, y: ly, text: String(k + 1), size: 0.75, gmOnly: true });
    });
  }

  map.settings.wallStyle = 'straight';
  return map;
}
