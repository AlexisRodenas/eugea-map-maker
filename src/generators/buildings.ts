// Bâtiments réalistes : pièces selon la fonction (taverne, maison, forge, échoppe, chapelle,
// grange, entrepôt), mobilier adossé aux murs et orienté, abords extérieurs, étage optionnel.
// Repère local : u le long de la façade (0..w), v en profondeur depuis la rue (0..d).
import { DungeonMap, EDGE, Prop, T } from '../model';
import { PROP_BY_KIND } from '../props';
import { Rng, uid } from '../util';

export type BuildingKind = 'maison' | 'taverne' | 'forge' | 'echoppe' | 'chapelle' | 'grange' | 'entrepot';

export interface Building {
  x: number;
  y: number;
  w: number; // largeur le long de la rue
  d: number; // profondeur
  front: number; // côté donnant sur la rue : 0=N 1=E 2=S 3=O
  kind: BuildingKind;
  floors: number; // 1 ou 2
}

/** Pièce en coordonnées locales (cases, bornes hautes exclues). */
interface Room {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

type Face = [number, number];
const TO_STREET: Face = [0, -1];
const TO_BACK: Face = [0, 1];
const TO_RIGHT: Face = [1, 0];
const TO_LEFT: Face = [-1, 0];

/** Passage local -> monde pour un bâtiment. */
export class Frame {
  constructor(
    public b: Building,
    public map: DungeonMap,
  ) {}
  get horiz(): boolean {
    return this.b.front === 0 || this.b.front === 2;
  }
  /** Emprise dans le monde. */
  get bw(): number {
    return this.horiz ? this.b.w : this.b.d;
  }
  get bh(): number {
    return this.horiz ? this.b.d : this.b.w;
  }
  cell(u: number, v: number): [number, number] {
    const b = this.b;
    return b.front === 2 ? [b.x + u, b.y + this.bh - 1 - v] : b.front === 0 ? [b.x + u, b.y + v] : b.front === 1 ? [b.x + this.bw - 1 - v, b.y + u] : [b.x + v, b.y + u];
  }
  /** Point local continu -> monde. */
  pt(lu: number, lv: number): [number, number] {
    const b = this.b;
    switch (b.front) {
      case 0:
        return [b.x + lu, b.y + lv];
      case 2:
        return [b.x + lu, b.y + this.bh - lv];
      case 1:
        return [b.x + this.bw - lv, b.y + lu];
      default:
        return [b.x + lv, b.y + lu];
    }
  }
  /** Rotation (degrés) qui tourne le devant d'un objet (+y) vers la direction locale `f`. */
  rot(f: Face): number {
    const [x0, y0] = this.pt(0, 0),
      [x1, y1] = this.pt(f[0], f[1]);
    const a = Math.round((Math.atan2(-(x1 - x0), y1 - y0) * 180) / Math.PI);
    return ((a % 360) + 360) % 360;
  }
  /** Arête entre les profondeurs v-1 et v, à la position u (v = 0 : façade, v = d : fond). */
  depthEdge(u: number, v: number, val: number): void {
    const b = this.b,
      m = this.map;
    if (b.front === 2) m.setHEdge(b.x + u, b.y + this.bh - v, val);
    else if (b.front === 0) m.setHEdge(b.x + u, b.y + v, val);
    else if (b.front === 1) m.setVEdge(b.x + this.bw - v, b.y + u, val);
    else m.setVEdge(b.x + v, b.y + u, val);
  }
  /** Arête entre u-1 et u, à la profondeur v (u = 0 : mur gauche, u = w : mur droit). */
  sideEdge(u: number, v: number, val: number): void {
    const b = this.b,
      m = this.map;
    if (b.front === 2) m.setVEdge(b.x + u, b.y + this.bh - 1 - v, val);
    else if (b.front === 0) m.setVEdge(b.x + u, b.y + v, val);
    else if (b.front === 1) m.setHEdge(b.x + this.bw - 1 - v, b.y + u, val);
    else m.setHEdge(b.x + v, b.y + u, val);
  }
  floor(room: Room, t: number): void {
    for (let v = room.v0; v < room.v1; v++)
      for (let u = room.u0; u < room.u1; u++) {
        const [x, y] = this.cell(u, v);
        this.map.set(x, y, t);
      }
  }
  /** Cloison à la profondeur v (de u0 à u1), avec une porte en `door` (ou aucune si < 0). */
  wallAcross(v: number, u0: number, u1: number, door: number): void {
    for (let u = u0; u < u1; u++) this.depthEdge(u, v, u === door ? EDGE.DOOR : EDGE.WALL);
  }
  /** Cloison à la position u (de v0 à v1), avec une porte en `door`. */
  wallAlong(u: number, v0: number, v1: number, door: number): void {
    for (let v = v0; v < v1; v++) this.sideEdge(u, v, v === door ? EDGE.DOOR : EDGE.WALL);
  }
}

/** Pose des meubles sans chevauchement, dans le repère local d'un bâtiment. */
class Furnisher {
  private used: Room[] = [];
  constructor(
    public f: Frame,
    public rng: Rng,
    public props: Prop[],
    public density: number,
  ) {}

