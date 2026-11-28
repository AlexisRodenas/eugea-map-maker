import { DungeonMap, EDGE, Prop } from './model';
import { Renderer } from './render';
import { mapTheme } from './themes';
import { Seg, simplify, wallSegments } from './geometry';
import { allLights, obstacleSegments } from './lighting';
import { PROP_BY_KIND, assetBox, castsShadow, drawProp, hasCanopy, isRoof, isTile, propAsset, propBounds, propLayer, shadowOffset } from './props';
import { assetImage } from './assets';
import { slugify, toHex } from './util';

export type ImageFormat = 'webp' | 'png' | 'jpeg';

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAX_SIDE = 16384;
const STAIRS = new Set(['stairs', 'spiral', 'ladder', 'trapdoor']);
/** Marge autour des images de tuiles (ombre portée, débords) ; la tuile est agrandie d'autant. */
export const TILE_MARGIN = 0.3;

/** Zone exportée : contenu de tous les niveaux (pour qu'ils restent superposables). */
export function computeCrop(map: DungeonMap, crop: boolean, margin: number): Crop {
  if (!crop) return { x: 0, y: 0, w: map.cols, h: map.rows };
  const b = map.contentBounds(true);
  if (!b) return { x: 0, y: 0, w: map.cols, h: map.rows };
  const x0 = Math.max(0, b.x0 - margin),
    y0 = Math.max(0, b.y0 - margin);
  const x1 = Math.min(map.cols, b.x1 + margin),
    y1 = Math.min(map.rows, b.y1 + margin);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Objets exportés en tuiles Foundry : tous (le fond ne garde que sols, murs, portes, terrain et
 * remparts), seulement ceux marqués « séparés », ou aucun. Les toits et les objets MJ sont
 * toujours des tuiles.
 */
export type TileMode = 'all' | 'separate' | 'none' | 'flat';

export interface ImageOpts {
  ppg: number;
  mode: 'player' | 'gm';
  grid: boolean;
  lighting: boolean;
  /** Objets dessinés à part (tuiles) et donc absents de l'image. */
  tiles: TileMode;
  /** Dessiner les toits dans l'image (jamais pour Foundry : ce sont des tuiles). */
  roofs: boolean;
  /** Fond transparent hors du sol (étages au-dessus du rez-de-chaussée, niveaux natifs V14). */
  transparent?: boolean;
}

/** L'objet devient-il une tuile Foundry ? */
export function isTileFor(p: Prop, mode: TileMode): boolean {
  // « flat » (plans, cartes du monde) : tout est dessiné dans l'image, toits compris
  if (mode === 'flat') return p.gmOnly;
  return isRoof(p) || p.gmOnly || mode === 'all' || (mode === 'separate' && isTile(p));
}

/** Plan de ville ou carte du monde (échelle ≥ 5 m par case) : objets dessinés dans l'image. */
export function isPlanMap(map: DungeonMap): boolean {
  return map.settings.gridUnits === 'km' || map.settings.gridUnits === 'mi' || map.settings.gridDistance >= 5;
}

export function renderLevelImage(map: DungeonMap, index: number, crop: Crop, o: ImageOpts): HTMLCanvasElement {
  const W = Math.round(crop.w * o.ppg),
    H = Math.round(crop.h * o.ppg);
  if (W > MAX_SIDE || H > MAX_SIDE) throw new Error(`Image trop grande (${W}×${H} px). Réduisez les pixels par case.`);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Impossible de créer l'image (mémoire insuffisante ?).");
  const view = map.levelView(index);
  new Renderer().render(ctx, view, mapTheme(map.settings), {
    view: { scale: o.ppg, ox: crop.x, oy: crop.y },
    width: W,
    height: H,
    mode: o.mode,
    grid: o.grid,
    lighting: o.lighting,
    bakeProp: (p) => !(o.tiles !== 'none' && isTileFor(p, o.tiles)) && (o.roofs || o.tiles === 'flat' || !isRoof(p)),
    transparent: o.transparent,
  });
  return canvas;
}

export function mimeOf(f: ImageFormat): string {
  return f === 'png' ? 'image/png' : f === 'jpeg' ? 'image/jpeg' : 'image/webp';
}

export function extOf(f: ImageFormat): string {
  return f === 'jpeg' ? 'jpg' : f;
}

export function canvasToBlob(canvas: HTMLCanvasElement, format: ImageFormat, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Échec de l'encodage de l'image."))), mimeOf(format), quality),
  );
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ---------- Objets séparés (tuiles) ----------

/** Objets exportés en tuiles (voir TileMode), dans l'ordre d'empilement. */
export function tileProps(view: DungeonMap, mode: TileMode = 'all'): Prop[] {
  return view.props.filter((p) => isTileFor(p, mode));
}

export type TilePart = 'all' | 'trunk' | 'canopy';

/** Tuiles d'un objet : une seule, ou deux pour un arbre (tronc au sol, feuillage au-dessus des jetons). */
export function tileParts(view: DungeonMap, p: Prop): TilePart[] {
  return hasCanopy(p, view.settings.skins) ? ['trunk', 'canopy'] : ['all'];
}

/** Image personnelle (chargée) dessinée pour cet objet, ou null. */
export function tileAsset(view: DungeonMap, p: Prop): string | null {
  const id = propAsset(p, view.settings.skins);
  return id && assetImage(id) ? id : null;
}

/** Clé de l'image d'une tuile : l'image personnelle d'origine, ou un rendu de l'objet. */
export function propImageKey(p: Prop, view?: DungeonMap, part: TilePart = 'all'): string {
  const aid = view ? tileAsset(view, p) : null;
  if (aid) return 'asset-' + aid;
  const rand = PROP_BY_KIND[p.kind]?.rand ? '-' + p.id : '';
  // l'ombre est dessinée dans l'image : son sens dépend de la rotation de la tuile
  const rot = castsShadow(p) && (!view || view.settings.shadows !== false) ? `-r${Math.round(p.rot)}` : '';
  return slugify(`${p.kind}${part === 'all' ? '' : '-' + part}-${p.w}x${p.h}${rot}${rand}`);
}

/**
 * Image d'un objet seul, fond transparent, non pivoté (la rotation est portée par la tuile),
 * avec une marge (TILE_MARGIN) pour son ombre portée et ce qui dépasse de sa boîte.
 */
export function renderPropImage(map: DungeonMap, p: Prop, ppg: number, part: TilePart = 'all'): HTMLCanvasElement {
  const only = part === 'all' ? undefined : part;
  const theme = mapTheme(map.settings);
  const m = TILE_MARGIN;
  const W = Math.max(1, Math.round((p.w + 2 * m) * ppg)),
    H = Math.max(1, Math.round((p.h + 2 * m) * ppg));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const local = { ...p, x: 0, y: 0, rot: 0 };
  if (map.settings.shadows !== false && castsShadow(p)) {
    // ombre calculée dans le repère de l'objet : une fois la tuile pivotée, elle tombe en bas à droite
    const [dx, dy] = shadowOffset(p);
    const r = (-p.rot * Math.PI) / 180;
    const lx = dx * Math.cos(r) - dy * Math.sin(r),
      ly = dx * Math.sin(r) + dy * Math.cos(r);
    const sh = document.createElement('canvas');
    sh.width = W;
    sh.height = H;
    const s = sh.getContext('2d')!;
    s.setTransform(ppg, 0, 0, ppg, W / 2 + lx * ppg, H / 2 + ly * ppg);
    drawProp(s, local, theme.pal, map.settings.skins, only);
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-in';
    s.fillStyle = '#000';
    s.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = theme.dark ? 0.5 : 0.3;
    ctx.filter = `blur(${Math.max(0.6, 0.05 * ppg).toFixed(1)}px)`;
    ctx.drawImage(sh, 0, 0);
    ctx.restore();
  }
  ctx.setTransform(ppg, 0, 0, ppg, W / 2, H / 2);
  drawProp(ctx, local, theme.pal, map.settings.skins, only);
  return cv;
}

// ---------- Foundry VTT ----------

function segmentsOf(view: DungeonMap): Seg[] {
  const geo = new Renderer().geometry(view, mapTheme(view.settings));
  return wallSegments(geo, 0.08).concat(obstacleSegments(view));
}

export function foundryWalls(view: DungeonMap, crop: Crop, ppg: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const s of segmentsOf(view)) {
    const c = [(s.x1 - crop.x) * ppg, (s.y1 - crop.y) * ppg, (s.x2 - crop.x) * ppg, (s.y2 - crop.y) * ppg].map((v) => Math.round(v));
    if (c[0] === c[2] && c[1] === c[3]) continue;
    // CONST.WALL_SENSE_TYPES : NONE 0, LIMITED 10, NORMAL 20 ; door : 0 aucune, 1 porte, 2 secrète ; ds : 0 fermée, 2 verrouillée
    const w: Record<string, unknown> = { c, move: 20, sight: 20, light: 20, sound: 20, door: 0, ds: 0, dir: 0 };
    switch (s.type) {
      case EDGE.DOOR:
        w.door = 1;
        break;
      case EDGE.LOCKED:
        w.door = 1;
        w.ds = 2;
        break;
      case EDGE.SECRET:
        w.door = 2;
        break;
      case EDGE.WINDOW:
        w.sight = 0;
        w.light = 0;
        w.sound = 10;
        break;
      case EDGE.BARS:
        w.sight = 0;
        w.light = 0;
        w.sound = 0;
        break;
    }
    out.push(w);
  }
  return out;
}

