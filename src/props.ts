import type { LightAnim, Prop } from './model';
import type { PropPalette } from './themes';
import { Asset, assetImage } from './assets';
import { Rng, hashString, rgba, lighten, darken, mix } from './util';

type Ctx = CanvasRenderingContext2D;

export interface DrawEnv {
  c: Ctx;
  w: number;
  h: number;
  pal: PropPalette;
  rng: Rng;
  lw: number;
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
  draw: (e: DrawEnv) => void;
}

// ---------- Aides de dessin ----------

function circle(c: Ctx, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
}

function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function poly(c: Ctx, pts: number[]): void {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
}

function fs(e: DrawEnv, fill: string | CanvasGradient, stroke: string = e.pal.ink, lw = e.lw): void {
  e.c.fillStyle = fill;
  e.c.fill();
  if (lw > 0) {
    e.c.lineWidth = lw;
    e.c.strokeStyle = stroke;
    e.c.stroke();
  }
}

function st(e: DrawEnv, stroke: string = e.pal.ink, lw = e.lw): void {
  e.c.lineWidth = lw;
  e.c.strokeStyle = stroke;
  e.c.stroke();
}

function line(c: Ctx, x1: number, y1: number, x2: number, y2: number): void {
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
}

function blob(rng: Rng, r: number, n: number, jit: number): number[] {
  const pts: number[] = [];
  const off = rng.float(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    const rr = r * (1 + rng.float(-jit, jit));
    pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return pts;
}

function flame(e: DrawEnv, x: number, y: number, r: number): void {
  const c = e.c;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, '#fff6c8');
  g.addColorStop(0.35, e.pal.fire);
  g.addColorStop(1, rgba(e.pal.fire, 0));
  circle(c, x, y, r);
  c.fillStyle = g;
  c.fill();
}

function canopy(e: DrawEnv, R: number, lobes: number, color: string): void {
  const { c, rng } = e;
  const circles: [number, number, number][] = [[0, 0, R * 0.55]];
  const off = rng.float(0, 6.28);
  for (let i = 0; i < lobes; i++) {
    const a = off + (i / lobes) * Math.PI * 2;
    const d = R * rng.float(0.5, 0.62);
    circles.push([Math.cos(a) * d, Math.sin(a) * d, R * rng.float(0.32, 0.42)]);
  }
  c.beginPath();
  for (const [x, y, r] of circles) {
    c.moveTo(x + r, y);
    c.arc(x, y, r, 0, Math.PI * 2);
  }
  c.lineWidth = e.lw * 2.2;
  c.strokeStyle = e.pal.ink;
  c.stroke();
  c.fillStyle = color;
  c.fill();
  c.beginPath();
  for (const [x, y, r] of circles.slice(1)) {
    c.moveTo(x - r * 0.1 + r * 0.45, y - r * 0.2);
    c.arc(x - r * 0.1, y - r * 0.2, r * 0.45, 0, Math.PI * 2);
  }
  c.fillStyle = lighten(color, 0.18);
  c.fill();
}

type RoofStyle = 'thatch' | 'tiles' | 'slate' | 'shingle';

/** Toit à deux pans, faîtage dans le sens de la plus grande longueur. */
function roofDraw(e: DrawEnv, base: string, style: RoofStyle): void {
  const { c, w, h, rng } = e;
  const horiz = w >= h;
  const L = horiz ? w : h,
    D = horiz ? h : w;
  c.save();
  if (!horiz) c.rotate(Math.PI / 2);
  const x0 = -L / 2,
    y0 = -D / 2,
    half = D / 2;
  const ink = darken(base, 0.55);
  c.fillStyle = lighten(base, 0.1);
  c.fillRect(x0, y0, L, half);
  c.fillStyle = darken(base, 0.17);
  c.fillRect(x0, 0, L, half);
  const row = style === 'thatch' ? 0.3 : style === 'slate' ? 0.2 : 0.24;
  // rangs parallèles au faîtage
  c.beginPath();
  for (let v = row; v < half - 0.02; v += row) {
    line(c, x0, -v, x0 + L, -v);
    line(c, x0, v, x0 + L, v);
  }
  st(e, rgba(ink, style === 'thatch' ? 0.35 : 0.55), e.lw * 0.6);
  // brins de chaume / joints des tuiles, ardoises, bardeaux
  c.beginPath();
  if (style === 'thatch') {
    for (const side of [-1, 1])
      for (let v = 0; v < half; v += row)
        for (let u = x0 + rng.float(0, 0.12); u < x0 + L; u += rng.float(0.11, 0.2)) {
          const dx = rng.float(-0.05, 0.05);
          line(c, u, side * v, u + dx, side * Math.min(half, v + row * rng.float(0.75, 1.15)));
        }
    st(e, rgba(ink, 0.45), e.lw * 0.45);
  } else {
    const joint = style === 'slate' ? 0.34 : style === 'tiles' ? 0.22 : 0;
    const hi: number[] = [];
    for (const side of [-1, 1]) {
      let k = 0;
      for (let v = 0; v < half - 0.01; v += row, k++) {
        let u = x0 + (k % 2 ? (joint || 0.16) / 2 : 0);
        const v2 = Math.min(half, v + row);
        for (;;) {
          const step = joint || rng.float(0.12, 0.3);
          if (style === 'tiles') hi.push(u + step / 2, side * v, side * v2);
          u += step;
          if (u >= x0 + L - 0.02) break;
          line(c, u, side * v, u, side * v2);
        }
      }
    }
    st(e, rgba(ink, 0.5), e.lw * 0.5);
    if (hi.length) {
      // tuiles canal : reflet au milieu de chaque tuile
      c.beginPath();
      for (let i = 0; i < hi.length; i += 3) if (hi[i] < x0 + L - 0.05) line(c, hi[i], hi[i + 1], hi[i], hi[i + 2]);
      st(e, rgba(lighten(base, 0.35), 0.4), e.lw * 0.9);
    }
  }
  // faîtage
  c.beginPath();
  c.rect(x0, -0.08, L, 0.16);
  c.fillStyle = darken(base, style === 'thatch' ? 0.3 : 0.38);
  c.fill();
  // rives et égouts
  c.beginPath();
  c.rect(x0 + 0.03, y0 + 0.03, L - 0.06, D - 0.06);
  st(e, rgba(ink, 0.35), 0.06);
  c.beginPath();
  c.rect(x0, y0, L, D);
  st(e, e.pal.ink, e.lw * 1.2);
  c.restore();
}

function roofDef(kind: string, name: string, style: RoofStyle, color: (p: PropPalette) => string): PropDef {
  return { kind, name, cat: 'Toits', w: 5, h: 4, layer: 3, roof: true, area: true, rand: true, draw: (e) => roofDraw(e, color(e.pal), style) };
}

// ---------- Catalogue ----------