  reserve(r: Room): void {
    this.used.push(r);
  }

  private free(r: Room): boolean {
    const e = 0.02;
    if (r.u0 < -e || r.v0 < -e || r.u1 > this.f.b.w + e || r.v1 > this.f.b.d + e) return false;
    return !this.used.some((o) => r.u0 < o.u1 - e && o.u0 < r.u1 - e && r.v0 < o.v1 - e && o.v0 < r.v1 - e);
  }

  /** Objet centré en (cu, cv), devant tourné vers `face`. Renvoie l'objet posé ou null. */
  put(kind: string, cu: number, cv: number, face: Face, size?: { w: number; h: number }, force = false): Prop | null {
    const def = PROP_BY_KIND[kind];
    if (!def) return null;
    const w = size?.w ?? def.w,
      h = size?.h ?? def.h;
    const along = face[1] !== 0; // devant vers ±v : la largeur de l'objet suit u
    const lw = along ? w : h,
      lh = along ? h : w;
    const r = { u0: cu - lw / 2, v0: cv - lh / 2, u1: cu + lw / 2, v1: cv + lh / 2 };
    if (!force && !this.free(r)) return null;
    this.used.push(r);
    const [x, y] = this.f.pt(cu, cv);
    const p: Prop = { id: uid(), kind, x: +x.toFixed(3), y: +y.toFixed(3), w, h, rot: this.f.rot(face), gmOnly: false };
    this.props.push(p);
    return p;
  }

  /** Objet adossé à un mur de la pièce, dos au mur, à la position `t` (0..1) le long du mur. */
  wall(kind: string, room: Room, side: 'front' | 'back' | 'left' | 'right', t: number, size?: { w: number; h: number }): Prop | null {
    const def = PROP_BY_KIND[kind];
    if (!def) return null;
    const w = size?.w ?? def.w,
      h = size?.h ?? def.h;
    const gap = 0.04;
    if (side === 'back' || side === 'front') {
      const span = room.u1 - room.u0 - w;
      if (span < 0) return null;
      const cu = room.u0 + w / 2 + span * t;
      return side === 'back' ? this.put(kind, cu, room.v1 - h / 2 - gap, TO_STREET, { w, h }) : this.put(kind, cu, room.v0 + h / 2 + gap, TO_BACK, { w, h });
    }
    const span = room.v1 - room.v0 - w;
    if (span < 0) return null;
    const cv = room.v0 + w / 2 + span * t;
    return side === 'left' ? this.put(kind, room.u0 + h / 2 + gap, cv, TO_RIGHT, { w, h }) : this.put(kind, room.u1 - h / 2 - gap, cv, TO_LEFT, { w, h });
  }

  /** Essaie plusieurs positions le long des murs indiqués. */
  wallAny(kind: string, room: Room, sides: ('front' | 'back' | 'left' | 'right')[], size?: { w: number; h: number }): Prop | null {
    for (const side of this.rng.shuffle([...sides]))
      for (const t of this.rng.shuffle([0.5, 0.2, 0.8, 0, 1, 0.35, 0.65])) {
        const p = this.wall(kind, room, side, t, size);
        if (p) return p;
      }
    return null;
  }

  /** Remplit un coin ou un bord libre avec du petit stockage (tonneaux, caisses, sacs). */
  clutter(room: Room, n: number, kinds = ['barrel', 'crate', 'sacks']): void {
    for (let k = 0; k < Math.round(n * this.density); k++) {
      const kind = this.rng.pick(kinds);
      const corner = this.rng.int(0, 3);
      const cu = corner % 2 ? room.u1 - 0.5 : room.u0 + 0.5,
        cv = corner < 2 ? room.v1 - 0.5 : room.v0 + 0.5;
      for (let d = 0; d < 3; d++) {
        const du = (corner % 2 ? -1 : 1) * d * this.rng.float(0.8, 1),
          dv = (corner < 2 ? -1 : 1) * (d === 0 ? 0 : this.rng.float(0, 0.9));
        if (this.put(kind, cu + du, cv + dv, TO_STREET, { w: 0.9, h: 0.9 })) break;
      }
    }
  }

  /** Table avec chaises tout autour (rectangulaire) ou bancs (longue table). */
  tableSet(cu: number, cv: number, long: boolean, benches: boolean): boolean {
    const tw = long ? 3 : 2,
      th = 1;
    if (!this.free({ u0: cu - tw / 2 - 0.8, v0: cv - th / 2 - 0.8, u1: cu + tw / 2 + 0.8, v1: cv + th / 2 + 0.8 })) return false;
    this.put('table', cu, cv, TO_STREET, { w: tw, h: th }, true);
    if (benches) {
      this.put('bench', cu, cv - th / 2 - 0.35, TO_BACK, { w: tw, h: 0.55 }, true);
      this.put('bench', cu, cv + th / 2 + 0.35, TO_STREET, { w: tw, h: 0.55 }, true);
    } else {
      for (let k = 0; k < tw; k++) {
        const u = cu - tw / 2 + 0.5 + k;
        this.put('chair', u, cv - th / 2 - 0.35, TO_BACK, { w: 0.7, h: 0.7 }, true);
        this.put('chair', u, cv + th / 2 + 0.35, TO_STREET, { w: 0.7, h: 0.7 }, true);
      }
    }
    if (this.rng.chance(0.6)) this.put('candelabra', cu + this.rng.float(-0.4, 0.4), cv, TO_STREET, { w: 0.45, h: 0.45 }, true);
    return true;
  }