export function foundryLights(view: DungeonMap, crop: Crop, ppg: number): Record<string, unknown>[] {
  const dist = view.settings.gridDistance;
  return allLights(view).map((l) => ({
    x: Math.round((l.x - crop.x) * ppg),
    y: Math.round((l.y - crop.y) * ppg),
    rotation: 0,
    walls: true,
    vision: false,
    hidden: false,
    config: {
      dim: +(l.radius * dist).toFixed(2),
      bright: +((l.radius * dist) / 2).toFixed(2),
      color: toHex(l.color),
      alpha: +(0.25 + l.intensity * 0.35).toFixed(2),
      angle: 360,
      luminosity: 0.5,
      attenuation: 0.5,
      coloration: 1,
      animation: l.anim === 'none' ? { type: null } : { type: l.anim, speed: 3, intensity: 3 },
    },
  }));
}

/** Textes MJ -> dessins cachés (visibles du MJ seul). */
export function foundryDrawings(view: DungeonMap, crop: Crop, ppg: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const l of view.labels) {
    if (!l.gmOnly) continue;
    const fs = Math.max(12, Math.round(l.size * ppg * 0.9));
    const w = Math.max(ppg, Math.round(l.text.length * fs * 0.62 + fs * 0.6)),
      h = Math.round(fs * 1.5);
    out.push({
      x: Math.round((l.x - crop.x) * ppg - w / 2),
      y: Math.round((l.y - crop.y) * ppg - h / 2),
      shape: { type: 'r', width: w, height: h },
      text: l.text,
      fontSize: fs,
      fontFamily: 'Signika',
      textColor: '#ffffff',
      textAlpha: 1,
      fillType: 1,
      fillColor: '#000000',
      fillAlpha: 0.45,
      strokeWidth: 0,
      strokeAlpha: 0,
      hidden: true,
    });
  }
  return out;
}

