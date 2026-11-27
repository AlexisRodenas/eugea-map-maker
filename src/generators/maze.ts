import { DungeonMap, EDGE, T } from '../model';
import { Rng, hashString, uid } from '../util';

export interface MazeParams {
  cols: number;
  rows: number;
  seed: string;
  corridor: number; // largeur des couloirs (cases)
  thin: boolean; // murs fins (sur les arêtes) au lieu de murs pleins
  braid: number; // 0 : labyrinthe parfait, 1 : aucun cul-de-sac
  rooms: number; // nombre de salles ouvertes
  props: number;
}

export const DEFAULT_MAZE: MazeParams = {
  cols: 41,
  rows: 31,
  seed: 'minotaure-77',
  corridor: 1,
  thin: false,
  braid: 0.2,
  rooms: 3,
  props: 0.5,
};

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export function generateMaze(p: MazeParams): DungeonMap {
  const rng = new Rng(hashString(p.seed || 'labyrinthe'));
  const { cols, rows } = p;
  const map = new DungeonMap(cols, rows);
  map.name = 'Labyrinthe ' + p.seed;
  const C = Math.max(1, Math.min(4, p.corridor));
  const pitch = p.thin ? C : C + 1;
  const off = 1;
  const nx = Math.max(2, Math.floor((cols - off * 2 - (p.thin ? 0 : 1)) / pitch));
  const ny = Math.max(2, Math.floor((rows - off * 2 - (p.thin ? 0 : 1)) / pitch));
  const N = nx * ny;
  // links[i] : bits des directions ouvertes
  const links = new Uint8Array(N);
  const visited = new Uint8Array(N);
  const stack = [rng.int(0, N - 1)];
  visited[stack[0]] = 1;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const cx = cur % nx,
      cy = (cur / nx) | 0;
    const dirs = rng.shuffle([0, 1, 2, 3]).filter((d) => {
      const x = cx + DX[d],
        y = cy + DY[d];
      return x >= 0 && y >= 0 && x < nx && y < ny && !visited[y * nx + x];
    });
    if (!dirs.length) {
      stack.pop();
      continue;
    }
    const d = dirs[0];
    const nxt = (cy + DY[d]) * nx + cx + DX[d];
    links[cur] |= 1 << d;
    links[nxt] |= 1 << ((d + 2) & 3);
    visited[nxt] = 1;
    stack.push(nxt);
  }
  // Tressage : supprime une partie des culs-de-sac
  const popcount = (v: number) => (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1);
  for (let i = 0; i < N; i++) {
    if (popcount(links[i]) !== 1 || !rng.chance(p.braid)) continue;
    const cx = i % nx,
      cy = (i / nx) | 0;
    const opts = [0, 1, 2, 3].filter((d) => {
      const x = cx + DX[d],
        y = cy + DY[d];
      return !(links[i] & (1 << d)) && x >= 0 && y >= 0 && x < nx && y < ny;
    });
    if (!opts.length) continue;
    const d = rng.pick(opts);
    const j = (cy + DY[d]) * nx + cx + DX[d];
    links[i] |= 1 << d;
    links[j] |= 1 << ((d + 2) & 3);
  }
  // Salles : ouvre des blocs de nœuds
  const roomNodes = new Uint8Array(N);
  for (let k = 0; k < p.rooms; k++) {
    const rw = rng.int(2, 3),
      rh = rng.int(2, 3);
    if (rw >= nx || rh >= ny) break;
    const rx = rng.int(0, nx - rw),
      ry = rng.int(0, ny - rh);
    for (let y = ry; y < ry + rh; y++)
      for (let x = rx; x < rx + rw; x++) {
        const i = y * nx + x;
        roomNodes[i] = 1;
        if (x < rx + rw - 1) {
          links[i] |= 1;
          links[i + 1] |= 4;
        }
        if (y < ry + rh - 1) {
          links[i] |= 2;
          links[i + nx] |= 8;
        }
      }
  }

  const nodeX = (i: number) => off + (i % nx) * pitch;
  const nodeY = (i: number) => off + ((i / nx) | 0) * pitch;
  if (p.thin) {
    for (let i = 0; i < N; i++) {
      const x0 = nodeX(i),
        y0 = nodeY(i);
      for (let y = y0; y < y0 + C; y++) for (let x = x0; x < x0 + C; x++) map.set(x, y, T.STONE);
    }
    for (let i = 0; i < N; i++) {
      const x0 = nodeX(i),
        y0 = nodeY(i);
      const cx = i % nx,
        cy = (i / nx) | 0;
      if (cx < nx - 1 && !(links[i] & 1)) for (let y = y0; y < y0 + C; y++) map.setVEdge(x0 + C, y, EDGE.WALL);
      if (cy < ny - 1 && !(links[i] & 2)) for (let x = x0; x < x0 + C; x++) map.setHEdge(x, y0 + C, EDGE.WALL);
    }
  } else {
    for (let i = 0; i < N; i++) {
      const x0 = nodeX(i),
        y0 = nodeY(i);
      for (let y = y0; y < y0 + C; y++) for (let x = x0; x < x0 + C; x++) map.set(x, y, T.STONE);
      if (links[i] & 1) for (let y = y0; y < y0 + C; y++) map.set(x0 + C, y, T.STONE);
      if (links[i] & 2) for (let x = x0; x < x0 + C; x++) map.set(x, y0 + C, T.STONE);
      // coins intérieurs des salles
      const cx = i % nx,
        cy = (i / nx) | 0;
      if (roomNodes[i] && cx < nx - 1 && cy < ny - 1 && roomNodes[i + 1] && roomNodes[i + nx] && roomNodes[i + nx + 1]) map.set(x0 + C, y0 + C, T.STONE);
    }
  }

  // Entrée / sortie : nœuds les plus éloignés (BFS)
  const bfs = (s: number) => {
    const d = new Int32Array(N).fill(-1);
    d[s] = 0;
    const q = [s];
    let last = s;
    while (q.length) {
      const i = q.shift()!;
      last = i;
      const cx = i % nx,
        cy = (i / nx) | 0;
      for (let k = 0; k < 4; k++) {
        if (!(links[i] & (1 << k))) continue;
        const j = (cy + DY[k]) * nx + cx + DX[k];
        if (d[j] < 0) {
          d[j] = d[i] + 1;
          q.push(j);
        }
      }
    }
    return { last, d };
  };
  const a = bfs(0).last;
  const { last: b } = bfs(a);
  const mid = (C - 1) / 2 + 0.5;
  for (const i of [a, b]) {
    map.props.push({ id: uid(), kind: 'stairs', x: nodeX(i) + mid, y: nodeY(i) + mid, w: Math.min(1, C), h: 1, rot: 0, gmOnly: false });
  }
  map.addLabel({ x: nodeX(a) + mid, y: nodeY(a) + mid - 0.9, text: 'Entrée', size: 0.6, gmOnly: true });
  map.addLabel({ x: nodeX(b) + mid, y: nodeY(b) + mid - 0.9, text: 'Sortie', size: 0.6, gmOnly: true });

  // Trésors et ossements dans les culs-de-sac
  for (let i = 0; i < N; i++) {
    if (i === a || i === b || popcount(links[i]) !== 1 || !rng.chance(p.props * 0.5)) continue;
    const kind = rng.weighted([
      ['chest', 2],
      ['bones', 3],
      ['trap', 1],
      ['treasure', 1],
    ] as const);
    map.props.push({ id: uid(), kind, x: nodeX(i) + mid, y: nodeY(i) + mid, w: 1, h: 1, rot: rng.int(0, 3) * 90, gmOnly: kind === 'trap' });
  }
  map.settings.wallStyle = 'straight';
  return map;
}
