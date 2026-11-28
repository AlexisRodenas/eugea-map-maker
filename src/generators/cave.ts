import { DungeonMap, T } from '../model';
import { Rng, fbm, hashString, uid } from '../util';

export interface CaveParams {
  cols: number;
  rows: number;
  seed: string;
  fill: number; // densité de roche initiale
  smooth: number; // itérations de l'automate
  connect: boolean; // relie les poches isolées par des tunnels
  water: number;
  lava: number;
  props: number;
  lights: number;
}

export const DEFAULT_CAVE: CaveParams = {
  cols: 50,
  rows: 38,
  seed: 'abime-4242',
  fill: 0.47,
  smooth: 5,
  connect: true,
  water: 0.3,
  lava: 0,
  props: 0.6,
  lights: 0.35,
};

export function generateCave(p: CaveParams): DungeonMap {
  const rng = new Rng(hashString(p.seed || 'grotte'));
  const seedN = hashString(p.seed) % 1000;
  const { cols, rows } = p;
  const map = new DungeonMap(cols, rows);
  map.settings.darkness = 0.75; // souterrain : nuit dans Foundry (les torches comptent)
  map.name = 'Grotte ' + p.seed;
  const M = 2;
  let wall = new Uint8Array(cols * rows).fill(1);
  for (let y = M; y < rows - M; y++) for (let x = M; x < cols - M; x++) wall[y * cols + x] = rng.chance(p.fill) ? 1 : 0;

  const at = (g: Uint8Array, x: number, y: number) => (x < 0 || y < 0 || x >= cols || y >= rows ? 1 : g[y * cols + x]);
  for (let it = 0; it < p.smooth; it++) {
    const next = new Uint8Array(cols * rows).fill(1);
    for (let y = M; y < rows - M; y++)
      for (let x = M; x < cols - M; x++) {
        let c1 = 0,
          c2 = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const v = at(wall, x + dx, y + dy);
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) c1 += v;
            c2 += v;
          }
        next[y * cols + x] = c1 >= 5 || (it < 2 && c2 <= 2) ? 1 : 0;
      }
    wall = next;
  }

  // --- Régions connexes
  const region = new Int32Array(cols * rows).fill(-1);
  const regions: number[][] = [];
  for (let i = 0; i < wall.length; i++) {
    if (wall[i] || region[i] >= 0) continue;
    const id = regions.length;
    const cells: number[] = [];
    const stack = [i];
    region[i] = id;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const x = c % cols,
        y = (c / cols) | 0;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (!wall[ni] && region[ni] < 0) {
          region[ni] = id;
          stack.push(ni);
        }
      }
    }
    regions.push(cells);
  }
  if (!regions.length) {
    // carte trop pleine : creuse une salle centrale
    for (let y = rows / 2 - 4; y < rows / 2 + 4; y++) for (let x = cols / 2 - 6; x < cols / 2 + 6; x++) wall[Math.floor(y) * cols + Math.floor(x)] = 0;
    regions.push([]);
  }
  const sorted = regions.map((c, i) => [i, c.length]).sort((a, b) => b[1] - a[1]);
  const main = sorted[0][0];
  const mainCells = regions[main];
  for (const [ri, size] of sorted.slice(1)) {
    const cells = regions[ri];
    if (!p.connect || size < 10) {
      for (const c of cells) wall[c] = 1;
      continue;
    }
    // tunnel sinueux vers la case la plus proche de la région principale
    const from = cells[Math.floor(rng.next() * cells.length)];
    let fx = from % cols,
      fy = (from / cols) | 0;
    let best = mainCells[0],
      bd = Infinity;
    for (let k = 0; k < mainCells.length; k += 3) {
      const c = mainCells[k];
      const d = Math.abs((c % cols) - fx) + Math.abs(((c / cols) | 0) - fy);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    const tx = best % cols,
      ty = (best / cols) | 0;
    let guard = 0;
    while ((fx !== tx || fy !== ty) && guard++ < 2000) {
      if (rng.chance(0.7)) {
        if (Math.abs(tx - fx) > Math.abs(ty - fy)) fx += Math.sign(tx - fx);
        else fy += Math.sign(ty - fy);
      } else if (rng.chance(0.5)) fx += rng.chance(0.5) ? 1 : -1;
      else fy += rng.chance(0.5) ? 1 : -1;
      fx = Math.max(M, Math.min(cols - M - 1, fx));
      fy = Math.max(M, Math.min(rows - M - 1, fy));
      wall[fy * cols + fx] = 0;
      if (rng.chance(0.5) && fx + 1 < cols - M) wall[fy * cols + fx + 1] = 0;
    }
  }

  for (let i = 0; i < wall.length; i++) if (!wall[i]) map.cells[i] = T.CAVE;

  // --- Eau et lave (bruit fractal ; seuil par quantile pour une proportion fiable)
  const floorIdx: number[] = [];
  for (let i = 0; i < map.cells.length; i++) if (map.cells[i]) floorIdx.push(i);
  const flood = (amount: number, terrain: number, deep: number, scale: number, off: number, seed: number) => {
    if (amount <= 0 || !floorIdx.length) return;
    const vals = floorIdx.map((i) => [i, fbm((i % cols) * scale + off, ((i / cols) | 0) * scale + off, 3, seed)] as [number, number]);
    vals.sort((a, b) => b[1] - a[1]);
    const n = Math.floor(vals.length * amount * 0.4);
    const nDeep = deep ? Math.floor(n * 0.4) : 0;
    for (let k = 0; k < n; k++) {
      const i = vals[k][0];
      if (map.cells[i] !== T.CAVE) continue;
      map.cells[i] = k < nDeep ? deep : terrain;
    }
  };
  flood(p.water, T.WATER, T.DEEP, 0.085, 0, seedN);
  flood(p.lava, T.LAVA, 0, 0.07, 50, seedN + 7);

  // --- Décor
  const openN = (x: number, y: number) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (map.get(x + dx, y + dy)) n++;
    return n;
  };
  const occ = new Uint8Array(cols * rows);
  const put = (kind: string, x: number, y: number, w = 1, h = 1) => {
    occ[y * cols + x] = 1;
    map.props.push({ id: uid(), kind, x: x + 0.5, y: y + 0.5, w, h, rot: rng.int(0, 3) * 90, gmOnly: false });
  };
  // Sources de lumière : cristaux et feux de camp dans les zones dégagées
  const open9: number[] = [];
  for (let i = 0; i < map.cells.length; i++) {
    const x = i % cols,
      y = (i / cols) | 0;
    if (map.cells[i] === T.CAVE && openN(x, y) === 9) open9.push(i);
  }
  rng.shuffle(open9);
  const nLights = Math.round(p.lights * Math.max(2, open9.length / 90));
  for (let k = 0; k < nLights && k < open9.length; k++) {
    const i = open9[k];
    put(rng.chance(0.6) ? 'crystals' : 'campfire', i % cols, (i / cols) | 0);
  }
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const t = map.get(x, y);
      if (t !== T.CAVE || occ[y * cols + x]) continue;
      const o = openN(x, y);
      const r = rng.next();
      if (o <= 6 && r < 0.05 * p.props) put(rng.chance(0.6) ? 'stalagmite' : 'boulder', x, y);
      else if (o <= 5 && r < 0.08 * p.props) put('web', x, y);
      else if (o === 9 && r < 0.025 * p.props) put(rng.pick(['rubble', 'bones', 'mushrooms', 'rubble']), x, y);
    }
  // Entrée : une échelle près du haut
  outer: for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (map.get(x, y) === T.CAVE && openN(x, y) === 9 && !occ[y * cols + x]) {
        put('ladder', x, y, 0.6, 1);
        map.props[map.props.length - 1].rot = 0;
        break outer;
      }

  map.settings.wallStyle = 'organic';
  map.touchAll();
  return map;
}