export const PROPS: PropDef[] = [
  // --- Passages
  {
    kind: 'stairs',
    name: 'Escalier',
    cat: 'Passages',
    w: 1,
    h: 2,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const x0 = -w / 2,
        y0 = -h / 2;
      c.beginPath();
      c.rect(x0, y0, w, h);
      fs(e, pal.stone, pal.ink, 0);
      const g = c.createLinearGradient(0, y0, 0, y0 + h);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.5)');
      c.fillStyle = g;
      c.fillRect(x0, y0, w, h);
      const n = Math.max(4, Math.round(h * 4));
      c.beginPath();
      for (let i = 1; i < n; i++) line(c, x0, y0 + (i * h) / n, x0 + w, y0 + (i * h) / n);
      st(e, pal.ink, e.lw * 0.7);
      c.beginPath();
      c.rect(x0, y0, w, h);
      st(e);
    },
  },
  {
    kind: 'spiral',
    name: 'Escalier en colimaçon',
    cat: 'Passages',
    w: 2,
    h: 2,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const r = (Math.min(w, h) / 2) * 0.92;
      circle(c, 0, 0, r);
      fs(e, pal.stone);
      c.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r0 = r * 0.2;
        c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        c.quadraticCurveTo(Math.cos(a + 0.3) * r * 0.6, Math.sin(a + 0.3) * r * 0.6, Math.cos(a + 0.5) * r, Math.sin(a + 0.5) * r);
      }
      st(e, pal.ink, e.lw * 0.7);
      const g = c.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
      g.addColorStop(0, 'rgba(0,0,0,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      circle(c, 0, 0, r);
      c.fillStyle = g;
      c.fill();
      circle(c, 0, 0, r * 0.2);
      fs(e, pal.stoneDark);
    },
  },
  {
    kind: 'ladder',
    name: 'Échelle',
    cat: 'Passages',
    w: 0.6,
    h: 1,
    draw: (e) => {
      const { c, w, h, pal } = e;
      c.beginPath();
      for (let y = -h / 2 + 0.15; y < h / 2; y += 0.2) line(c, -w * 0.32, y, w * 0.32, y);
      st(e, pal.wood, e.lw * 1.6);
      c.beginPath();
      line(c, -w * 0.32, -h / 2, -w * 0.32, h / 2);
      line(c, w * 0.32, -h / 2, w * 0.32, h / 2);
      st(e, pal.woodDark, e.lw * 1.8);
    },
  },
  {
    kind: 'trapdoor',
    name: 'Trappe',
    cat: 'Passages',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, pal } = e;
      c.beginPath();
      c.rect(-0.4, -0.4, 0.8, 0.8);
      fs(e, pal.wood);
      c.beginPath();
      for (const x of [-0.13, 0.13]) line(c, x, -0.4, x, 0.4);
      st(e, pal.woodDark, e.lw * 0.7);
      c.beginPath();
      line(c, -0.4, -0.25, 0.4, -0.25);
      line(c, -0.4, 0.25, 0.4, 0.25);
      st(e, pal.metal, e.lw * 1.4);
      circle(c, 0.22, 0, 0.07);
      st(e, pal.metal, e.lw * 1.2);
    },
  },
  // --- Structure
  {
    kind: 'pillar',
    name: 'Colonne',
    cat: 'Structure',
    w: 1,
    h: 1,
    blocks: 'circle',
    draw: (e) => {
      const { c, w, h, pal } = e;
      const r = Math.min(w, h) * 0.38;
      circle(c, 0, 0, r);
      fs(e, pal.stone, pal.ink, e.lw * 1.2);
      circle(c, 0, 0, r * 0.68);
      st(e, rgba(pal.ink, 0.45), e.lw * 0.7);
      circle(c, -r * 0.3, -r * 0.3, r * 0.22);
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.fill();
    },
  },
  {
    kind: 'pillarSquare',
    name: 'Pilier carré',
    cat: 'Structure',
    w: 1,
    h: 1,
    blocks: 'rect',
    draw: (e) => {
      const { c, w, h, pal } = e;
      c.beginPath();
      c.rect(-w * 0.4, -h * 0.4, w * 0.8, h * 0.8);
      fs(e, pal.stone, pal.ink, e.lw * 1.2);
      c.beginPath();
      c.rect(-w * 0.26, -h * 0.26, w * 0.52, h * 0.52);
      st(e, rgba(pal.ink, 0.45), e.lw * 0.7);
    },
  },
  {
    kind: 'statue',
    name: 'Statue',
    cat: 'Structure',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, pal } = e;
      c.beginPath();
      c.rect(-0.42, -0.42, 0.84, 0.84);
      fs(e, pal.stoneDark);
      c.beginPath();
      c.ellipse(0, 0.06, 0.3, 0.16, 0, 0, Math.PI * 2);
      fs(e, lighten(pal.stone, 0.15));
      circle(c, 0, -0.04, 0.13);
      fs(e, lighten(pal.stone, 0.25));
    },
  },
  {
    kind: 'rubble',
    rand: true,
    name: 'Gravats',
    cat: 'Structure',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      const n = Math.round(6 * w * h) + 2;
      for (let i = 0; i < n; i++) {
        const x = rng.float(-w * 0.4, w * 0.4),
          y = rng.float(-h * 0.4, h * 0.4);
        const pts = blob(rng, rng.float(0.05, 0.15), 5, 0.35);
        for (let k = 0; k < pts.length; k += 2) {
          pts[k] += x;
          pts[k + 1] += y;
        }
        poly(c, pts);
        fs(e, rng.chance(0.5) ? pal.stone : pal.stoneDark, pal.ink, e.lw * 0.7);
      }
    },
  },
  {
    kind: 'boulder',
    rand: true,
    name: 'Rocher',
    cat: 'Nature',
    w: 1,
    h: 1,
    blocks: 'circle',
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      const r = Math.min(w, h) * 0.4;
      poly(c, blob(rng, r, 9, 0.18));
      fs(e, pal.stone, pal.ink, e.lw * 1.2);
      c.beginPath();
      c.arc(-r * 0.15, -r * 0.15, r * 0.55, Math.PI * 1.05, Math.PI * 1.6);
      st(e, 'rgba(255,255,255,0.35)', e.lw);
      c.beginPath();
      line(c, r * 0.1, r * 0.05, r * 0.45, r * 0.3);
      st(e, rgba(pal.ink, 0.5), e.lw * 0.7);
    },
  },
  {
    kind: 'stalagmite',
    rand: true,
    name: 'Stalagmite',
    cat: 'Nature',
    w: 1,
    h: 1,
    blocks: 'circle',
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      const r = Math.min(w, h) * 0.42;
      poly(c, blob(rng, r, 8, 0.2));
      fs(e, pal.stoneDark, pal.ink, e.lw * 1.2);
      poly(c, blob(rng, r * 0.62, 7, 0.2));
      fs(e, pal.stone, pal.ink, e.lw * 0.6);
      poly(c, blob(rng, r * 0.28, 6, 0.2));
      fs(e, lighten(pal.stone, 0.3), pal.ink, e.lw * 0.5);
    },
  },
  // --- Mobilier
  {
    kind: 'table',
    name: 'Table',
    cat: 'Mobilier',
    w: 2,
    h: 1,
    draw: (e) => {
      const { c, w, h, pal } = e;
      rrect(c, -w / 2 + 0.1, -h / 2 + 0.14, w - 0.2, h - 0.28, 0.06);
      fs(e, pal.wood);
      c.beginPath();
      line(c, -w / 2 + 0.2, -0.06, w / 2 - 0.25, -0.06);
      line(c, -w / 2 + 0.35, 0.1, w / 2 - 0.2, 0.1);
      st(e, rgba(pal.woodDark, 0.6), e.lw * 0.6);
    },
  },
  {
    kind: 'tableRound',
    name: 'Table ronde',
    cat: 'Mobilier',
    w: 2,
    h: 2,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const R = Math.min(w, h) / 2;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        c.save();
        c.translate(Math.cos(a) * R * 0.72, Math.sin(a) * R * 0.72);
        c.rotate(a + Math.PI / 2);
        rrect(c, -0.2, -0.18, 0.4, 0.34, 0.05);
        fs(e, pal.woodDark, pal.ink, e.lw * 0.8);
        c.restore();
      }
      circle(c, 0, 0, R * 0.52);
      fs(e, pal.wood);
      circle(c, 0, 0, R * 0.38);
      st(e, rgba(pal.woodDark, 0.5), e.lw * 0.6);
    },
  },
  {
    kind: 'chair',
    tile: true,
    name: 'Chaise',
    cat: 'Mobilier',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, pal } = e;
      rrect(c, -0.2, -0.16, 0.4, 0.38, 0.05);
      fs(e, pal.wood, pal.ink, e.lw * 0.8);
      rrect(c, -0.23, -0.27, 0.46, 0.1, 0.03);
      fs(e, pal.woodDark, pal.ink, e.lw * 0.8);
    },
  },
  {
    kind: 'bed',
    name: 'Lit',
    cat: 'Mobilier',
    w: 1,
    h: 2,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const x0 = -w / 2 + 0.1,
        y0 = -h / 2 + 0.06,
        bw = w - 0.2,
        bh = h - 0.12;
      rrect(c, x0, y0, bw, bh, 0.05);
      fs(e, pal.woodDark);
      rrect(c, x0 + 0.06, y0 + 0.06, bw - 0.12, bh - 0.12, 0.04);
      fs(e, pal.paper, pal.ink, e.lw * 0.6);
      rrect(c, x0 + 0.12, y0 + 0.1, bw - 0.24, 0.3, 0.08);
      fs(e, lighten(pal.paper, 0.3), pal.ink, e.lw * 0.6);
      c.beginPath();
      c.rect(x0 + 0.06, y0 + bh * 0.36, bw - 0.12, bh * 0.64 - 0.06);
      fs(e, pal.cloth, pal.ink, e.lw * 0.6);
      c.beginPath();
      line(c, x0 + 0.06, y0 + bh * 0.46, x0 + bw - 0.06, y0 + bh * 0.46);
      st(e, rgba(pal.ink, 0.4), e.lw * 0.6);
    },
  },
  {
    kind: 'bookshelf',
    rand: true,
    name: 'Bibliothèque',
    cat: 'Mobilier',
    w: 2,
    h: 0.5,
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      c.beginPath();
      c.rect(-w / 2, -h / 2, w, h);
      fs(e, pal.woodDark);
      const colors = [pal.cloth, pal.water, pal.plant, pal.gold, pal.paper, lighten(pal.woodDark, 0.3)];
      let x = -w / 2 + 0.05;
      while (x < w / 2 - 0.08) {
        const bw = rng.float(0.05, 0.11);
        const bh = rng.float(0.55, 0.75) * h;
        c.beginPath();
        c.rect(x, h / 2 - 0.05 - bh, Math.min(bw, w / 2 - 0.05 - x), bh);
        fs(e, rng.pick(colors), pal.ink, e.lw * 0.4);
        x += bw + 0.01;
      }
    },
  },
  {
    kind: 'chest',
    tile: true,
    name: 'Coffre',
    cat: 'Mobilier',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, pal } = e;
      rrect(c, -0.36, -0.25, 0.72, 0.5, 0.06);
      fs(e, pal.wood);
      c.beginPath();
      line(c, -0.36, -0.04, 0.36, -0.04);
      st(e, pal.ink, e.lw * 0.7);
      c.beginPath();
      c.rect(-0.25, -0.25, 0.06, 0.5);
      c.rect(0.19, -0.25, 0.06, 0.5);
      fs(e, pal.metal, pal.ink, e.lw * 0.5);
      c.beginPath();
      c.rect(-0.06, -0.08, 0.12, 0.12);
      fs(e, pal.gold, pal.ink, e.lw * 0.5);
    },
  },
  {
    kind: 'barrel',
    tile: true,
    name: 'Tonneau',
    cat: 'Mobilier',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, pal } = e;
      circle(c, 0, 0, 0.36);
      fs(e, pal.wood, pal.ink, e.lw);
      circle(c, 0, 0, 0.36);
      st(e, pal.metal, e.lw * 1.5);
      circle(c, 0, 0, 0.25);
      st(e, rgba(pal.woodDark, 0.8), e.lw * 0.7);
      c.beginPath();
      for (const x of [-0.12, 0, 0.12]) {
        const yy = Math.sqrt(0.25 * 0.25 - x * x);
        line(c, x, -yy, x, yy);
      }
      st(e, rgba(pal.woodDark, 0.6), e.lw * 0.5);
    },
  },
  {
    kind: 'crate',
    tile: true,
    name: 'Caisse',
    cat: 'Mobilier',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, pal } = e;
      c.beginPath();
      c.rect(-0.37, -0.37, 0.74, 0.74);
      fs(e, pal.wood);
      c.beginPath();
      c.rect(-0.28, -0.28, 0.56, 0.56);
      st(e, pal.woodDark, e.lw * 0.7);
      c.beginPath();
      line(c, -0.28, 0.28, 0.28, -0.28);
      st(e, pal.woodDark, e.lw * 0.9);
    },
  },
  {
    kind: 'throne',
    name: 'Trône',
    cat: 'Mobilier',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, pal } = e;
      rrect(c, -0.42, -0.42, 0.84, 0.28, 0.06);
      fs(e, pal.gold);
      rrect(c, -0.42, -0.2, 0.14, 0.58, 0.04);
      fs(e, pal.woodDark);
      rrect(c, 0.28, -0.2, 0.14, 0.58, 0.04);
      fs(e, pal.woodDark);
      rrect(c, -0.28, -0.16, 0.56, 0.52, 0.06);
      fs(e, pal.cloth);
      circle(c, 0, -0.29, 0.06);
      fs(e, pal.cloth, pal.ink, e.lw * 0.5);
    },
  },
  {
    kind: 'rug',
    name: 'Tapis',
    cat: 'Mobilier',
    w: 2,
    h: 3,
    layer: 0,
    draw: (e) => {
      const { c, w, h, pal } = e;
      c.beginPath();
      for (let x = -w / 2 + 0.12; x <= w / 2 - 0.1; x += 0.1) {
        line(c, x, -h / 2 + 0.02, x, -h / 2 + 0.12);
        line(c, x, h / 2 - 0.02, x, h / 2 - 0.12);
      }
      st(e, pal.gold, e.lw * 0.6);
      c.beginPath();
      c.rect(-w / 2 + 0.08, -h / 2 + 0.12, w - 0.16, h - 0.24);
      fs(e, pal.cloth);
      c.beginPath();
      c.rect(-w / 2 + 0.2, -h / 2 + 0.25, w - 0.4, h - 0.5);
      st(e, pal.gold, e.lw * 0.9);
      poly(c, [0, -h * 0.25, w * 0.25, 0, 0, h * 0.25, -w * 0.25, 0]);
      st(e, pal.gold, e.lw * 0.9);
    },
  },
  // --- Sacré & macabre
  {
    kind: 'altar',
    name: 'Autel',
    cat: 'Sacré',
    w: 2,
    h: 1,
    draw: (e) => {
      const { c, w, h, pal } = e;
      c.beginPath();
      c.rect(-w / 2 + 0.1, -h / 2 + 0.15, w - 0.2, h - 0.3);
      fs(e, pal.stone);
      c.beginPath();
      c.rect(-0.22, -h / 2 + 0.15, 0.44, h - 0.3);
      fs(e, pal.cloth, pal.ink, e.lw * 0.6);
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 - 0.32);
        circle(c, x, 0, 0.08);
        fs(e, pal.bone, pal.ink, e.lw * 0.5);
        flame(e, x, 0, 0.12);
      }
    },
  },
  {
    kind: 'sarcophagus',
    name: 'Sarcophage',
    cat: 'Sacré',
    w: 1,
    h: 2,
    draw: (e) => {
      const { c, h, pal } = e;
      const t = -h / 2 + 0.08,
        b = h / 2 - 0.08,
        s = -h / 2 + 0.55;
      poly(c, [-0.28, t, 0.28, t, 0.4, s, 0.26, b, -0.26, b, -0.4, s]);
      fs(e, pal.stone);
      poly(c, [-0.2, t + 0.1, 0.2, t + 0.1, 0.3, s, 0.19, b - 0.1, -0.19, b - 0.1, -0.3, s]);
      st(e, rgba(pal.ink, 0.5), e.lw * 0.6);
      c.beginPath();
      line(c, 0, t + 0.25, 0, t + 0.9);
      line(c, -0.15, t + 0.45, 0.15, t + 0.45);
      st(e, pal.ink, e.lw * 0.8);
    },
  },
  {
    kind: 'bones',
    rand: true,
    name: 'Ossements',
    cat: 'Sacré',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, pal, rng } = e;
      for (let i = 0; i < 3; i++) {
        const a = rng.float(0, Math.PI);
        const x = rng.float(-0.2, 0.2),
          y = rng.float(-0.2, 0.2);
        const l = rng.float(0.16, 0.26);
        const dx = Math.cos(a) * l,
          dy = Math.sin(a) * l;
        c.beginPath();
        line(c, x - dx, y - dy, x + dx, y + dy);
        st(e, pal.ink, e.lw * 2.6);
        c.beginPath();
        line(c, x - dx, y - dy, x + dx, y + dy);
        st(e, pal.bone, e.lw * 1.4);
        for (const s of [-1, 1]) {
          circle(c, x + s * dx, y + s * dy, 0.045);
          fs(e, pal.bone, pal.ink, e.lw * 0.5);
        }
      }
      const sx = rng.float(-0.2, 0.2),
        sy = rng.float(-0.2, 0.2);
      circle(c, sx, sy, 0.12);
      fs(e, pal.bone, pal.ink, e.lw * 0.7);
      c.beginPath();
      c.arc(sx - 0.04, sy, 0.025, 0, 7);
      c.moveTo(sx + 0.065, sy);
      c.arc(sx + 0.04, sy, 0.025, 0, 7);
      c.fillStyle = pal.ink;
      c.fill();
    },
  },
  {
    kind: 'runeCircle',
    name: 'Cercle rituel',
    cat: 'Sacré',
    w: 3,
    h: 3,
    layer: 0,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const R = (Math.min(w, h) / 2) * 0.92;
      circle(c, 0, 0, R);
      c.fillStyle = rgba(pal.magic, 0.12);
      c.fill();
      st(e, pal.magic, e.lw * 1.3);
      circle(c, 0, 0, R * 0.84);
      st(e, pal.magic, e.lw * 0.8);
      c.beginPath();
      for (let i = 0; i <= 5; i++) {
        const a = -Math.PI / 2 + ((i * 2) / 5) * Math.PI * 2;
        const x = Math.cos(a) * R * 0.84,
          y = Math.sin(a) * R * 0.84;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      st(e, pal.magic, e.lw * 0.9);
      c.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r1 = R * 0.87,
          r2 = R * 0.97;
        line(c, Math.cos(a) * r1, Math.sin(a) * r1, Math.cos(a + 0.12) * r2, Math.sin(a + 0.12) * r2);
      }
      st(e, pal.magic, e.lw * 0.7);
    },
  },
  {
    kind: 'well',
    name: 'Puits',
    cat: 'Sacré',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, pal } = e;
      circle(c, 0, 0, 0.42);
      fs(e, pal.stone, pal.ink, e.lw * 1.1);
      circle(c, 0, 0, 0.27);
      fs(e, darken(pal.water, 0.35), pal.ink, e.lw * 0.8);
      c.beginPath();
      c.rect(-0.46, -0.04, 0.92, 0.08);
      fs(e, pal.wood, pal.ink, e.lw * 0.6);
    },
  },
  {
    kind: 'fountain',
    name: 'Fontaine',
    cat: 'Sacré',
    w: 2,
    h: 2,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const R = (Math.min(w, h) / 2) * 0.92;
      circle(c, 0, 0, R);
      fs(e, pal.stone, pal.ink, e.lw * 1.2);
      circle(c, 0, 0, R * 0.8);
      fs(e, pal.water, pal.ink, e.lw * 0.8);
      circle(c, 0, 0, R * 0.42);
      st(e, lighten(pal.water, 0.35), e.lw * 0.7);
      circle(c, 0, 0, R * 0.6);
      st(e, lighten(pal.water, 0.25), e.lw * 0.6);
      circle(c, 0, 0, R * 0.2);
      fs(e, pal.stone, pal.ink, e.lw);
    },
  },
  // --- Lumière
  {
    kind: 'brazier',
    name: 'Brasero',
    cat: 'Lumière',
    w: 1,
    h: 1,
    light: { radius: 5, color: '#ff9a3c', anim: 'torch', intensity: 0.8 },
    draw: (e) => {
      const { c, pal } = e;
      c.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        line(c, Math.cos(a) * 0.26, Math.sin(a) * 0.26, Math.cos(a) * 0.4, Math.sin(a) * 0.4);
      }
      st(e, pal.metal, e.lw * 1.6);
      circle(c, 0, 0, 0.3);
      fs(e, pal.metal);
      circle(c, 0, 0, 0.21);
      fs(e, '#2a1508', pal.ink, e.lw * 0.5);
      flame(e, 0, 0, 0.26);
    },
  },
  {
    kind: 'torch',
    name: 'Torche murale',
    cat: 'Lumière',
    w: 0.5,
    h: 0.5,
    layer: 2,
    light: { radius: 4, color: '#ffa14a', anim: 'torch', intensity: 0.7 },
    draw: (e) => {
      const { c, pal } = e;
      c.beginPath();
      line(c, 0, -0.22, 0, 0.02);
      st(e, pal.ink, e.lw * 2.6);
      c.beginPath();
      line(c, 0, -0.22, 0, 0.02);
      st(e, pal.wood, e.lw * 1.4);
      flame(e, 0, 0.06, 0.17);
    },
  },
  {
    kind: 'campfire',
    rand: true,
    name: 'Feu de camp',
    cat: 'Lumière',
    w: 1,
    h: 1,
    light: { radius: 6, color: '#ff8c32', anim: 'flame', intensity: 0.85 },
    draw: (e) => {
      const { c, pal, rng } = e;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        circle(c, Math.cos(a) * 0.33, Math.sin(a) * 0.33, rng.float(0.07, 0.1));
        fs(e, pal.stone, pal.ink, e.lw * 0.6);
      }
      for (const a of [0.5, -0.6]) {
        c.save();
        c.rotate(a);
        rrect(c, -0.26, -0.05, 0.52, 0.1, 0.04);
        fs(e, pal.woodDark, pal.ink, e.lw * 0.6);
        c.restore();
      }
      flame(e, 0, 0, 0.28);
    },
  },
  {
    kind: 'crystals',
    rand: true,
    name: 'Cristaux',
    cat: 'Lumière',
    w: 1,
    h: 1,
    light: { radius: 2.5, color: '#9d7bff', anim: 'pulse', intensity: 0.5 },
    draw: (e) => {
      const { c, pal, rng } = e;
      for (let i = 0; i < 4; i++) {
        c.save();
        c.translate(rng.float(-0.18, 0.18), rng.float(-0.18, 0.18));
        c.rotate(rng.float(0, Math.PI));
        const l = rng.float(0.16, 0.28),
          t = rng.float(0.06, 0.09);
        poly(c, [-l, 0, -l * 0.6, -t, l * 0.6, -t, l, 0, l * 0.6, t, -l * 0.6, t]);
        fs(e, pal.magic, pal.ink, e.lw * 0.6);
        c.beginPath();
        line(c, -l * 0.8, 0, l * 0.8, 0);
        st(e, lighten(pal.magic, 0.5), e.lw * 0.5);
        c.restore();
      }
    },
  },
  // --- Nature
  {
    kind: 'tree',
    rand: true,
    name: 'Arbre',
    cat: 'Nature',
    w: 2,
    h: 2,
    layer: 2,
    draw: (e) => canopy(e, (Math.min(e.w, e.h) / 2) * 0.95, 7, e.pal.plant),
  },
  {
    kind: 'bush',
    rand: true,
    name: 'Buisson',
    cat: 'Nature',
    w: 1,
    h: 1,
    draw: (e) => canopy(e, (Math.min(e.w, e.h) / 2) * 0.85, 5, lighten(e.pal.plant, 0.1)),
  },
  {
    kind: 'mushrooms',
    rand: true,
    name: 'Champignons',
    cat: 'Nature',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, pal, rng } = e;
      for (let i = 0; i < 5; i++) {
        const x = rng.float(-0.3, 0.3),
          y = rng.float(-0.3, 0.3),
          r = rng.float(0.06, 0.13);
        circle(c, x, y, r);
        fs(e, rng.chance(0.6) ? pal.cloth : pal.magic, pal.ink, e.lw * 0.6);
        c.fillStyle = 'rgba(255,255,255,0.7)';
        circle(c, x - r * 0.3, y - r * 0.2, r * 0.22);
        c.fill();
      }
    },
  },
  {
    kind: 'web',
    name: "Toile d'araignée",
    cat: 'Nature',
    w: 1,
    h: 1,
    layer: 2,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const ox = -w / 2,
        oy = -h / 2;
      const R = Math.min(w, h) * 0.95;
      const n = 5;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1)) * (Math.PI / 2);
        line(c, ox, oy, ox + Math.cos(a) * R, oy + Math.sin(a) * R);
      }
      for (const f of [0.3, 0.55, 0.8]) {
        for (let i = 0; i < n; i++) {
          const a = (i / (n - 1)) * (Math.PI / 2);
          const x = ox + Math.cos(a) * R * f,
            y = oy + Math.sin(a) * R * f;
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
      }
      st(e, rgba(pal.ink, 0.55), e.lw * 0.5);
    },
  },
  // --- Pièges & trésors
  {
    kind: 'trap',
    tile: true,
    name: 'Piège (MJ)',
    cat: 'Pièges',
    w: 1,
    h: 1,
    gmOnly: true,
    draw: (e) => {
      const { c, pal } = e;
      c.save();
      c.setLineDash([0.08, 0.06]);
      c.beginPath();
      c.rect(-0.42, -0.42, 0.84, 0.84);
      c.fillStyle = rgba(pal.accent, 0.12);
      c.fill();
      st(e, pal.accent, e.lw);
      c.restore();
      c.beginPath();
      line(c, -0.2, -0.2, 0.2, 0.2);
      line(c, 0.2, -0.2, -0.2, 0.2);
      st(e, pal.accent, e.lw * 1.4);
    },
  },
  {
    kind: 'treasure',
    name: "Tas d'or",
    cat: 'Pièges',
    w: 1,
    h: 1,
    tile: true,
    rand: true,
    draw: (e) => {
      const { c, pal, rng } = e;
      for (let i = 0; i < 14; i++) {
        const a = rng.float(0, 6.28),
          d = Math.sqrt(rng.next()) * 0.32;
        circle(c, Math.cos(a) * d, Math.sin(a) * d, rng.float(0.05, 0.08));
        fs(e, pal.gold, pal.ink, e.lw * 0.5);
      }
    },
  },
  // --- Extérieur
  {
    kind: 'pine',
    name: 'Sapin',
    cat: 'Nature',
    w: 2,
    h: 2,
    layer: 2,
    rand: true,
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      const R = (Math.min(w, h) / 2) * 0.95;
      const n = rng.int(9, 12);
      const off = rng.float(0, 6.28);
      const layers: [number, string][] = [
        [1, darken(pal.plant, 0.3)],
        [0.72, darken(pal.plant, 0.1)],
        [0.45, lighten(pal.plant, 0.1)],
      ];
      for (const [f, col] of layers) {
        const pts: number[] = [];
        for (let i = 0; i < n * 2; i++) {
          const a = off + (i / (n * 2)) * Math.PI * 2 + f;
          const r = R * f * (i % 2 ? 0.62 : 1);
          pts.push(Math.cos(a) * r, Math.sin(a) * r);
        }
        poly(c, pts);
        fs(e, col, pal.ink, e.lw * (f === 1 ? 1.3 : 0.6));
      }
      circle(c, 0, 0, R * 0.08);
      fs(e, pal.woodDark, pal.ink, e.lw * 0.5);
    },
  },
  {
    kind: 'stump',
    name: 'Souche',
    cat: 'Nature',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, pal } = e;
      c.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.4;
        line(c, Math.cos(a) * 0.2, Math.sin(a) * 0.2, Math.cos(a + 0.15) * 0.42, Math.sin(a + 0.15) * 0.42);
      }
      st(e, pal.woodDark, e.lw * 2.2);
      circle(c, 0, 0, 0.28);
      fs(e, pal.wood, pal.ink, e.lw);
      circle(c, 0, 0, 0.18);
      st(e, rgba(pal.woodDark, 0.7), e.lw * 0.6);
      circle(c, 0, 0, 0.08);
      st(e, rgba(pal.woodDark, 0.7), e.lw * 0.6);
    },
  },
  {
    kind: 'log',
    name: 'Tronc couché',
    cat: 'Nature',
    w: 2,
    h: 0.8,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const t = h * 0.75;
      rrect(c, -w / 2 + 0.05, -t / 2, w - 0.1, t, t / 2);
      fs(e, pal.woodDark);
      c.beginPath();
      line(c, -w / 2 + 0.3, -t * 0.15, w / 2 - 0.5, -t * 0.2);
      line(c, -w / 2 + 0.5, t * 0.18, w / 2 - 0.4, t * 0.12);
      st(e, rgba(pal.ink, 0.45), e.lw * 0.6);
      c.beginPath();
      c.ellipse(w / 2 - 0.05 - t * 0.25, 0, t * 0.25, t / 2 - 0.02, 0, 0, Math.PI * 2);
      fs(e, pal.wood, pal.ink, e.lw * 0.8);
    },
  },
  {
    kind: 'flowers',
    name: 'Fleurs',
    cat: 'Nature',
    w: 1,
    h: 1,
    rand: true,
    layer: 0,
    draw: (e) => {
      const { c, pal, rng } = e;
      const colors = [pal.cloth, pal.magic, '#f4f1e8', pal.gold];
      for (let i = 0; i < 7; i++) {
        const x = rng.float(-0.35, 0.35),
          y = rng.float(-0.35, 0.35);
        const col = rng.pick(colors);
        c.fillStyle = col;
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          circle(c, x + Math.cos(a) * 0.045, y + Math.sin(a) * 0.045, 0.035);
          c.fill();
        }
        circle(c, x, y, 0.025);
        c.fillStyle = pal.gold;
        c.fill();
      }
    },
  },
  {
    kind: 'fence',
    name: 'Clôture',
    cat: 'Extérieur',
    w: 2,
    h: 0.4,
    draw: (e) => {
      const { c, w, pal } = e;
      c.beginPath();
      line(c, -w / 2, -0.06, w / 2, -0.06);
      line(c, -w / 2, 0.06, w / 2, 0.06);
      st(e, pal.ink, e.lw * 2.2);
      c.beginPath();
      line(c, -w / 2, -0.06, w / 2, -0.06);
      line(c, -w / 2, 0.06, w / 2, 0.06);
      st(e, pal.wood, e.lw * 1.1);
      const n = Math.max(2, Math.round(w) + 1);
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.08 + (i * (w - 0.16)) / (n - 1);
        c.beginPath();
        c.rect(x - 0.07, -0.12, 0.14, 0.24);
        fs(e, pal.woodDark, pal.ink, e.lw * 0.6);
      }
    },
  },
  {
    kind: 'cart',
    name: 'Charrette',
    cat: 'Extérieur',
    w: 1.6,
    h: 2.4,
    tile: true,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const top = -h / 2 + 0.6;
      c.beginPath();
      line(c, -0.22, -h / 2 + 0.05, -0.22, top);
      line(c, 0.22, -h / 2 + 0.05, 0.22, top);
      st(e, pal.ink, e.lw * 2.4);
      c.beginPath();
      line(c, -0.22, -h / 2 + 0.05, -0.22, top);
      line(c, 0.22, -h / 2 + 0.05, 0.22, top);
      st(e, pal.wood, e.lw * 1.2);
      for (const s of [-1, 1]) {
        c.beginPath();
        c.rect(s * (w / 2 - 0.07) - 0.07, top + (h / 2 - top) * 0.45 - 0.3, 0.14, 0.6);
        fs(e, pal.woodDark, pal.ink, e.lw * 0.7);
      }
      rrect(c, -w / 2 + 0.18, top, w - 0.36, h / 2 - top - 0.05, 0.05);
      fs(e, pal.wood);
      c.beginPath();
      for (let x = -w / 2 + 0.18 + 0.25; x < w / 2 - 0.2; x += 0.25) line(c, x, top, x, h / 2 - 0.05);
      st(e, rgba(pal.woodDark, 0.6), e.lw * 0.6);
    },
  },
  {
    kind: 'stall',
    name: 'Étal de marché',
    cat: 'Extérieur',
    w: 2,
    h: 1.6,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const x0 = -w / 2 + 0.05,
        y0 = -h / 2 + 0.05,
        bw = w - 0.1,
        bh = h - 0.1;
      c.beginPath();
      c.rect(x0, y0, bw, bh);
      fs(e, pal.paper);
      const n = 6;
      for (let i = 0; i < n; i += 2) {
        c.beginPath();
        c.rect(x0 + (i * bw) / n, y0, bw / n, bh);
        c.fillStyle = pal.cloth;
        c.fill();
      }
      c.beginPath();
      line(c, x0, 0, x0 + bw, 0);
      st(e, rgba(pal.ink, 0.5), e.lw * 0.8);
      c.beginPath();
      c.rect(x0, y0, bw, bh);
      st(e);
    },
  },
  {
    kind: 'haystack',
    name: 'Botte de foin',
    cat: 'Extérieur',
    w: 1,
    h: 1,
    draw: (e) => {
      const { c, pal } = e;
      const col = lighten(pal.gold, 0.15);
      rrect(c, -0.38, -0.3, 0.76, 0.6, 0.12);
      fs(e, col);
      c.beginPath();
      for (let i = 0; i < 6; i++) line(c, -0.3, -0.22 + i * 0.09, 0.3, -0.2 + i * 0.085);
      st(e, rgba(darken(col, 0.35), 0.8), e.lw * 0.5);
      c.beginPath();
      line(c, -0.12, -0.3, -0.12, 0.3);
      line(c, 0.12, -0.3, 0.12, 0.3);
      st(e, pal.woodDark, e.lw * 0.9);
    },
  },
  {
    kind: 'lantern',
    name: 'Lanterne',
    cat: 'Lumière',
    w: 0.6,
    h: 0.6,
    layer: 2,
    light: { radius: 5, color: '#ffcf7a', anim: 'torch', intensity: 0.7 },
    draw: (e) => {
      const { c, pal } = e;
      flame(e, 0, 0, 0.26);
      c.beginPath();
      c.rect(-0.1, -0.1, 0.2, 0.2);
      fs(e, 'rgba(255,230,160,0.85)', pal.ink, e.lw * 0.9);
      c.beginPath();
      line(c, -0.1, 0, 0.1, 0);
      line(c, 0, -0.1, 0, 0.1);
      st(e, pal.metal, e.lw * 0.6);
    },
  },
  {
    kind: 'bench',
    name: 'Banc',
    cat: 'Extérieur',
    w: 2,
    h: 0.6,
    draw: (e) => {
      const { c, w, h, pal } = e;
      rrect(c, -w / 2 + 0.08, -h / 2 + 0.1, w - 0.16, h - 0.2, 0.05);
      fs(e, pal.wood);
      c.beginPath();
      line(c, -w / 2 + 0.12, 0, w / 2 - 0.12, 0);
      st(e, rgba(pal.woodDark, 0.7), e.lw * 0.6);
    },
  },
  {
    kind: 'anvil',
    name: 'Enclume',
    cat: 'Extérieur',
    w: 1,
    h: 0.7,
    draw: (e) => {
      const { c, pal } = e;
      c.beginPath();
      c.rect(-0.3, -0.24, 0.5, 0.48);
      fs(e, pal.woodDark, pal.ink, e.lw * 0.7);
      poly(c, [-0.36, -0.14, 0.18, -0.14, 0.46, 0, 0.18, 0.14, -0.36, 0.14]);
      fs(e, pal.metal, pal.ink, e.lw);
      c.beginPath();
      line(c, -0.3, 0, 0.3, 0);
      st(e, 'rgba(255,255,255,0.35)', e.lw * 0.6);
    },
  },
  {
    kind: 'signpost',
    name: 'Panneau',
    cat: 'Extérieur',
    w: 1,
    h: 1,
    layer: 2,
    draw: (e) => {
      const { c, pal } = e;
      for (const a of [-0.35, 2.4]) {
        c.save();
        c.rotate(a);
        poly(c, [0.05, -0.08, 0.36, -0.08, 0.44, 0, 0.36, 0.08, 0.05, 0.08]);
        fs(e, pal.wood, pal.ink, e.lw * 0.7);
        c.restore();
      }
      circle(c, 0, 0, 0.08);
      fs(e, pal.woodDark, pal.ink, e.lw * 0.7);
    },
  },
  {
    kind: 'bridge',
    name: 'Pont',
    cat: 'Extérieur',
    w: 2,
    h: 3,
    layer: 0,
    draw: (e) => {
      const { c, w, h, pal } = e;
      c.beginPath();
      c.rect(-w / 2 + 0.1, -h / 2, w - 0.2, h);
      fs(e, pal.wood, pal.ink, 0);
      c.beginPath();
      for (let y = -h / 2 + 0.25; y < h / 2; y += 0.25) line(c, -w / 2 + 0.1, y, w / 2 - 0.1, y);
      st(e, rgba(pal.woodDark, 0.75), e.lw * 0.6);
      c.beginPath();
      line(c, -w / 2 + 0.1, -h / 2, -w / 2 + 0.1, h / 2);
      line(c, w / 2 - 0.1, -h / 2, w / 2 - 0.1, h / 2);
      st(e, pal.ink, e.lw * 3);
      c.beginPath();
      line(c, -w / 2 + 0.1, -h / 2, -w / 2 + 0.1, h / 2);
      line(c, w / 2 - 0.1, -h / 2, w / 2 - 0.1, h / 2);
      st(e, pal.woodDark, e.lw * 1.6);
    },
  },
  {
    kind: 'tent',
    name: 'Tente',
    cat: 'Extérieur',
    w: 2,
    h: 2,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const x0 = -w / 2 + 0.15,
        y0 = -h / 2 + 0.1,
        bw = w - 0.3,
        bh = h - 0.2;
      c.beginPath();
      c.rect(x0, y0, bw / 2, bh);
      fs(e, pal.paper, pal.ink, 0);
      c.beginPath();
      c.rect(0, y0, bw / 2, bh);
      fs(e, darken(pal.paper, 0.18), pal.ink, 0);
      poly(c, [-0.25, h / 2 - 0.1, 0, h / 2 - 0.55, 0.25, h / 2 - 0.1]);
      fs(e, darken(pal.paper, 0.45), pal.ink, e.lw * 0.6);
      c.beginPath();
      c.rect(x0, y0, bw, bh);
      line(c, 0, y0, 0, y0 + bh);
      st(e);
    },
  },
  {
    kind: 'gravestone',
    name: 'Pierre tombale',
    cat: 'Sacré',
    w: 1,
    h: 0.5,
    draw: (e) => {
      const { c, pal } = e;
      c.beginPath();
      c.moveTo(-0.28, 0.18);
      c.lineTo(-0.28, -0.02);
      c.arc(0, -0.02, 0.28, Math.PI, 0);
      c.lineTo(0.28, 0.18);
      c.closePath();
      fs(e, pal.stone);
      c.beginPath();
      line(c, 0, -0.18, 0, 0.1);
      line(c, -0.08, -0.08, 0.08, -0.08);
      st(e, rgba(pal.ink, 0.6), e.lw * 0.7);
    },
  },
  // --- Toits (tuiles Foundry au-dessus des jetons)
  roofDef('roofThatch', 'Toit de chaume', 'thatch', (p) => mix(p.wood, '#c9a45f', 0.65)),
  roofDef('roofTiles', 'Toit de tuiles', 'tiles', (p) => mix(p.wood, '#b24a30', 0.75)),
  roofDef('roofSlate', 'Toit d’ardoise', 'slate', (p) => mix(p.stone, '#4d5864', 0.7)),
  roofDef('roofShingle', 'Toit de bardeaux', 'shingle', (p) => mix(p.woodDark, '#7a5534', 0.55)),
  {
    kind: 'awning',
    name: 'Auvent',
    cat: 'Toits',
    w: 3,
    h: 1.5,
    layer: 3,
    roof: true,
    area: true,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const n = Math.max(2, Math.round(w / 0.5));
      const sw = w / n;
      for (let i = 0; i < n; i++) {
        c.beginPath();
        c.rect(-w / 2 + i * sw, -h / 2, sw, h - 0.12);
        c.fillStyle = i % 2 ? pal.paper : pal.cloth;
        c.fill();
        c.beginPath();
        c.arc(-w / 2 + (i + 0.5) * sw, h / 2 - 0.12, sw / 2, 0, Math.PI);
        c.fillStyle = i % 2 ? darken(pal.paper, 0.1) : darken(pal.cloth, 0.1);
        c.fill();
      }
      c.beginPath();
      c.rect(-w / 2, -h / 2, w, h - 0.12);
      st(e);
    },
  },
  {
    kind: 'canopy',
    rand: true,
    name: 'Frondaison',
    cat: 'Toits',
    w: 4,
    h: 4,
    layer: 3,
    roof: true,
    draw: (e) => canopy(e, (Math.min(e.w, e.h) / 2) * 0.97, 9, darken(e.pal.plant, 0.06)),
  },
  // Image personnelle (bibliothèque) : dessinée par drawProp, absente du catalogue
  { kind: 'image', name: 'Image', cat: '', w: 1, h: 1, draw: () => undefined },
];