/**
 * Tuiles : l'image est désignée par une clé (`image`), remplacée par un chemin à l'import.
 * `roof` : toit (au-dessus des jetons, s'efface quand un jeton passe dessous) ; le module
 * traduit ce drapeau dans le format de la version de Foundry.
 */
export function foundryTiles(view: DungeonMap, crop: Crop, ppg: number, mode: TileMode = 'all'): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  // ordre d'empilement : couche de l'objet (sol, meubles, dessus, toits) puis ordre de pose
  view.props.forEach((p, i) => {
    if (!isTileFor(p, mode)) return;
    const aid = tileAsset(view, p);
    const a = aid ? assetImage(aid) : null;
    // image d'origine : boîte exacte ; rendu de l'objet : boîte agrandie de la marge
    const b = a ? assetBox(p, a) : { w: p.w + 2 * TILE_MARGIN, h: p.h + 2 * TILE_MARGIN };
    for (const part of tileParts(view, p)) {
      const roof = part === 'canopy' || isRoof(p);
      const layer = roof ? 5 : part === 'trunk' ? 1 : propLayer(p);
      out.push({
        x: Math.round((p.x - b.w / 2 - crop.x) * ppg),
        y: Math.round((p.y - b.h / 2 - crop.y) * ppg),
        width: Math.max(1, Math.round(b.w * ppg)),
        height: Math.max(1, Math.round(b.h * ppg)),
        rotation: p.rot,
        hidden: p.gmOnly,
        roof,
        sort: layer * 10000 + i,
        image: propImageKey(p, view, part),
        flags: { eugea: { kind: p.kind, part, name: a && p.kind === 'image' ? a.name : (PROP_BY_KIND[p.kind]?.name ?? p.kind) } },
      });
    }
  });
  return out;
}

