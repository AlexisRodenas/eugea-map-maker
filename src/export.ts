import { DungeonMap, EDGE, Prop } from './model';
import { Renderer } from './render';
import { resolveTheme } from './themes';
import { Seg, simplify, wallSegments } from './geometry';
import { allLights, propBlockers } from './lighting';
import { PROP_BY_KIND, drawProp, isTile, propBounds } from './props';
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

export interface ImageOpts {
  ppg: number;
  mode: 'player' | 'gm';
  grid: boolean;
  lighting: boolean;
  /** Les objets "séparés" ne sont pas dessinés dans l'image (ils deviennent des tuiles). */
  separateTiles: boolean;
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
  new Renderer().render(ctx, view, resolveTheme(map.settings.theme, map.settings.colors), {
    view: { scale: o.ppg, ox: crop.x, oy: crop.y },
    width: W,
    height: H,
    mode: o.mode,
    grid: o.grid,
    lighting: o.lighting,
    bakeProp: o.separateTiles ? (p) => !isTile(p) : undefined,
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

/** Objets exportés en tuiles : ceux marqués « séparés » et ceux réservés au MJ (tuiles cachées). */
export function tileProps(view: DungeonMap): Prop[] {
  return view.props.filter((p) => isTile(p) || p.gmOnly);
}

export function propImageKey(p: Prop): string {
  const rand = PROP_BY_KIND[p.kind]?.rand ? '-' + p.id : '';
  return slugify(`${p.kind}-${p.w}x${p.h}${rand}`);
}

/** Image d'un objet seul, fond transparent, non pivoté (la rotation est portée par la tuile). */
export function renderPropImage(map: DungeonMap, p: Prop, ppg: number): HTMLCanvasElement {
  const theme = resolveTheme(map.settings.theme, map.settings.colors);
  const W = Math.max(1, Math.round(p.w * ppg)),
    H = Math.max(1, Math.round(p.h * ppg));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(ppg, 0, 0, ppg, W / 2, H / 2);
  drawProp(ctx, { ...p, x: 0, y: 0, rot: 0 }, theme.pal);
  return cv;
}

// ---------- Foundry VTT ----------

function segmentsOf(view: DungeonMap): Seg[] {
  const geo = new Renderer().geometry(view, resolveTheme(view.settings.theme, view.settings.colors));
  return wallSegments(geo, 0.08).concat(propBlockers(view));
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

/** Tuiles : l'image est désignée par une clé (`image`), remplacée par un chemin à l'import. */
export function foundryTiles(view: DungeonMap, crop: Crop, ppg: number): Record<string, unknown>[] {
  return tileProps(view).map((p) => ({
    x: Math.round((p.x - p.w / 2 - crop.x) * ppg),
    y: Math.round((p.y - p.h / 2 - crop.y) * ppg),
    width: Math.round(p.w * ppg),
    height: Math.round(p.h * ppg),
    rotation: p.rot,
    hidden: p.gmOnly,
    image: propImageKey(p),
    flags: { eugea: { kind: p.kind, name: PROP_BY_KIND[p.kind]?.name ?? p.kind } },
  }));
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

/** Hauteur d'un niveau (pour les élévations Foundry), dans l'unité de la grille. */
export function levelHeight(map: DungeonMap): number {
  const u = map.settings.gridUnits;
  return u === 'm' ? 3 : u === 'ft' ? 10 : map.settings.gridDistance * 2;
}

export function foundryBaseScene(map: DungeonMap, crop: Crop, ppg: number, foundryGrid: boolean): Record<string, unknown> {
  const darkness = map.settings.darkness;
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
    globalLight: false,
    darkness,
    environment: { darknessLevel: darkness, globalLight: { enabled: false } },
    initial: null,
    flags: { eugea: { version: 2, cols: crop.w, rows: crop.h } },
  };
}

export interface FoundryLevel {
  id: string;
  name: string;
  z: number;
  bottom: number;
  top: number;
  image: string;
  walls: Record<string, unknown>[];
  lights: Record<string, unknown>[];
  drawings: Record<string, unknown>[];
  tiles: Record<string, unknown>[];
  stairs: { x: number; y: number; width: number; height: number }[];
}

export function foundryLevel(map: DungeonMap, index: number, crop: Crop, ppg: number, imageKey: string, gmDrawings: boolean): FoundryLevel {
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
    walls: foundryWalls(view, crop, ppg),
    lights: foundryLights(view, crop, ppg),
    drawings: gmDrawings ? foundryDrawings(view, crop, ppg) : [],
    tiles: foundryTiles(view, crop, ppg),
    stairs: stairZones(view, crop, ppg),
  };
}

// ---------- Universal VTT (.dd2vtt) ----------

export function universalVTT(view: DungeonMap, crop: Crop, ppg: number, imageB64: string, baked: boolean): Record<string, unknown> {
  const geo = new Renderer().geometry(view, resolveTheme(view.settings.theme, view.settings.colors));
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
  const objects: { x: number; y: number }[][] = propBlockers(view).map((s) => [P(s.x1, s.y1), P(s.x2, s.y2)]);
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