export const PROP_BY_KIND: Record<string, PropDef> = Object.fromEntries(PROPS.map((p) => [p.kind, p]));

export const PROP_CATS = [...new Set(PROPS.filter((p) => p.cat).map((p) => p.cat))];

export type Skins = Record<string, string[]> | undefined;

const rngCache = new Map<string, number>();

function seedOf(id: string): number {
  let seed = rngCache.get(id);
  if (seed === undefined) {
    seed = hashString(id);
    rngCache.set(id, seed);
  }
  return seed;
}

/** Image personnelle dessinée pour cet objet (objet « image », ou habillage d'un objet intégré). */
export function propAsset(p: Prop, skins: Skins): string | undefined {
  if (p.kind === 'image') return p.asset;
  const list = skins?.[p.kind];
  if (!list || !list.length) return undefined;
  return list.length === 1 ? list[0] : list[seedOf(p.id) % list.length];
}

/** Taille de l'image dans la boîte de l'objet : étirée (objet image) ou contenue sans déformation (habillage). */
export function assetBox(p: Prop, a: { w: number; h: number }): { w: number; h: number } {
  if (p.kind === 'image') return { w: p.w, h: p.h };
  const ar = a.w / a.h;
  return ar > p.w / p.h ? { w: p.w, h: p.w / ar } : { w: p.h * ar, h: p.h };
}

