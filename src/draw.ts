// Types et aides de dessin communs aux objets (props.ts, furniture.ts).
import type { LightAnim } from './model';
import type { PropPalette } from './themes';
import { Rng, rgba } from './util';

export type Ctx = CanvasRenderingContext2D;

export interface DrawEnv {
  c: Ctx;
  w: number;
  h: number;
  pal: PropPalette;
  rng: Rng;
  lw: number;
  /** Arbres : partie à dessiner (tuiles Foundry séparées pour le tronc et le feuillage). */
  part?: 'trunk' | 'canopy';
}

export interface PropLight {
  radius: number;
  color: string;
  anim: LightAnim;
  intensity: number;
}

export interface PropDef {
  kind: string;
  name: string;
  cat: string;
  w: number;
  h: number;
  layer?: number; // 0 : au sol (tapis), 1 : normal, 2 : dessus
  blocks?: 'circle' | 'rect'; // bloque la vue dans Foundry / l'aperçu
  light?: PropLight;
  gmOnly?: boolean;
  /** Exporté par défaut comme tuile séparée dans Foundry (coffres, tonneaux...). */
  tile?: boolean;
  /** Dessin aléatoire (dépend de l'identifiant de l'objet). */
  rand?: boolean;
  /** « Toit » : au-dessus des jetons dans Foundry, s'efface quand un jeton passe dessous. */
  roof?: boolean;
  /** Se pose en glissant un rectangle (toits, auvents). */
  area?: boolean;
  /** Ombre portée (défaut : objets posés au-dessus du sol, hors sources de lumière). */
  shadow?: boolean;
  /** Murs Foundry propres à l'objet : segments locaux [x1, y1, x2, y2, EDGE.*] (porte fortifiée...). */
  walls?: (w: number, h: number) => [number, number, number, number, number][];
  /** Arbre : tronc au sol + feuillage en toit dans Foundry (le jeton passe sous les feuilles). */
  canopy?: boolean;
  draw: (e: DrawEnv) => void;
}

// ---------- Aides de dessin ----------

export function circle(c: Ctx, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
}

export function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function poly(c: Ctx, pts: number[]): void {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
}

export function fs(e: DrawEnv, fill: string | CanvasGradient, stroke: string = e.pal.ink, lw = e.lw): void {
  e.c.fillStyle = fill;
  e.c.fill();
  if (lw > 0) {
    e.c.lineWidth = lw;
    e.c.strokeStyle = stroke;
    e.c.stroke();
  }
}

export function st(e: DrawEnv, stroke: string = e.pal.ink, lw = e.lw): void {
  e.c.lineWidth = lw;
  e.c.strokeStyle = stroke;
  e.c.stroke();
}

export function line(c: Ctx, x1: number, y1: number, x2: number, y2: number): void {
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
}

export function blob(rng: Rng, r: number, n: number, jit: number): number[] {
  const pts: number[] = [];
  const off = rng.float(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    const rr = r * (1 + rng.float(-jit, jit));
    pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return pts;
}

export function flame(e: DrawEnv, x: number, y: number, r: number): void {
  const c = e.c;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, '#fff6c8');
  g.addColorStop(0.35, e.pal.fire);
  g.addColorStop(1, rgba(e.pal.fire, 0));
  circle(c, x, y, r);
  c.fillStyle = g;
  c.fill();
}

