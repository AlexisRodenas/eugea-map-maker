import { DungeonMap, Prop, isDoorEdge } from '../model';
import { PROP_BY_KIND, propBounds } from '../props';
import { Rng, uid } from '../util';

export type RoomType =
  | 'vide'
  | 'stockage'
  | 'caserne'
  | 'bibliotheque'
  | 'tresor'
  | 'temple'
  | 'crypte'
  | 'trone'
  | 'rituel'
  | 'fontaine'
  | 'cuisine'
  | 'repaire'
  // bâtiments de village
  | 'maison'
  | 'chambre'
  | 'taverne'
  | 'forge'
  | 'echoppe'
  | 'chapelle'
  | 'grange'
  | 'entrepot';

export type Shape = 'rect' | 'round' | 'cross' | 'pillared';

export interface RoomInfo {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: Shape;
  type: RoomType;
}

export type Flavor = 'mixte' | 'crypte' | 'forteresse' | 'temple' | 'repaire';

export const FLAVORS: [Flavor, string][] = [
  ['mixte', 'Mixte'],
  ['crypte', 'Crypte / nécropole'],
  ['forteresse', 'Forteresse'],
  ['temple', 'Temple'],
  ['repaire', 'Repaire de monstres'],
];

const WEIGHTS: Record<Flavor, [RoomType, number][]> = {
  mixte: [
    ['vide', 3],
    ['stockage', 2],
    ['caserne', 1.5],
    ['bibliotheque', 1],
    ['tresor', 1],
    ['temple', 1],
    ['crypte', 1],
    ['trone', 0.4],
    ['rituel', 0.6],
    ['fontaine', 0.6],
    ['cuisine', 0.8],
    ['repaire', 0.8],
  ],
  crypte: [
    ['vide', 2],
    ['crypte', 4],
    ['rituel', 1],
    ['temple', 1],
    ['tresor', 0.8],
    ['repaire', 0.6],
    ['stockage', 0.5],
  ],
  forteresse: [
    ['vide', 1.5],
    ['caserne', 3],
    ['stockage', 2.5],
    ['cuisine', 1.5],
    ['bibliotheque', 1],
    ['trone', 0.6],
    ['tresor', 0.8],
    ['fontaine', 0.5],
  ],
  temple: [
    ['vide', 1],
    ['temple', 3],
    ['rituel', 1.5],
    ['fontaine', 1.5],
    ['bibliotheque', 1.2],
    ['crypte', 1],
    ['tresor', 0.6],
  ],
  repaire: [
    ['vide', 2],
    ['repaire', 4],
    ['stockage', 1],
    ['tresor', 0.8],
    ['rituel', 0.5],
    ['crypte', 0.5],
  ],
};

export function pickRoomType(rng: Rng, flavor: Flavor): RoomType {
  return rng.weighted(WEIGHTS[flavor]);
}

const SIDE_DX = [0, 1, 0, -1];
const SIDE_DY = [-1, 0, 1, 0];

/** Aménage une salle avec des objets cohérents avec son type. */
export class Dresser {
  constructor(
    private map: DungeonMap,
    private roomId: Int16Array,
    private occ: Uint8Array,
    private rng: Rng,
    private density: number,
    private lightP: number,
  ) {}