/**
 * Tuile pour un import sans module (version de Foundry inconnue) : les champs « toit »
 * de la v11 (overhead, roof) et de la v12+ (élévation, occlusion, restrictions) sont tous
 * présents ; Foundry ignore ceux qu'il ne connaît pas.
 */
export function staticTile(tile: Record<string, unknown>, roofElevation: number, v14 = false): Record<string, unknown> {
  const { image: _image, roof, sort, ...t } = tile;
  // V14 : x, y = point d'ancrage de la texture (son centre) ; avant : coin haut-gauche
  if (v14) {
    t.x = Math.round((t.x as number) + (t.width as number) / 2);
    t.y = Math.round((t.y as number) + (t.height as number) / 2);
  }
  t.sort = sort;
  if (!v14) t.z = sort;
  if (!roof) return t;
  if (v14) return { ...t, elevation: roofElevation, occlusion: { modes: [1], alpha: 0 }, restrictions: { light: true, weather: true } };
  return {
    ...t,
    overhead: true,
    roof: true,
    elevation: roofElevation,
    occlusion: { mode: 2, modes: [1], alpha: 0 },
    restrictions: { light: true, weather: true },
  };
}

/** Élévation des toits au-dessus du sol d'un niveau (sous le plafond). */
export function roofElevation(map: DungeonMap): number {
  return +(levelHeight(map) * 0.9).toFixed(2);
}

/** Zones d'escaliers (pour relier les niveaux natifs de Foundry V14). */
export function stairZones(view: DungeonMap, crop: Crop, ppg: number): { x: number; y: number; width: number; height: number }[] {
  return view.props
    .filter((p) => STAIRS.has(p.kind))
    .map((p) => {
      const b = propBounds(p);
      return {
        x: Math.round((b.x0 - crop.x) * ppg),
        y: Math.round((b.y0 - crop.y) * ppg),
        width: Math.round((b.x1 - b.x0) * ppg),
        height: Math.round((b.y1 - b.y0) * ppg),
      };
    });
}

