// Carte du monde (1 case = 5 km) : relief par bruit, océans et côtes, climat et biomes,
// rivières qui suivent la pente, montagnes et forêts en pictogrammes, villes reliées par des routes.
import { DungeonMap, T } from '../model';
import { Rng, fbm, hashString } from '../util';
import { Placer } from './outdoor';

export interface WorldParams {
  cols: number;
  rows: number;
  seed: string;
  shape: 'continent' | 'archipel' | 'interieur';
  sea: number; // part d'océan (0..1)
  mountains: number;
  forests: number;
  rivers: number;
  cities: number;
  roads: boolean;
  names: boolean;
}

export const DEFAULT_WORLD: WorldParams = {
  cols: 160,
  rows: 110,
  seed: 'aldraine',
  shape: 'continent',
  sea: 0.45,
  mountains: 0.6,
  forests: 0.6,
  rivers: 8,
  cities: 12,
  roads: true,
  names: true,
};

const PLACE = ['Valombre', 'Hautepierre', 'Mirefleur', 'Port-Ardent', 'Corbelac', 'Aubeterre', 'Rochebrune', 'Clairval', 'Sombreval', 'Lunargent', 'Pierrefeu', 'Givrelac', 'Brumeport', 'Vertmont', 'Ostrel', 'Kaëlis', 'Dunmor', 'Fendragon', 'Saint-Aldric', 'Bellerive'];
const SEAS = ['Mer des Brumes', 'Golfe d’Argent', 'Océan Pâle', 'Mer Intérieure', 'Baie des Naufragés'];
const RANGES = ['Monts du Dragon', 'Crêtes Grises', 'Pics de Givre', 'Monts Ardents'];