function drawAsset(c: Ctx, p: Prop, a: Asset): void {
  const b = assetBox(p, a);
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(a.img, -b.w / 2, -b.h / 2, b.w, b.h);
}

function drawMissing(c: Ctx, p: Prop, pal: PropPalette): void {
  c.beginPath();
  c.rect(-p.w / 2, -p.h / 2, p.w, p.h);
  c.moveTo(-p.w / 2, -p.h / 2);
  c.lineTo(p.w / 2, p.h / 2);
  c.moveTo(p.w / 2, -p.h / 2);
  c.lineTo(-p.w / 2, p.h / 2);
  c.setLineDash([0.12, 0.08]);
  c.lineWidth = 0.04;
  c.strokeStyle = rgba(pal.accent, 0.8);
  c.stroke();
  c.setLineDash([]);
}

export function drawProp(c: Ctx, p: Prop, pal: PropPalette, skins?: Skins): void {
  const def = PROP_BY_KIND[p.kind];
  if (!def) return;
  c.save();
  c.translate(p.x, p.y);
  if (p.rot) c.rotate((p.rot * Math.PI) / 180);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const aid = propAsset(p, skins);
  const a = aid ? assetImage(aid) : null;
  if (a) drawAsset(c, p, a);
  else if (p.kind === 'image') drawMissing(c, p, pal);
  else def.draw({ c, w: p.w, h: p.h, pal, rng: new Rng(seedOf(p.id)), lw: 0.045 });
  c.restore();
}