  /** Table (chaises ou bancs) au plus près de (cu, cv), dans la pièce. */
  tableNear(room: Room, cu: number, cv: number, long: boolean, benches: boolean): boolean {
    const spots: [number, number][] = [];
    for (let v = room.v0 + 1.4; v <= room.v1 - 1.4; v += 0.5) for (let u = room.u0 + 1.6; u <= room.u1 - 1.6; u += 0.5) spots.push([u, v]);
    spots.sort((a, b) => Math.hypot(a[0] - cu, a[1] - cv) - Math.hypot(b[0] - cu, b[1] - cv));
    for (const [u, v] of spots) if (this.tableSet(u, v, long, benches)) return true;
    if (long) return this.tableNear(room, cu, cv, false, benches);
    return false;
  }

  /** Table ronde (avec ses chaises dessinées). */
  roundTable(cu: number, cv: number): boolean {
    if (!this.free({ u0: cu - 1.1, v0: cv - 1.1, u1: cu + 1.1, v1: cv + 1.1 })) return false;
    this.put('tableRound', cu, cv, TO_STREET, { w: 2, h: 2 }, true);
    return true;
  }
}

// ---------- Aménagements par type ----------

interface Ctx {
  f: Frame;
  fu: Furnisher;
  rng: Rng;
  b: Building;
  /** Porte de façade (u). */
  du: number;
  /** Position locale de l'escalier (pour l'étage), ou null. */
  stairs: { u: number; v: number; face: Face } | null;
}


/** Escalier dans un coin du fond de la pièce, contre un mur latéral. */
function placeStairs(c: Ctx, room: Room): void {
  const left = c.rng.chance(0.5);
  const u = left ? room.u0 + 0.5 : room.u1 - 0.5;
  const v = room.v1 - 1;
  if (c.fu.put('stairs', u, v, TO_STREET, { w: 1, h: 2 })) c.stairs = { u, v, face: TO_STREET };
}

function maison(c: Ctx): void {
  const { f, fu, rng, b } = c;
  const sv = b.d >= 6 ? Math.ceil(b.d * 0.55) : b.d;
  const hall: Room = { u0: 0, v0: 0, u1: b.w, v1: sv };
  f.floor({ u0: 0, v0: 0, u1: b.w, v1: b.d }, T.WOOD);
  fu.reserve({ u0: c.du - 0.1, v0: 0, u1: c.du + 1.1, v1: 1.3 }); // passage de la porte
  // salle commune : cheminée sur un côté, table au centre, rangements
  const hearthLeft = rng.chance(0.5);
  fu.wall('fireplace', hall, hearthLeft ? 'left' : 'right', 0.5, { w: 2, h: 0.9 });
  if (c.b.floors > 1) placeStairs(c, hall);
  fu.tableNear(hall, b.w / 2 + (hearthLeft ? 0.4 : -0.4), Math.max(1.6, sv / 2), b.w >= 7, rng.chance(0.5));
  fu.wallAny('shelf', hall, ['back', hearthLeft ? 'right' : 'left'], { w: 1.6, h: 0.45 });
  fu.wallAny(rng.pick(['worktable', 'cauldron']), hall, ['front', 'back']);
  fu.clutter(hall, 2);
  if (sv < b.d) {
    // chambre(s) au fond
    const back: Room = { u0: 0, v0: sv, u1: b.w, v1: b.d };
    if (b.w >= 8) {
      const su = Math.floor(b.w / 2);
      f.wallAcross(sv, 0, b.w, rng.int(1, su - 2));
      f.wallAlong(su, sv, b.d, rng.int(sv, b.d - 1));
      bedroom(c, { u0: 0, v0: sv, u1: su, v1: b.d }, rng.chance(0.5));
      // réserve
      const pan: Room = { u0: su, v0: sv, u1: b.w, v1: b.d };
      fu.wallAny('shelf', pan, ['back', 'right'], { w: 1.6, h: 0.45 });
      fu.clutter(pan, 4, ['barrel', 'sacks', 'crate', 'sacks']);
    } else {
      f.wallAcross(sv, 0, b.w, rng.int(1, b.w - 2));
      bedroom(c, back, b.w >= 6);
    }
  }
}

function bedroom(c: Ctx, room: Room, double: boolean): void {
  const { fu, rng } = c;
  const bed = double ? fu.wall('bedDouble', room, 'back', rng.float(0.2, 0.8), { w: 2, h: 2 }) : fu.wall('bed', room, 'back', rng.float(0.1, 0.9), { w: 1, h: 2 });
  if (!bed) fu.wallAny('bed', room, ['left', 'right'], { w: 1, h: 2 });
  if (!double && room.u1 - room.u0 >= 4) fu.wall('bed', room, 'back', rng.chance(0.5) ? 0 : 1, { w: 1, h: 2 });
  fu.wallAny('wardrobe', room, ['left', 'right', 'front'], { w: 1.4, h: 0.65 });
  fu.wallAny('chest', room, ['back', 'left', 'right'], { w: 0.9, h: 0.9 });
  if (rng.chance(0.5)) fu.put('rug', (room.u0 + room.u1) / 2, (room.v0 + room.v1) / 2, TO_STREET, { w: 1.6, h: 1.2 });
}

function taverne(c: Ctx): void {
  const { f, fu, rng, b } = c;
  const kd = Math.min(3, Math.max(2, Math.floor(b.d * 0.33)));
  const sv = b.d - kd;
  const hall: Room = { u0: 0, v0: 0, u1: b.w, v1: sv };
  f.floor(hall, T.WOOD);
  const kw = Math.ceil(b.w * 0.55);
  const kitchen: Room = { u0: 0, v0: sv, u1: kw, v1: b.d };
  const store: Room = { u0: kw, v0: sv, u1: b.w, v1: b.d };
  f.floor(kitchen, T.TILES);
  f.floor(store, T.WOOD);
  // cloisons : salle / cuisine / réserve
  const counterLen = Math.min(5, b.w - 4);
  const cu0 = b.w - 1 - counterLen; // le comptoir longe la cloison du fond, côté réserve
  f.wallAcross(sv, 0, b.w, Math.max(1, Math.min(kw - 2, Math.floor(kw / 2))));
  f.wallAlong(kw, sv, b.d, sv + Math.floor(kd / 2));
  fu.reserve({ u0: c.du - 0.1, v0: 0, u1: c.du + 1.1, v1: 1.6 });
  // comptoir avec tabourets ; derrière : étagère à bouteilles et tonneaux couchés
  fu.put('counter', cu0 + counterLen / 2, sv - 1.5, TO_STREET, { w: counterLen, h: 0.8 });
  fu.put('shelf', cu0 + counterLen / 2, sv - 0.3, TO_STREET, { w: Math.min(counterLen, 3), h: 0.45 });
  fu.put('cask', cu0 + counterLen - 0.7, sv - 0.6, TO_STREET, { w: 1.2, h: 0.75 });
  fu.reserve({ u0: cu0, v0: sv - 1.1, u1: cu0 + counterLen, v1: sv });
  for (let k = 0; k < counterLen - 0.5; k += 1) fu.put('stool', cu0 + 0.5 + k, sv - 2.35, TO_BACK, { w: 0.5, h: 0.5 });
  // cheminée sur un mur latéral ; escalier contre la façade, du côté opposé à la porte
  const hearthLeft = cu0 > 2;
  if (c.b.floors > 1) {
    const left = c.du > b.w / 2;
    const u = left ? 1 : b.w - 1;
    for (const v of [0.6, 1.1, 1.6]) {
      if (fu.put('stairs', u, v, left ? TO_RIGHT : TO_LEFT, { w: 1, h: 2 })) {
        c.stairs = { u, v, face: left ? TO_RIGHT : TO_LEFT };
        break;
      }
    }
  }
  fu.wall('fireplace', hall, hearthLeft ? 'left' : 'right', 0.35, { w: 2, h: 0.9 });
  // tables : rondes et longues, réparties dans la salle
  const spots: [number, number][] = [];
  for (let v = 1.6; v < sv - 2.6; v += 2.6) for (let u = 1.7; u < b.w - 1.5; u += 2.8) spots.push([u, v]);
  for (const [u, v] of rng.shuffle(spots)) {
    if (rng.chance(0.15)) continue;
    if (!(rng.chance(0.55) ? fu.roundTable(u, v) : fu.tableSet(u, v, rng.chance(0.4), rng.chance(0.5)))) fu.roundTable(u + 0.3, v + 0.3);
  }
  if (rng.chance(0.7)) fu.put('rug', b.w / 2, sv / 2, TO_STREET, { w: Math.min(3, b.w / 3), h: 2 });
  fu.wallAny('candelabra', hall, ['left', 'right'], { w: 0.45, h: 0.45 });
  // cuisine
  fu.wall('oven', kitchen, 'back', 0, { w: 1.4, h: 1.4 });
  fu.wall('worktable', kitchen, 'back', 0.85, { w: 1.8, h: 0.85 });
  fu.wallAny('cauldron', kitchen, ['left', 'back'], { w: 0.9, h: 0.9 });
  fu.wallAny('shelf', kitchen, ['left', 'front'], { w: 1.6, h: 0.45 });
  fu.clutter(kitchen, 2, ['barrel', 'sacks']);
  // réserve
  fu.wallAny('cask', store, ['back', 'right'], { w: 1.2, h: 0.75 });
  fu.clutter(store, 5, ['barrel', 'barrel', 'crate', 'sacks']);
}

function forge(c: Ctx): void {
  const { f, fu, rng, b } = c;
  const sv = b.d >= 6 ? b.d - 2 : b.d;
  const shop: Room = { u0: 0, v0: 0, u1: b.w, v1: sv };
  f.floor(shop, T.STONE);
  // atelier ouvert sur la rue : deux portes côte à côte
  f.depthEdge(Math.min(b.w - 2, c.du + 1), 0, EDGE.DOOR);
  fu.reserve({ u0: c.du - 0.1, v0: 0, u1: c.du + 2.1, v1: 1.4 });
  const fl = rng.chance(0.5);
  if (!fu.wall('forge', shop, fl ? 'left' : 'right', 0.7, { w: 1.5, h: 1.5 })) fu.wall('forge', shop, 'back', 0.2, { w: 1.5, h: 1.5 });
  // enclume au milieu de l'atelier, tonneau d'eau pour la trempe
  fu.put('anvil', b.w / 2 + (fl ? -0.6 : 0.6), Math.max(1.8, sv / 2), TO_STREET, { w: 1, h: 0.7 });
  fu.put('barrel', b.w / 2 + (fl ? -1.8 : 1.8), Math.max(1.8, sv / 2) + 0.6, TO_STREET, { w: 0.8, h: 0.8 });
  fu.wallAny('weaponRack', shop, ['back', fl ? 'right' : 'left'], { w: 1.6, h: 0.5 });
  fu.wallAny('workbench', shop, ['back', fl ? 'right' : 'left'], { w: 1.8, h: 0.85 });
  fu.clutter(shop, 2, ['sacks', 'crate', 'barrel']);
  if (sv < b.d) {
    const home: Room = { u0: 0, v0: sv, u1: b.w, v1: b.d };
    f.floor(home, T.WOOD);
    f.wallAcross(sv, 0, b.w, fl ? b.w - 2 : 1);
    fu.wall('bed', home, 'back', fl ? 0.1 : 0.9, { w: 1, h: 2 }) ?? fu.wallAny('bed', home, ['left', 'right'], { w: 1, h: 2 });
    fu.wallAny('chest', home, ['back', 'left', 'right'], { w: 0.9, h: 0.9 });
    fu.wallAny('table', home, ['back'], { w: 1.6, h: 0.8 });
  }
}

function echoppe(c: Ctx): void {
  const { f, fu, rng, b } = c;
  const sv = b.d >= 6 ? Math.ceil(b.d * 0.6) : b.d;
  const shop: Room = { u0: 0, v0: 0, u1: b.w, v1: sv };
  f.floor(shop, T.WOOD);
  fu.reserve({ u0: c.du - 0.1, v0: 0, u1: c.du + 1.1, v1: 1.4 });
  // comptoir en travers, marchand derrière ; étagères le long des murs
  const cl = Math.max(2, b.w - 3);
  fu.put('counter', b.w / 2 + (c.du < b.w / 2 ? 0.7 : -0.7), sv - 1.6, TO_STREET, { w: cl, h: 0.75 });
  fu.wall('shelf', shop, 'back', 0.5, { w: Math.min(3, b.w - 1), h: 0.45 });
  fu.wall('shelf', shop, 'left', 0.25, { w: 1.6, h: 0.45 });
  fu.wall('shelf', shop, 'right', 0.25, { w: 1.6, h: 0.45 });
  for (const t of [0.2, 0.8]) if (rng.chance(0.7)) fu.wall(rng.pick(['crate', 'sacks', 'barrel']), shop, 'front', t, { w: 0.9, h: 0.9 });
  if (b.floors > 1) placeStairs(c, shop);
  if (sv < b.d) {
    const store: Room = { u0: 0, v0: sv, u1: b.w, v1: b.d };
    f.floor(store, T.WOOD);
    f.wallAcross(sv, 0, b.w, rng.int(1, b.w - 2));
    if (b.floors > 1 || rng.chance(0.5)) {
      fu.wallAny('shelf', store, ['back', 'left', 'right'], { w: 1.6, h: 0.45 });
      fu.clutter(store, 6, ['crate', 'crate', 'sacks', 'barrel']);
    } else bedroom(c, store, false);
  }
}

function chapelle(c: Ctx): void {
  const { f, fu, rng, b } = c;
  const nave: Room = { u0: 0, v0: 0, u1: b.w, v1: b.d };
  f.floor(nave, T.STONE);
  // allée centrale (tapis) de la porte à l'autel
  const mid = b.w / 2;
  c.du = Math.floor(mid - 0.5);
  for (let v = 0; v < b.d - 2; v++) {
    const [x, y] = f.cell(Math.floor(mid - 0.5), v);
    f.map.set(x, y, T.CARPET);
    if (b.w % 2 === 0) {
      const [x2, y2] = f.cell(Math.floor(mid), v);
      f.map.set(x2, y2, T.CARPET);
    }
  }
  fu.reserve({ u0: mid - 0.9, v0: 0, u1: mid + 0.9, v1: b.d - 2.4 });
  // autel au fond, chandeliers, statue, lutrin
  fu.put('altar', mid, b.d - 1.3, TO_STREET, { w: 2, h: 1 });
  for (const s of [-1, 1]) fu.put('candelabra', mid + s * 1.5, b.d - 1.3, TO_STREET, { w: 0.5, h: 0.5 });
  if (b.w >= 7) for (const s of [-1, 1]) fu.put('statue', mid + s * (b.w / 2 - 0.7), b.d - 0.7, TO_STREET, { w: 1, h: 1 });
  fu.put('lectern', mid + 1.6, b.d - 2.7, TO_LEFT, { w: 0.7, h: 0.7 });
  // bancs de part et d'autre de l'allée, face à l'autel
  const pw = Math.max(1.5, mid - 1.2);
  for (let v = 1.6; v < b.d - 3.2; v += 1.3) for (const s of [-1, 1]) fu.put('pew', mid + s * (pw / 2 + 0.9), v, TO_BACK, { w: pw, h: 0.7 });
  void rng;
}

function grange(c: Ctx): void {
  const { f, fu, rng, b } = c;
  const all: Room = { u0: 0, v0: 0, u1: b.w, v1: b.d };
  f.floor(all, T.DIRT);
  f.depthEdge(Math.min(b.w - 2, c.du + 1), 0, EDGE.DOOR);
  fu.reserve({ u0: c.du - 0.1, v0: 0, u1: c.du + 2.1, v1: b.d - 2.5 });
  // stalles le long d'un mur latéral
  const left = c.du > b.w / 2;
  const su = left ? 0 : b.w;
  for (let v = 1; v < b.d - 1; v += 2) {
    const cu = left ? su + 1.1 : su - 1.1;
    fu.put('fence', cu, v + 1, TO_STREET, { w: 2, h: 0.3 });
    if (rng.chance(0.5)) fu.put('haystack', cu, v + 0.5, TO_STREET, { w: 0.8, h: 0.8 });
  }
  fu.wallAny('trough', all, [left ? 'left' : 'right', 'back'], { w: 1.8, h: 0.55 });
  for (let k = 0; k < 4; k++) fu.wallAny('haystack', all, ['back', left ? 'right' : 'left'], { w: 1, h: 1 });
  fu.put('cart', b.w / 2, b.d / 2, TO_STREET, { w: 1.6, h: 2.4 });
  fu.wallAny('ladder', all, ['back'], { w: 0.6, h: 1 });
  fu.clutter(all, 3, ['sacks', 'barrel']);
}

function entrepot(c: Ctx): void {
  const { f, fu, rng, b } = c;
  const all: Room = { u0: 0, v0: 0, u1: b.w, v1: b.d };
  f.floor(all, T.WOOD);
  f.depthEdge(Math.min(b.w - 2, c.du + 1), 0, EDGE.DOOR);
  fu.reserve({ u0: c.du - 0.1, v0: 0, u1: c.du + 2.1, v1: b.d - 1 });
  // rangées de marchandises avec allées
  for (let v = 1; v < b.d - 0.5; v += 1)
    for (let u = 0.5; u < b.w; u += 1) {
      if (Math.abs(u - (c.du + 1)) < 1.5) continue;
      if (rng.chance(0.55 * fu.density + 0.2)) fu.put(rng.pick(['crate', 'crate', 'barrel', 'sacks']), u, v, TO_STREET, { w: 0.9, h: 0.9 });
    }
  fu.wallAny('shelf', all, ['left', 'right'], { w: 1.8, h: 0.45 });
}

// ---------- Étage ----------

/** Étage d'un bâtiment (sur le niveau courant de la carte) : chambres, palier, escalier. */
function upperFloor(c: Ctx): void {
  const { f, fu, rng, b } = c;
  const all: Room = { u0: 0, v0: 0, u1: b.w, v1: b.d };
  f.floor(all, T.WOOD);
  if (c.stairs) fu.put('stairs', c.stairs.u, c.stairs.v, c.stairs.face, { w: 1, h: 2 }, true);
  const su = c.stairs?.u ?? 0.5;
  if (b.kind === 'taverne' && b.w >= 6) {
    // couloir le long du mur de l'escalier, chambres en enfilade de l'autre côté
    const left = su < b.w / 2;
    const cw = 2;
    const wu = left ? cw : b.w - cw;
    fu.reserve(left ? { u0: 0, v0: 0, u1: cw, v1: b.d } : { u0: b.w - cw, v0: 0, u1: b.w, v1: b.d });
    const n = Math.max(2, Math.floor(b.d / 3));
    const rh = b.d / n;
    for (let k = 0; k < n; k++) {
      const v0 = Math.round(k * rh),
        v1 = Math.round((k + 1) * rh);
      if (k > 0) f.wallAcross(v0, left ? cw : 0, left ? b.w : b.w - cw, -1);
      for (let v = v0; v < v1; v++) f.sideEdge(wu, v, v === v0 + Math.floor((v1 - v0) / 2) ? EDGE.DOOR : EDGE.WALL);
      const room: Room = left ? { u0: cw, v0, u1: b.w, v1 } : { u0: 0, v0, u1: b.w - cw, v1 };
      const bed = fu.wall('bed', room, left ? 'right' : 'left', rng.float(0, 1), { w: 1, h: 2 }) ?? fu.wallAny('bed', room, ['front', 'back'], { w: 1, h: 2 });
      void bed;
      if (room.u1 - room.u0 >= 5) fu.wallAny('bed', room, ['front', 'back'], { w: 1, h: 2 });
      fu.wallAny('chest', room, ['front', 'back', left ? 'right' : 'left'], { w: 0.8, h: 0.8 });
      fu.wallAny(rng.chance(0.5) ? 'wardrobe' : 'desk', room, ['front', 'back'], { w: 1.3, h: 0.65 });
      if (rng.chance(0.6)) fu.wallAny('candelabra', room, ['front', 'back'], { w: 0.4, h: 0.4 });
    }
    return;
  }
  // maison, échoppe : palier côté escalier, une ou deux chambres
  const split = b.w >= 7;
  const landing = Math.min(b.w - 3, 2);
  const stairsLeft = su < b.w / 2;
  const lu0 = stairsLeft ? 0 : b.w - landing,
    lu1 = lu0 + landing;
  fu.reserve({ u0: lu0, v0: 0, u1: lu1, v1: b.d });
  const rest: Room = stairsLeft ? { u0: lu1, v0: 0, u1: b.w, v1: b.d } : { u0: 0, v0: 0, u1: lu0, v1: b.d };
  const wu = stairsLeft ? lu1 : lu0;
  if (split && rest.u1 - rest.u0 >= 4 && b.d >= 5) {
    // deux chambres, chacune avec sa porte sur le palier
    const mv = Math.floor(b.d / 2);
    f.wallAcross(mv, rest.u0, rest.u1, -1);
    const da = Math.floor(mv / 2),
      db = mv + Math.floor((b.d - mv) / 2);
    for (let v = 0; v < b.d; v++) f.sideEdge(wu, v, v === da || v === db ? EDGE.DOOR : EDGE.WALL);
    bedroom(c, { ...rest, v1: mv }, false);
    bedroom(c, { ...rest, v0: mv }, true);
  } else {
    f.wallAlong(wu, 0, b.d, Math.floor(b.d / 2));
    bedroom(c, rest, true);
    fu.wallAny('desk', rest, ['front', 'left', 'right'], { w: 1.5, h: 0.8 });
  }
}

// ---------- Abords ----------

type OutsidePut = (kind: string, x: number, y: number, rot: number, opts?: { w?: number; h?: number }) => boolean;

function outside(c: Ctx, put: OutsidePut): void {
  const { f, rng, b } = c;
  const at = (lu: number, lv: number, kind: string, face: Face, size?: { w?: number; h?: number }) => {
    const [x, y] = f.pt(lu, lv);
    return put(kind, x, y, f.rot(face), size);
  };
  const side = rng.chance(0.5) ? -0.7 : b.w + 0.7;
  const sideFace: Face = side < 0 ? TO_RIGHT : TO_LEFT;
  switch (b.kind) {
    case 'maison':
      if (rng.chance(0.6)) at(b.w / 2, b.d + 1.6, 'garden', TO_STREET, { w: Math.min(4, b.w - 1), h: 2 });
      if (rng.chance(0.6)) at(side, b.d / 2, 'woodpile', sideFace, { w: 1.4, h: 0.7 });
      if (rng.chance(0.5)) at(c.du + 1.8, -0.5, 'plantPot', TO_STREET, { w: 0.5, h: 0.5 });
      if (rng.chance(0.35)) at(side, b.d - 0.8, 'barrel', sideFace, { w: 0.8, h: 0.8 });
      break;
    case 'taverne':
      at(c.du + 1.8, -0.55, 'signpost', TO_STREET, { w: 0.8, h: 0.8 });
      at(side, b.d / 2 - 1, 'trough', sideFace, { w: 1.8, h: 0.55 });
      at(side, b.d / 2 + 1.2, 'barrel', sideFace, { w: 0.8, h: 0.8 });
      if (rng.chance(0.6)) at(side * 1 + (side < 0 ? -1.2 : 1.2), b.d - 1.5, 'cart', TO_STREET);
      break;
    case 'forge':
      at(side, b.d / 2, 'woodpile', sideFace, { w: 1.4, h: 0.7 });
      at(side, b.d - 0.8, 'barrel', sideFace, { w: 0.8, h: 0.8 });
      if (rng.chance(0.5)) at(side + (side < 0 ? -1.3 : 1.3), 1.2, 'cart', TO_STREET);
      break;
    case 'echoppe':
      for (const du of [-1.5, 1.8]) if (rng.chance(0.6)) at(c.du + du, -0.5, rng.pick(['crate', 'sacks', 'plantPot']), TO_STREET, { w: 0.8, h: 0.8 });
      break;
    case 'chapelle': {
      // petit cimetière sur un côté
      const s = side < 0 ? -1 : 1;
      for (let k = 0; k < 6; k++) at(s < 0 ? -1.2 - (k % 2) * 1.4 : b.w + 1.2 + (k % 2) * 1.4, 1.5 + Math.floor(k / 2) * 1.5, 'gravestone', TO_STREET, { w: 0.9, h: 0.45 });
      break;
    }
    case 'grange':
      at(b.w / 2, b.d + 1.2, 'trough', TO_STREET, { w: 1.8, h: 0.55 });
      at(side, 1.5, 'haystack', sideFace);
      at(side, b.d - 1.5, 'haystack', sideFace);
      break;
    case 'entrepot':
      at(side, 1.5, 'crate', sideFace, { w: 0.9, h: 0.9 });
      at(side, 2.5, 'barrel', sideFace, { w: 0.8, h: 0.8 });
      if (rng.chance(0.6)) at(side + (side < 0 ? -1.3 : 1.3), b.d / 2, 'cart', TO_STREET);
      break;
  }
}

// ---------- Construction ----------

export interface BuiltBuilding {
  /** Porte de façade (case dans le monde, côté rue). */
  door: { x: number; y: number };
  /** Pièce principale (pour l'étiquette). */
  center: [number, number];
  ctx: Ctx;
}

/**
 * Construit un bâtiment sur le niveau courant : sol, porte, fenêtres, cloisons, mobilier
 * (densité 0..1), abords (via `put`, qui gère l'occupation du terrain).
 */
export function buildGround(map: DungeonMap, b: Building, rng: Rng, density: number, put: OutsidePut | null): BuiltBuilding {
  const f = new Frame(b, map);
  const fu = new Furnisher(f, rng, map.props, Math.max(0.2, density));
  const c: Ctx = { f, fu, rng, b, du: rng.int(1, Math.max(1, b.w - 3)), stairs: null };
  if (b.kind === 'chapelle') c.du = Math.floor(b.w / 2 - 0.5);
  // fenêtres sur les murs extérieurs (avant la porte : la porte les remplace au besoin)
  const win = (n: number, k: number) => n > 2 && k > 0 && k < n - 1 && k % 2 === 1;
  for (let u = 0; u < b.w; u++) {
    if (win(b.w, u)) f.depthEdge(u, 0, EDGE.WINDOW);
    if (win(b.w, u) && rng.chance(0.6)) f.depthEdge(u, b.d, EDGE.WINDOW);
  }
  for (let v = 0; v < b.d; v++)
    if (win(b.d, v) && rng.chance(0.7)) {
      f.sideEdge(0, v, EDGE.WINDOW);
      f.sideEdge(b.w, v, EDGE.WINDOW);
    }
  if (density > 0) {
    if (b.kind === 'maison') maison(c);
    else if (b.kind === 'taverne') taverne(c);
    else if (b.kind === 'forge') forge(c);
    else if (b.kind === 'echoppe') echoppe(c);
    else if (b.kind === 'chapelle') chapelle(c);
    else if (b.kind === 'grange') grange(c);
    else entrepot(c);
  } else f.floor({ u0: 0, v0: 0, u1: b.w, v1: b.d }, b.kind === 'grange' ? T.DIRT : T.WOOD);
  // porte d'entrée (après les fenêtres et l'aménagement)
  f.depthEdge(c.du, 0, EDGE.DOOR);
  if (b.d >= 6 && b.kind !== 'chapelle' && rng.chance(0.35)) f.depthEdge(rng.int(1, b.w - 2), b.d, EDGE.DOOR);
  if (put) outside(c, put);
  const [dx, dy] = f.cell(c.du, 0);
  const [cx, cy] = f.pt(b.w / 2, Math.min(b.d / 2, 2.2));
  return { door: { x: dx, y: dy }, center: [cx, cy], ctx: c };
}

/** Étage du bâtiment, sur le niveau courant de la carte (le même repère que le rez-de-chaussée). */
export function buildUpper(map: DungeonMap, built: BuiltBuilding, rng: Rng, density: number): void {
  const old = built.ctx;
  const f = new Frame(old.b, map);
  const c: Ctx = { ...old, f, fu: new Furnisher(f, rng, map.props, Math.max(0.2, density)), rng };
  const b = old.b;
  for (let u = 0; u < b.w; u++) if (u % 2 === 1 && u < b.w - 1) f.depthEdge(u, 0, EDGE.WINDOW);
  for (let v = 1; v < b.d - 1; v += 2) {
    f.sideEdge(0, v, EDGE.WINDOW);
    f.sideEdge(b.w, v, EDGE.WINDOW);
  }
  upperFloor(c);
}