export function generateWorld(p: WorldParams): DungeonMap {
  const rng = new Rng(hashString(p.seed || 'monde'));
  const sn = hashString(p.seed) % 991;
  const { cols, rows } = p;
  const N = cols * rows;
  const at = (x: number, y: number) => y * cols + x;
  const map = new DungeonMap(cols, rows);
  map.name = rng.pick(['Royaume d’Aldraine', 'Terres d’Ostrel', 'Monde de Kaëlis', 'Contrées de Fendragon']);
  Object.assign(map.settings, { gridDistance: 5, gridUnits: 'km', showGrid: false, theme: 'parchemin', darkness: 0, vignette: 0.35 });

  // --- Relief
  const hgt = new Float32Array(N);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const nx = x / cols - 0.5,
        ny = y / rows - 0.5;
      const d = Math.hypot(nx * 1.1, ny * 1.25) * 2; // 0 au centre, ~1 au bord
      let h = fbm(x * 0.035, y * 0.035, 5, sn) * 0.75 + fbm(x * 0.12, y * 0.12, 3, sn + 11) * 0.25;
      if (p.shape === 'continent') h = h * 0.75 + (1 - d * d) * 0.45 - 0.12;
      else if (p.shape === 'archipel') h = fbm(x * 0.07, y * 0.07, 4, sn + 5) * 0.9 + (1 - d) * 0.15;
      else h = h * 0.7 + 0.3 - Math.max(0, d - 0.9) * 0.6; // terres intérieures : peu de mer
      hgt[y * cols + x] = h;
    }
  // seuil de la mer : quantile choisi
  const sorted = Array.from(hgt).sort((a, b) => a - b);
  const seaQ = p.shape === 'interieur' ? Math.min(0.15, p.sea * 0.3) : p.sea;
  const s = sorted[Math.floor(Math.max(0, Math.min(0.95, seaQ)) * (N - 1))];
  const hmax = sorted[N - 1];
  const elev = (i: number) => (hgt[i] - s) / (hmax - s || 1);

  const G = map.ground;
  const land = (i: number) => hgt[i] >= s;
  // --- Climat et biomes
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = at(x, y);
      if (!land(i)) {
        G[i] = hgt[i] < s - 0.06 ? T.DEEP : T.WATER;
        continue;
      }
      const e = elev(i);
      const t = 0.25 + 0.6 * (y / rows) - e * 0.55 + (fbm(x * 0.05, y * 0.05, 2, sn + 21) - 0.5) * 0.3;
      const m = fbm(x * 0.04, y * 0.04, 4, sn + 31);
      let b: number = T.GRASS;
      if (e > 0.62) b = e > 0.86 || (t < 0.05 && e > 0.75) ? T.SNOW : T.ROCKY;
      else if (t < 0.06) b = T.SNOW;
      else if (e < 0.025) b = T.SAND;
      else if (m > 0.64 && e < 0.12) b = T.MUD;
      else if (t > 0.7 && m < 0.38) b = T.SAND;
      else if (m > 0.52 - p.forests * 0.12) b = T.FOREST;
      G[i] = b;
    }

  // --- Rivières : de la montagne vers la mer, par la plus forte pente
  const river = new Uint8Array(N);
  const sources: number[] = [];
  for (let i = 0; i < N; i++) if (land(i) && elev(i) > 0.45 && elev(i) < 0.8) sources.push(i);
  rng.shuffle(sources);
  for (let k = 0; k < Math.min(p.rivers, sources.length); k++) {
    let i = sources[k];
    for (let step = 0; step < 400; step++) {
      if (!land(i)) break;
      river[i] = 1;
      const x = i % cols,
        y = (i / cols) | 0;
      let best = -1,
        bh = hgt[i];
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
        const hj = hgt[j] + rng.float(-0.004, 0.004);
        if (hj < bh) {
          bh = hj;
          best = j;
        }
      }
      if (best < 0) {
        // cuvette : un petit lac
        G[i] = T.WATER;
        break;
      }
      i = best;
    }
  }
  for (let i = 0; i < N; i++) if (river[i] && land(i)) G[i] = T.WATER;

  const P = new Placer(map, rng);
  for (let i = 0; i < N; i++) if (G[i] === T.WATER || G[i] === T.DEEP) P.occ[i] = 1;

  // --- Villes : de préférence sur les côtes et les rivières, éloignées les unes des autres
  const near = (i: number, r: number, f: (j: number) => boolean) => {
    const x = i % cols,
      y = (i / cols) | 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(rows - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(cols - 1, x + r); xx++) if (f(at(xx, yy))) return true;
    return false;
  };
  const cand: [number, number][] = [];
  for (let y = 4; y < rows - 4; y++)
    for (let x = 4; x < cols - 4; x++) {
      const i = at(x, y);
      if (!land(i) || G[i] === T.WATER || elev(i) > 0.45 || G[i] === T.SNOW) continue;
      let score = rng.next();
      if (near(i, 2, (j) => !land(j))) score += 1.2;
      if (near(i, 1, (j) => river[j] === 1)) score += 1;
      if (G[i] === T.GRASS) score += 0.4;
      cand.push([i, score]);
    }
  cand.sort((a, b) => b[1] - a[1]);
  const cities: { x: number; y: number; rank: number; name: string }[] = [];
  const names = rng.shuffle([...PLACE]);
  const minD = Math.max(8, Math.sqrt((cols * rows) / Math.max(1, p.cities)) * 0.7);
  for (const [i] of cand) {
    if (cities.length >= p.cities) break;
    const x = (i % cols) + 0.5,
      y = ((i / cols) | 0) + 0.5;
    if (cities.some((c) => Math.hypot(c.x - x, c.y - y) < minD)) continue;
    const rank = cities.length === 0 ? 0 : cities.length < 4 ? 1 : cities.length < 9 ? 2 : 3;
    cities.push({ x, y, rank, name: names[cities.length % names.length] });
  }

  // --- Routes : arbre couvrant entre villes, tracé au moindre coût (évite montagnes et mer)
  // masses de terre (les routes ne traversent pas la mer)
  const mass = new Int32Array(N).fill(-1);
  {
    let id = 0;
    for (let i0 = 0; i0 < N; i0++) {
      if (!land(i0) || mass[i0] >= 0) continue;
      const stack = [i0];
      mass[i0] = id;
      while (stack.length) {
        const i = stack.pop()!;
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
          if (land(j) && mass[j] < 0) {
            mass[j] = id;
            stack.push(j);
          }
        }
      }
      id++;
    }
  }
  if (p.roads && cities.length > 1) {
    const cost = (i: number) => (G[i] === T.DEEP ? Infinity : G[i] === T.WATER ? (river[i] ? 6 : Infinity) : G[i] === T.ROCKY || G[i] === T.SNOW ? 8 : G[i] === T.FOREST || G[i] === T.MUD ? 2.5 : 1);
    const path = (a: number, b: number): number[] | null => {
      const dist = new Float32Array(N).fill(Infinity);
      const prev = new Int32Array(N).fill(-1);
      // tas binaire minimal : priorités et cases
      const hp: number[] = [],
        hv: number[] = [];
      const push = (pr: number, v: number) => {
        hp.push(pr);
        hv.push(v);
        let k = hp.length - 1;
        while (k > 0) {
          const q = (k - 1) >> 1;
          if (hp[q] <= hp[k]) break;
          [hp[q], hp[k]] = [hp[k], hp[q]];
          [hv[q], hv[k]] = [hv[k], hv[q]];
          k = q;
        }
      };
      const pop = (): number => {
        const top = hv[0];
        const lp = hp.pop()!,
          lv = hv.pop()!;
        if (hp.length) {
          hp[0] = lp;
          hv[0] = lv;
          let k = 0;
          for (;;) {
            const l = k * 2 + 1,
              r = l + 1;
            let m = k;
            if (l < hp.length && hp[l] < hp[m]) m = l;
            if (r < hp.length && hp[r] < hp[m]) m = r;
            if (m === k) break;
            [hp[m], hp[k]] = [hp[k], hp[m]];
            [hv[m], hv[k]] = [hv[k], hv[m]];
            k = m;
          }
        }
        return top;
      };
      push(0, a);
      dist[a] = 0;
      const bx = b % cols,
        by = (b / cols) | 0;
      const seen = new Uint8Array(N);
      while (hp.length) {
        const i = pop();
        if (seen[i]) continue;
        seen[i] = 1;
        if (i === b) break;
        const x = i % cols,
          y = (i / cols) | 0;
        for (const [dx, dy, w] of [
          [1, 0, 1],
          [-1, 0, 1],
          [0, 1, 1],
          [0, -1, 1],
          [1, 1, 1.41],
          [-1, 1, 1.41],
          [1, -1, 1.41],
          [-1, -1, 1.41],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = at(nx, ny);
          const c = cost(j);
          if (!isFinite(c)) continue;
          const nd = dist[i] + c * w;
          if (nd < dist[j]) {
            dist[j] = nd;
            prev[j] = i;
            push(nd + Math.hypot(nx - bx, ny - by), j);
          }
        }
      }
      if (!isFinite(dist[b])) return null;
      const out: number[] = [];
      for (let i = b; i >= 0 && i !== a; i = prev[i]) out.push(i);
      return out;
    };
    const idx = (c: { x: number; y: number }) => at(Math.floor(c.x), Math.floor(c.y));
    const inTree = [0];
    const edges: [number, number][] = [];
    while (inTree.length < cities.length) {
      let best: [number, number] | null = null,
        bd = Infinity;
      for (const a of inTree)
        cities.forEach((c, b) => {
          if (inTree.includes(b)) return;
          // autre île : pas de route (mais l'arbre continue pour relier le reste)
          const d = Math.hypot(cities[a].x - c.x, cities[a].y - c.y) + (mass[idx(cities[a])] !== mass[idx(c)] ? 1e6 : 0);
          if (d < bd) {
            bd = d;
            best = [a, b];
          }
        });
      if (!best) break;
      edges.push(best);
      inTree.push((best as [number, number])[1]);
    }
    for (const [a, b] of edges) {
      if (mass[idx(cities[a])] !== mass[idx(cities[b])]) continue;
      const pth = path(idx(cities[a]), idx(cities[b]));
      if (!pth) continue;
      for (const i of pth) if (G[i] !== T.WATER && G[i] !== T.DEEP) G[i] = T.PATH;
    }
  }

  // --- Pictogrammes : montagnes, collines, forêts (de haut en bas pour un bon recouvrement)
  const marks: { y: number; f: () => void }[] = [];
  for (let y = 1; y < rows - 1; y++)
    for (let x = 1; x < cols - 1; x++) {
      const i = at(x, y);
      if (!land(i) || G[i] === T.PATH || G[i] === T.WATER) continue;
      const e = elev(i);
      if (e > 0.6 && rng.chance(0.35 * (0.4 + p.mountains))) {
        const sc = 0.8 + e * 0.7;
        marks.push({ y, f: () => P.put('mountain', x + 0.5, y + 0.5, 0, { w: 3 * sc, h: 2.4 * sc }) });
      } else if (e > 0.4 && e <= 0.6 && rng.chance(0.12 * (0.3 + p.mountains))) marks.push({ y, f: () => P.put('hills', x + 0.5, y + 0.5, 0, { w: 2.2, h: 1.1 }) });
      else if (G[i] === T.FOREST && rng.chance(0.3)) {
        const cold = G[i] === T.FOREST && y < rows * 0.35;
        marks.push({ y, f: () => P.put(cold ? 'pineGrove' : 'grove', x + 0.5, y + 0.5, 0, { w: 1.8, h: 1.8 }) });
      }
    }
  // villes avant le décor (elles gardent leur place)
  for (const c of cities) {
    const kind = c.rank === 0 ? 'castleIcon' : c.rank === 1 ? 'cityIcon' : c.rank === 2 ? 'townIcon' : 'hamletIcon';
    const sz = c.rank === 0 ? 2.4 : c.rank === 1 ? 2.2 : c.rank === 2 ? 1.5 : 1;
    P.put(kind, c.x, c.y, 0, { w: sz, h: sz * 0.85, force: true });
    for (let yy = Math.floor(c.y) - 2; yy <= Math.floor(c.y) + 2; yy++) for (let xx = Math.floor(c.x) - 2; xx <= Math.floor(c.x) + 2; xx++) P.block(xx, yy);
    if (p.names) map.addLabel({ x: c.x, y: c.y + sz * 0.7 + 0.6, text: c.name, size: c.rank === 0 ? 1.4 : c.rank === 1 ? 1.15 : 0.9, gmOnly: false });
  }
  marks.sort((a, b) => a.y - b.y);
  for (const m of marks) m.f();

  // --- Noms des mers et des montagnes, titre, rose des vents
  if (p.names) {
    const seaCells: number[] = [];
    for (let i = 0; i < N; i++) if (G[i] === T.DEEP && !near(i, 3, (j) => land(j))) seaCells.push(i);
    const seaNames = rng.shuffle([...SEAS]);
    const used: [number, number][] = [];
    for (let k = 0; k < Math.min(3, seaNames.length) && seaCells.length; k++) {
      for (let t = 0; t < 40; t++) {
        const i = rng.pick(seaCells);
        const x = (i % cols) + 0.5,
          y = ((i / cols) | 0) + 0.5;
        if (used.some(([ux, uy]) => Math.hypot(ux - x, uy - y) < 30)) continue;
        used.push([x, y]);
        map.addLabel({ x, y, text: seaNames[k], size: 1.6, gmOnly: false, color: '#1d3f66' });
        break;
      }
    }
    const peaks: number[] = [];
    for (let i = 0; i < N; i++) if (land(i) && elev(i) > 0.72) peaks.push(i);
    if (peaks.length) {
      const i = rng.pick(peaks);
      map.addLabel({ x: (i % cols) + 0.5, y: ((i / cols) | 0) + 3, text: rng.pick(RANGES), size: 1.2, gmOnly: false, color: '#4a3a2a' });
    }
    map.addLabel({ x: cols / 2, y: 3.5, text: map.name, size: 3, gmOnly: false });
  }
  P.put('compass', cols - 7, rows - 7, 0, { w: 8, h: 8, force: true });
  map.touchAll();
  return map;
}