/** Toit : au-dessus des jetons dans Foundry (s'efface quand un jeton passe dessous). */
export function isRoof(p: Prop): boolean {
  return p.roof ?? !!PROP_BY_KIND[p.kind]?.roof;
}

/** L'objet est-il exporté comme tuile séparée dans Foundry ? (les toits le sont toujours) */
export function isTile(p: Prop): boolean {
  return isRoof(p) || (p.tile ?? !!PROP_BY_KIND[p.kind]?.tile);
}

/** Ordre de dessin : 0 au sol, 1 normal, 2 dessus, 3 toits. */
export function propLayer(p: Prop): number {
  return isRoof(p) ? 3 : (PROP_BY_KIND[p.kind]?.layer ?? 1);
}

/** Lumière émise par un objet (brasero, torche...), ou null. */
export function propLight(p: Prop): PropLight | null {
  if (p.noLight) return null;
  return PROP_BY_KIND[p.kind]?.light ?? null;
}

/** Empreinte au sol d'un objet tourné (boîte englobante alignée). */
export function propBounds(p: Prop): { x0: number; y0: number; x1: number; y1: number } {
  const a = ((p.rot % 360) + 360) % 360;
  const swap = a === 90 || a === 270;
  let hw = (swap ? p.h : p.w) / 2,
    hh = (swap ? p.w : p.h) / 2;
  if (a % 90 !== 0) {
    const r = (a * Math.PI) / 180;
    const cs = Math.abs(Math.cos(r)),
      sn = Math.abs(Math.sin(r));
    hw = (p.w * cs + p.h * sn) / 2;
    hh = (p.w * sn + p.h * cs) / 2;
  }
  return { x0: p.x - hw, y0: p.y - hh, x1: p.x + hw, y1: p.y + hh };
}

/** Le point (monde) est-il sur l'objet ? */
export function hitProp(p: Prop, x: number, y: number): boolean {
  const r = (-p.rot * Math.PI) / 180;
  const dx = x - p.x,
    dy = y - p.y;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= p.w / 2 && Math.abs(ly) <= p.h / 2;
}