export interface LinkZone {
  level: string; // identifiant du niveau
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Liaison entre deux zones (téléportation Foundry) : passage posé ou escalier relié à l'étage voisin. */
export interface FoundryLink {
  id: string;
  name: string;
  kind: 'stairs' | 'passage';
  oneWay: boolean;
  a: LinkZone;
  b: LinkZone;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Liaisons exportées : les passages posés, puis chaque escalier / échelle / trappe relié à l'étage
 * voisin au même endroit (au-dessus d'abord, en dessous d'abord pour une trappe). Un escalier
 * présent aux deux étages ne donne qu'une liaison ; un escalier déjà couvert par un passage est ignoré.
 */
export function foundryLinks(map: DungeonMap, crop: Crop, ppg: number): FoundryLink[] {
  const zone = (level: string, b: Box): LinkZone => ({
    level,
    x: Math.round((b.x0 - crop.x) * ppg),
    y: Math.round((b.y0 - crop.y) * ppg),
    width: Math.max(1, Math.round((b.x1 - b.x0) * ppg)),
    height: Math.max(1, Math.round((b.y1 - b.y0) * ppg)),
  });
  const endBox = (x: number, y: number, size: number): Box => ({ x0: x - size / 2, y0: y - size / 2, x1: x + size / 2, y1: y + size / 2 });
  const out: FoundryLink[] = map.passages.map((p) => ({
    id: p.id,
    name: p.name,
    kind: 'passage',
    oneWay: !!p.oneWay,
    a: zone(p.a.level, endBox(p.a.x, p.a.y, p.size)),
    b: zone(p.b.level, endBox(p.b.x, p.b.y, p.size)),
  }));
  const covered = (level: string, b: Box) =>
    map.passages.some((p) => (p.a.level === level && overlaps(b, endBox(p.a.x, p.a.y, p.size))) || (p.b.level === level && overlaps(b, endBox(p.b.x, p.b.y, p.size))));
  const stairsOf = (i: number) => map.levels[i].props.filter((p) => STAIRS.has(p.kind)).map((p) => ({ p, b: propBounds(p) }));
  const done = new Set<string>();
  map.levels.forEach((lv, i) => {
    for (const { p, b } of stairsOf(i)) {
      if (done.has(p.id) || covered(lv.id, b)) continue;
      const order = p.kind === 'trapdoor' ? [i - 1, i + 1] : [i + 1, i - 1];
      const targets = order.filter((j) => j >= 0 && j < map.levels.length);
      if (!targets.length) continue;
      // un escalier au même endroit sur l'étage voisin : on relie les deux
      let j = targets[0];
      let other: { p: { id: string }; b: Box } | undefined;
      for (const t of targets) {
        other = stairsOf(t).find((o) => !done.has(o.p.id) && overlaps(o.b, b));
        if (other) {
          j = t;
          break;
        }
      }
      done.add(p.id);
      if (other) done.add(other.p.id);
      out.push({
        id: 'stairs-' + p.id,
        name: PROP_BY_KIND[p.kind]?.name ?? 'Escalier',
        kind: 'stairs',
        oneWay: false,
        a: zone(lv.id, b),
        b: zone(map.levels[j].id, other ? other.b : b),
      });
    }
  });
  return out;
}

/** Hauteur d'un niveau (pour les élévations Foundry), dans l'unité de la grille. */
export function levelHeight(map: DungeonMap): number {
  const u = map.settings.gridUnits;
  return u === 'm' ? 3 : u === 'ft' ? 10 : map.settings.gridDistance * 2;
}

export type Ambiance = 'day' | 'dusk' | 'night';

export const AMBIANCES: [Ambiance, string, number][] = [
  ['day', 'Jour', 0],
  ['dusk', 'Crépuscule', 0.4],
  ['night', 'Nuit', 0.8],
];

/** Ambiance d'une carte d'après son obscurité. */
export function ambianceOf(darkness: number): Ambiance {
  return darkness < 0.2 ? 'day' : darkness < 0.6 ? 'dusk' : 'night';
}

export function foundryBaseScene(map: DungeonMap, crop: Crop, ppg: number, foundryGrid: boolean, ambiance: Ambiance = ambianceOf(map.settings.darkness)): Record<string, unknown> {
  const darkness = AMBIANCES.find((a) => a[0] === ambiance)?.[2] ?? 0;
  const day = ambiance === 'day';
  return {
    name: map.name,
    width: Math.round(crop.w * ppg),
    height: Math.round(crop.h * ppg),
    padding: 0,
    backgroundColor: '#000000',
    grid: {
      type: 1,
      size: ppg,
      distance: map.settings.gridDistance,
      units: map.settings.gridUnits,
      color: '#000000',
      alpha: foundryGrid ? 0.25 : 0,
    },
    tokenVision: true,
    fogExploration: true,
    fog: { exploration: true },
    globalLight: day,
    darkness,
    environment: { darknessLevel: darkness, globalLight: { enabled: day } },
    foregroundElevation: roofElevation(map),
    initial: null,
    flags: { eugea: { version: 5, cols: crop.w, rows: crop.h, ambiance } },
  };
}

export interface FoundryLevel {
  id: string;
  name: string;
  z: number;
  bottom: number;
  top: number;
  image: string;
  /** Image transparente hors du sol (étages, niveaux natifs V14). */
  imageOver?: string;
  walls: Record<string, unknown>[];
  lights: Record<string, unknown>[];
  drawings: Record<string, unknown>[];
  tiles: Record<string, unknown>[];
  stairs: { x: number; y: number; width: number; height: number }[];
}

export function foundryLevel(map: DungeonMap, index: number, crop: Crop, ppg: number, imageKey: string, gmDrawings: boolean, mode: TileMode = 'all', overKey?: string): FoundryLevel {
  const view = map.levelView(index);
  const lv = map.levels[index];
  const H = levelHeight(map);
  return {
    id: lv.id,
    name: lv.name,
    z: lv.z,
    bottom: lv.z * H,
    top: (lv.z + 1) * H,
    image: imageKey,
    imageOver: overKey,
    walls: foundryWalls(view, crop, ppg),
    lights: foundryLights(view, crop, ppg),
    drawings: gmDrawings ? foundryDrawings(view, crop, ppg) : [],
    tiles: foundryTiles(view, crop, ppg, mode),
    stairs: stairZones(view, crop, ppg),
  };
}

// ---------- Universal VTT (.dd2vtt) ----------

export function universalVTT(view: DungeonMap, crop: Crop, ppg: number, imageB64: string, baked: boolean): Record<string, unknown> {
  const geo = new Renderer().geometry(view, mapTheme(view.settings));
  const P = (x: number, y: number) => ({ x: +(x - crop.x).toFixed(4), y: +(y - crop.y).toFixed(4) });
  const los: { x: number; y: number }[][] = [];
  for (const poly of geo.wallPolys) {
    const p = simplify(poly.pts, 0.08, poly.closed);
    const line: { x: number; y: number }[] = [];
    for (let i = 0; i < p.length; i += 2) line.push(P(p[i], p[i + 1]));
    if (poly.closed && p.length >= 2) line.push(P(p[0], p[1]));
    los.push(line);
  }
  for (const s of geo.interiorWalls) los.push([P(s.x1, s.y1), P(s.x2, s.y2)]);
  const objects: { x: number; y: number }[][] = obstacleSegments(view).map((s) => [P(s.x1, s.y1), P(s.x2, s.y2)]);
  const portals = geo.portals
    .filter((d) => d.type === EDGE.DOOR || d.type === EDGE.LOCKED || d.type === EDGE.SECRET)
    .map((d) => ({
      position: P((d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2),
      bounds: [P(d.x1, d.y1), P(d.x2, d.y2)],
      rotation: Math.atan2(d.y2 - d.y1, d.x2 - d.x1),
      closed: true,
      freestanding: false,
    }));
  return {
    format: 0.3,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: crop.w, y: crop.h }, pixels_per_grid: ppg },
    line_of_sight: los,
    objects_line_of_sight: objects,
    portals,
    environment: { baked_lighting: baked, ambient_light: 'ffffffff' },
    lights: allLights(view).map((l) => ({
      position: P(l.x, l.y),
      range: l.radius,
      intensity: l.intensity,
      color: 'ff' + toHex(l.color).slice(1),
      shadows: true,
    })),
    image: imageB64,
  };
}