  private idx(x: number, y: number): number {
    return y * this.map.cols + x;
  }
  private inRoom(r: RoomInfo, x: number, y: number): boolean {
    return this.map.inBounds(x, y) && this.roomId[this.idx(x, y)] === r.id;
  }
  private isFloor(x: number, y: number): boolean {
    return this.map.get(x, y) !== 0;
  }
  /** Type de l'arête du côté s (0=N 1=E 2=S 3=O) de la case. */
  private edgeAt(x: number, y: number, s: number): number {
    const m = this.map;
    return s === 0 ? m.hEdge(x, y) : s === 1 ? m.vEdge(x + 1, y) : s === 2 ? m.hEdge(x, y + 1) : m.vEdge(x, y);
  }
  private hasDoor(x: number, y: number): boolean {
    for (let s = 0; s < 4; s++) if (isDoorEdge(this.edgeAt(x, y, s))) return true;
    return false;
  }
  /** Case de la salle proche d'une ouverture ou d'une porte (à garder libre). */
  private nearOpening(r: RoomInfo, x: number, y: number): boolean {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if (this.isFloor(nx, ny) && !this.inRoom(r, nx, ny)) return true;
        if (this.inRoom(r, nx, ny) && this.hasDoor(nx, ny)) return true;
      }
    return false;
  }

  /** Cases contre un mur (côté 0=N 1=E 2=S 3=O). */
  wallSpots(r: RoomInfo): { x: number; y: number; side: number }[] {
    const out: { x: number; y: number; side: number }[] = [];
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        if (!this.inRoom(r, x, y) || this.nearOpening(r, x, y)) continue;
        for (let s = 0; s < 4; s++) if (!this.isFloor(x + SIDE_DX[s], y + SIDE_DY[s])) out.push({ x, y, side: s });
      }
    return out;
  }

  /** Place un objet si toute son empreinte est libre et dans la salle. */
  place(r: RoomInfo, kind: string, cx: number, cy: number, rot = 0, extra: Partial<Prop> = {}): boolean {
    const def = PROP_BY_KIND[kind];
    if (!def) return false;
    const p: Prop = { id: uid(), kind, x: cx, y: cy, w: extra.w ?? def.w, h: extra.h ?? def.h, rot, gmOnly: extra.gmOnly ?? !!def.gmOnly };
    const b = propBounds(p);
    const x0 = Math.floor(b.x0 + 0.02),
      y0 = Math.floor(b.y0 + 0.02),
      x1 = Math.ceil(b.x1 - 0.02),
      y1 = Math.ceil(b.y1 - 0.02);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        if (!this.inRoom(r, x, y) || this.occ[this.idx(x, y)] || this.nearOpening(r, x, y)) return false;
      }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.occ[this.idx(x, y)] = 1;
    this.map.props.push(p);
    return true;
  }

  /** Place un objet adossé au mur, sa base contre la case (x, y). */
  placeAgainst(r: RoomInfo, kind: string, x: number, y: number, side: number): boolean {
    const def = PROP_BY_KIND[kind];
    const fw = side % 2 ? def.h : def.w;
    const fh = side % 2 ? def.w : def.h;
    let cx: number, cy: number;
    if (side === 0) {
      cx = x + fw / 2;
      cy = y + fh / 2;
    } else if (side === 2) {
      cx = x + fw / 2;
      cy = y + 1 - fh / 2;
    } else if (side === 3) {
      cx = x + fw / 2;
      cy = y + fh / 2;
    } else {
      cx = x + 1 - fw / 2;
      cy = y + fh / 2;
    }
    return this.place(r, kind, cx, cy, side * 90);
  }

  private torch(spot: { x: number; y: number; side: number }): void {
    const off = [
      [0.5, 0.2],
      [0.8, 0.5],
      [0.5, 0.8],
      [0.2, 0.5],
    ][spot.side];
    const i = this.idx(spot.x, spot.y);
    if (this.occ[i]) return;
    this.occ[i] = 1;
    this.map.props.push({ id: uid(), kind: 'torch', x: spot.x + off[0], y: spot.y + off[1], w: 0.5, h: 0.5, rot: spot.side * 90, gmOnly: false });
  }

  private count(base: number): number {
    const v = base * this.density;
    return Math.floor(v) + (this.rng.chance(v - Math.floor(v)) ? 1 : 0);
  }

  private randomFree(r: RoomInfo): { x: number; y: number } | null {
    for (let k = 0; k < 30; k++) {
      const x = this.rng.int(r.x, r.x + r.w - 1),
        y = this.rng.int(r.y, r.y + r.h - 1);
      if (this.inRoom(r, x, y) && !this.occ[this.idx(x, y)] && !this.nearOpening(r, x, y)) return { x, y };
    }
    return null;
  }

  private scatter(r: RoomInfo, kinds: string[], n: number): void {
    for (let i = 0; i < n; i++) {
      const c = this.randomFree(r);
      if (c) this.place(r, this.rng.pick(kinds), c.x + 0.5, c.y + 0.5, this.rng.int(0, 3) * 90);
    }
  }

  private alongWalls(r: RoomInfo, kinds: string[], n: number, spacing = 1): void {
    const spots = this.rng.shuffle(this.wallSpots(r));
    let placed = 0;
    for (const s of spots) {
      if (placed >= n) break;
      if (this.placeAgainst(r, this.rng.pick(kinds), s.x, s.y, s.side)) {
        placed++;
        // espacement : bloque les voisins le long du mur
        if (spacing > 1) {
          const ax = s.side % 2 ? 0 : 1,
            ay = s.side % 2 ? 1 : 0;
          for (let k = 1; k < spacing; k++) {
            const nx = s.x + ax * k,
              ny = s.y + ay * k;
            if (this.map.inBounds(nx, ny)) this.occ[this.idx(nx, ny)] = 1;
          }
        }
      }
    }
  }

  private center(r: RoomInfo): { x: number; y: number } {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  /** Côté de la salle sans ouverture (le "fond"), pour l'autel ou le trône. */
  private backSide(r: RoomInfo): number {
    const open = [0, 0, 0, 0];
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        if (!this.inRoom(r, x, y)) continue;
        for (let s = 0; s < 4; s++) {
          const nx = x + SIDE_DX[s],
            ny = y + SIDE_DY[s];
          if (this.isFloor(nx, ny) && !this.inRoom(r, nx, ny)) open[s]++;
          if (isDoorEdge(this.edgeAt(x, y, s))) open[s] += 2;
        }
      }
    const order = this.rng.shuffle([0, 1, 2, 3]);
    order.sort((a, b) => open[a] - open[b]);
    return order[0];
  }

  /** Position au milieu du côté donné (case contre le mur). */
  private sideMid(r: RoomInfo, side: number, span: number): { x: number; y: number } {
    if (side === 0) return { x: r.x + Math.floor((r.w - span) / 2), y: r.y };
    if (side === 2) return { x: r.x + Math.floor((r.w - span) / 2), y: r.y + r.h - 1 };
    if (side === 3) return { x: r.x, y: r.y + Math.floor((r.h - span) / 2) };
    return { x: r.x + r.w - 1, y: r.y + Math.floor((r.h - span) / 2) };
  }

  private pillars(r: RoomInfo): void {
    if (r.w < 6 || r.h < 6) return;
    const horiz = r.w >= r.h;
    const len = horiz ? r.w : r.h;
    for (let k = 1; k < len - 1; k += 2) {
      for (const off of [1, (horiz ? r.h : r.w) - 2]) {
        const x = horiz ? r.x + k : r.x + off;
        const y = horiz ? r.y + off : r.y + k;
        this.place(r, 'pillar', x + 0.5, y + 0.5, 0);
      }
    }
  }

  /** Table au centre, avec des chaises de part et d'autre. */
  private tableWithChairs(r: RoomInfo, chairs = true): void {
    if (r.w < 4 || r.h < 4) return;
    const c = this.center(r);
    const horiz = r.w >= r.h;
    const cx = horiz ? c.x : Math.floor(c.x) + 0.5,
      cy = horiz ? Math.floor(c.y) + 0.5 : c.y;
    if (!this.place(r, 'table', cx, cy, horiz ? 0 : 90) || !chairs) return;
    if (horiz) {
      this.place(r, 'chair', cx - 0.5, cy - 1, 180);
      this.place(r, 'chair', cx + 0.5, cy + 1, 0);
    } else {
      this.place(r, 'chair', cx - 1, cy - 0.5, 90);
      this.place(r, 'chair', cx + 1, cy + 0.5, 270);
    }
  }

  /** Rangées de bancs face à l'autel (côté `side`). */
  private pews(r: RoomInfo, side: number): void {
    const vertical = side % 2 === 0;
    const depth = vertical ? r.h : r.w;
    const span = vertical ? r.w : r.h;
    if (span < 5) return;
    for (let k = 2; k < depth - 1; k += 2) {
      const d = side === 0 || side === 3 ? k : depth - 1 - k;
      for (const off of [-1.3, 1.3]) {
        if (vertical) this.place(r, 'bench', r.x + r.w / 2 + off, r.y + d + 0.5, 0);
        else this.place(r, 'bench', r.x + d + 0.5, r.y + r.h / 2 + off, 90);
      }
    }
  }

  dress(r: RoomInfo): void {
    const rng = this.rng;
    const area = r.w * r.h;
    if (r.shape === 'pillared') this.pillars(r);
    const c = this.center(r);
    const round = r.shape === 'round' || r.shape === 'cross';
    switch (r.type) {
      case 'vide':
        this.scatter(r, ['rubble', 'rubble', 'bones'], this.count(area / 25));
        break;
      case 'stockage':
        this.alongWalls(r, ['barrel', 'crate', 'crate', 'barrel', 'chest'], this.count(area / 5));
        this.scatter(r, ['crate', 'barrel'], this.count(1));
        break;
      case 'caserne':
        if (!round) this.alongWalls(r, ['bed'], this.count(area / 7), 2);
        if (r.w >= 5 && r.h >= 5) {
          if (this.place(r, 'table', c.x, c.y, r.w >= r.h ? 0 : 90)) {
            if (r.w >= r.h) {
              this.place(r, 'chair', c.x - 0.5, c.y - 1, 180);
              this.place(r, 'chair', c.x + 0.5, c.y + 1, 0);
            } else {
              this.place(r, 'chair', c.x - 1, c.y - 0.5, 90);
              this.place(r, 'chair', c.x + 1, c.y + 0.5, 270);
            }
          }
        }
        this.alongWalls(r, ['chest'], this.count(1));
        break;
      case 'bibliotheque':
        if (!round) this.alongWalls(r, ['bookshelf'], this.count(area / 4), 2);
        if (r.w >= 4 && r.h >= 4) this.place(r, 'table', c.x, c.y, r.w >= r.h ? 0 : 90);
        this.scatter(r, ['chair'], this.count(1));
        break;
      case 'tresor': {
        this.alongWalls(r, ['chest'], Math.max(1, this.count(3)));
        this.scatter(r, ['treasure', 'treasure', 'chest'], this.count(2));
        if (rng.chance(0.5)) this.scatter(r, ['trap'], 1);
        break;
      }
      case 'temple': {
        const side = this.backSide(r);
        const m = this.sideMid(r, side, 2);
        this.placeAgainst(r, 'altar', m.x, m.y, side);
        if (!round && r.shape !== 'pillared' && r.w >= 6 && r.h >= 6) this.pillars(r);
        this.alongWalls(r, ['statue'], this.count(2));
        this.alongWalls(r, ['brazier'], rng.chance(this.lightP) ? 2 : 0);
        break;
      }
      case 'crypte': {
        const horiz = r.w >= r.h;
        if (!round) {
          for (let k = 1; k < (horiz ? r.w : r.h) - 1; k += 2) {
            if (!rng.chance(0.75 * this.density + 0.2)) continue;
            const x = horiz ? r.x + k + 0.5 : r.x + r.w / 2;
            const y = horiz ? r.y + r.h / 2 : r.y + k + 0.5;
            this.place(r, 'sarcophagus', x, y, horiz ? 0 : 90);
          }
        } else this.place(r, 'sarcophagus', c.x, c.y, 0);
        this.scatter(r, ['bones', 'bones', 'rubble'], this.count(area / 20));
        this.alongWalls(r, ['web'], this.count(1));
        break;
      }
      case 'trone': {
        const side = this.backSide(r);
        const m = this.sideMid(r, side, 1);
        const vertical = side % 2 === 0;
        const len = Math.min(vertical ? r.h - 2 : r.w - 2, 5);
        if (len >= 2) {
          const rx = side === 1 ? r.x + r.w - 1 - len / 2 : side === 3 ? r.x + 1 + len / 2 : m.x + 0.5;
          const ry = side === 0 ? r.y + 1 + len / 2 : side === 2 ? r.y + r.h - 1 - len / 2 : m.y + 0.5;
          this.map.props.push({ id: uid(), kind: 'rug', x: rx, y: ry, w: 2, h: len, rot: vertical ? 0 : 90, gmOnly: false });
        }
        this.placeAgainst(r, 'throne', m.x, m.y, side);
        if (r.shape !== 'pillared') this.pillars(r);
        this.alongWalls(r, ['brazier', 'statue'], this.count(3));
        break;
      }
      case 'rituel':
        if (r.w >= 5 && r.h >= 5) this.place(r, 'runeCircle', c.x, c.y, 0);
        else this.place(r, 'altar', c.x, c.y, 0);
        this.scatter(r, ['bones', 'crystals'], this.count(2));
        if (rng.chance(this.lightP)) this.alongWalls(r, ['brazier'], 2);
        break;
      case 'fontaine':
        if (r.w >= 5 && r.h >= 5) this.place(r, 'fountain', c.x, c.y, 0);
        else this.place(r, 'well', Math.floor(c.x) + 0.5, Math.floor(c.y) + 0.5, 0);
        this.alongWalls(r, ['bush', 'statue'], this.count(2));
        break;
      case 'cuisine':
        if (r.w >= 4 && r.h >= 4) this.place(r, 'table', c.x, c.y, r.w >= r.h ? 0 : 90);
        this.alongWalls(r, ['barrel', 'crate'], this.count(area / 8));
        this.scatter(r, ['campfire'], rng.chance(this.lightP) ? 1 : 0);
        break;
      case 'repaire':
        this.scatter(r, ['bones', 'bones', 'rubble', 'boulder'], this.count(area / 10));
        if (rng.chance(this.lightP)) this.scatter(r, ['campfire'], 1);
        this.alongWalls(r, ['web', 'chest'], this.count(1.5));
        break;
      // --- Bâtiments de village
      case 'maison':
        this.alongWalls(r, ['bed'], 1, 2);
        this.tableWithChairs(r);
        this.alongWalls(r, ['chest', 'barrel', 'bookshelf', 'crate'], this.count(2));
        break;
      case 'chambre':
        this.alongWalls(r, ['bed'], area >= 16 ? 2 : 1, 2);
        this.alongWalls(r, ['chest'], 1);
        if (area >= 16) this.alongWalls(r, ['bookshelf', 'chair'], this.count(1));
        break;
      case 'taverne': {
        const side = this.backSide(r);
        const m = this.sideMid(r, side, 2);
        this.placeAgainst(r, 'table', m.x, m.y, side);
        for (let y = r.y + 1; y + 2 <= r.y + r.h - 1; y += 3)
          for (let x = r.x + 1; x + 2 <= r.x + r.w - 1; x += 3) {
            if (!this.place(r, 'tableRound', x + 1, y + 1, 0)) this.place(r, 'table', x + 1, y + 0.5, 0);
          }
        this.alongWalls(r, ['barrel', 'barrel', 'crate'], this.count(3));
        if (rng.chance(this.lightP + 0.3)) this.alongWalls(r, ['brazier'], 1);
        break;
      }
      case 'forge':
        this.alongWalls(r, ['brazier'], 1);
        this.place(r, 'anvil', Math.floor(c.x) + 0.5, Math.floor(c.y) + 0.35, 0);
        this.alongWalls(r, ['barrel', 'crate', 'table'], this.count(3));
        break;
      case 'echoppe':
        this.alongWalls(r, ['bookshelf'], this.count(area / 6), 2);
        this.tableWithChairs(r, false);
        this.alongWalls(r, ['crate', 'barrel', 'chest'], this.count(2));
        break;
      case 'chapelle': {
        const side = this.backSide(r);
        const m = this.sideMid(r, side, 2);
        this.placeAgainst(r, 'altar', m.x, m.y, side);
        this.pews(r, side);
        this.alongWalls(r, ['statue'], this.count(2));
        if (rng.chance(this.lightP + 0.2)) this.alongWalls(r, ['brazier'], 2);
        break;
      }
      case 'grange':
        if (area >= 30) this.place(r, 'cart', c.x, c.y, rng.chance(0.5) ? 0 : 90);
        this.scatter(r, ['haystack', 'haystack', 'barrel'], this.count(area / 7));
        this.alongWalls(r, ['crate', 'barrel'], this.count(2));
        break;
      case 'entrepot':
        this.alongWalls(r, ['crate', 'barrel', 'crate'], this.count(area / 4));
        this.scatter(r, ['crate', 'barrel'], this.count(2));
        break;
    }
    // Torches murales
    const hasLight = this.map.props.some((p) => (p.kind === 'brazier' || p.kind === 'campfire') && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    if (!hasLight && rng.chance(this.lightP)) {
      const spots = rng.shuffle(this.wallSpots(r));
      const n = area > 40 ? 2 : 1;
      const used = new Set<number>();
      for (const s of spots) {
        if (used.size >= n) break;
        if (used.has(s.side)) continue;
        used.add(s.side);
        this.torch(s);
      }
    }
  }
}
