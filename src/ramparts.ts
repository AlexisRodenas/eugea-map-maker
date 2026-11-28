// Remparts et murailles : lignes brisées épaisses (pierre crénelée ou palissade de rondins),
// tours aux angles. Dessin, murs Foundry (les deux faces + les tours), sélection.
import { DungeonMap, EDGE, Prop, Rampart, RampartStyle } from './model';
import type { Seg } from './geometry';
import type { ResolvedTheme } from './themes';
import { Rng, darken, hashString, lighten, mix, rgba, uid } from './util';

type Ctx = CanvasRenderingContext2D;

export const RAMPART_STYLES: [RampartStyle, string][] = [
  ['stone', 'Pierre crénelée'],
  ['palisade', 'Palissade'],
];

/** Sommets en coordonnées absolues (cases). */
export function rampartPoints(r: Rampart): number[] {
  return r.pts.map((v, i) => v + (i % 2 ? r.y : r.x));
}

/** Rayon (ou demi-côté) des tours. */
export function towerSize(r: Rampart): number {
  return r.style === 'palisade' ? Math.max(0.6, r.width * 1.3) : Math.max(0.75, r.width * 0.95);
}

/** Sommets portant une tour : tous ceux d'une boucle ; pour une ligne ouverte, les extrémités selon `ends`. */
function towerPoints(r: Rampart, P: number[]): number[] {
  if (!r.towers) return [];
  if (r.closed) return P;
  const [a, b] = r.ends ?? [true, true];
  const n = P.length;
  return P.filter((_, i) => (i > 1 || a) && (i < n - 2 || b));
}

/** +1 : l'extérieur (créneaux) est à gauche du sens de parcours ; -1 : à droite. */
function outerSide(r: Rampart, P: number[]): number {
  let s = 1;
  if (r.closed && P.length >= 6) {
    let a = 0;
    for (let i = 0; i < P.length; i += 2) {
      const j = (i + 2) % P.length;
      a += P[i] * P[j + 1] - P[j] * P[i + 1];
    }
    // repère écran (y vers le bas) : aire positive = sens horaire, l'extérieur est à gauche
    s = a > 0 ? 1 : -1;
  }
  return r.flip ? -s : s;
}

function pathOf(c: Ctx | Path2D, P: number[], closed: boolean): void {
  c.moveTo(P[0], P[1]);
  for (let i = 2; i < P.length; i += 2) c.lineTo(P[i], P[i + 1]);
  if (closed) c.closePath();
}

function segmentsOf(P: number[], closed: boolean): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const n = P.length / 2;
  for (let i = 0; i < n - 1; i++) out.push([P[i * 2], P[i * 2 + 1], P[i * 2 + 2], P[i * 2 + 3]]);
  if (closed && n > 2) out.push([P[n * 2 - 2], P[n * 2 - 1], P[0], P[1]]);
  return out;
}

// ---------- Dessin ----------

function stoneColor(theme: ResolvedTheme): string {
  return mix(theme.pal.stone, '#9a948a', 0.35);
}

function drawStone(c: Ctx, r: Rampart, P: number[], theme: ResolvedTheme, px: number): void {
  const W = r.width;
  const ink = theme.pal.ink;
  const base = stoneColor(theme);
  const side = outerSide(r, P);
  const rng = new Rng(hashString(r.id));
  // corps
  c.beginPath();
  pathOf(c, P, r.closed);
  c.lineJoin = r.towers ? 'miter' : 'round';
  c.miterLimit = 3;
  c.lineCap = 'butt';
  c.strokeStyle = ink;
  c.lineWidth = W + Math.max(0.09, 2 * px);
  c.stroke();
  c.strokeStyle = base;
  c.lineWidth = W;
  c.stroke();
  // détail par tronçon : chemin de ronde, assises de pierres, créneaux
  for (const [x1, y1, x2, y2] of segmentsOf(P, r.closed)) {
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L < 0.05) continue;
    c.save();
    c.translate(x1, y1);
    c.rotate(Math.atan2(y2 - y1, x2 - x1));
    if (side < 0) c.scale(1, -1); // l'extérieur toujours vers y < 0 dans ce repère
    c.beginPath();
    c.rect(0, -W / 2, L, W);
    c.clip();
    const merlon = Math.min(0.24, W * 0.3);
    // chemin de ronde (côté intérieur), plus clair
    const g = c.createLinearGradient(0, -W / 2, 0, W / 2);
    g.addColorStop(0, darken(base, 0.12));
    g.addColorStop(0.35, lighten(base, 0.06));
    g.addColorStop(1, darken(base, 0.06));
    c.fillStyle = g;
    c.fillRect(0, -W / 2 + merlon, L, W - merlon);
    // assises
    const rows = Math.max(2, Math.round((W - merlon) / 0.3));
    const rh = (W - merlon) / rows;
    c.beginPath();
    for (let k = 1; k < rows; k++) {
      const y = -W / 2 + merlon + k * rh;
      c.moveTo(0, y);
      c.lineTo(L, y);
    }
    for (let k = 0; k < rows; k++) {
      const y0 = -W / 2 + merlon + k * rh;
      for (let u = (k % 2) * 0.22 + rng.float(0, 0.1); u < L; u += rng.float(0.32, 0.55)) {
        c.moveTo(u, y0);
        c.lineTo(u, y0 + rh);
      }
    }
    c.strokeStyle = rgba(ink, 0.32);
    c.lineWidth = Math.max(0.018, px * 0.8);
    c.stroke();
    // quelques pierres plus claires ou plus sombres
    for (let k = 0; k < L * rows * 0.5; k++) {
      const u = rng.float(0, L),
        row = rng.int(0, rows - 1);
      c.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
      c.fillRect(u, -W / 2 + merlon + row * rh, rng.float(0.2, 0.4), rh);
    }
    // créneaux (côté extérieur)
    c.fillStyle = darken(base, 0.3);
    c.fillRect(0, -W / 2, L, merlon);
    c.beginPath();
    const step = 0.5;
    for (let u = 0.06; u < L - 0.05; u += step) c.rect(u, -W / 2, Math.min(0.3, L - u), merlon);
    c.fillStyle = lighten(base, 0.1);
    c.fill();
    c.strokeStyle = rgba(ink, 0.6);
    c.lineWidth = Math.max(0.02, px);
    c.stroke();
    // ligne intérieure du parapet
    c.beginPath();
    c.moveTo(0, -W / 2 + merlon);
    c.lineTo(L, -W / 2 + merlon);
    c.strokeStyle = rgba(ink, 0.55);
    c.lineWidth = Math.max(0.025, px);
    c.stroke();
    c.restore();
  }
  // tours rondes
  const R = towerSize(r);
  const T = towerPoints(r, P);
  for (let i = 0; i < T.length; i += 2) {
    const x = T[i],
      y = T[i + 1];
    c.beginPath();
    c.arc(x, y, R, 0, Math.PI * 2);
    const g = c.createRadialGradient(x - R * 0.3, y - R * 0.35, R * 0.1, x, y, R);
    g.addColorStop(0, lighten(base, 0.1));
    g.addColorStop(1, darken(base, 0.18));
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = ink;
    c.lineWidth = Math.max(0.05, 1.5 * px);
    c.stroke();
    // créneaux en couronne
    const n = Math.max(8, Math.round((Math.PI * 2 * R) / 0.5));
    const ri = R * 0.74;
    c.beginPath();
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2,
        a1 = a0 + (Math.PI * 2) / n / 2;
      c.moveTo(x + Math.cos(a0) * ri, y + Math.sin(a0) * ri);
      c.arc(x, y, R, a0, a1);
      c.arc(x, y, ri, a1, a0, true);
    }
    c.fillStyle = lighten(base, 0.14);
    c.fill();
    c.strokeStyle = rgba(ink, 0.5);
    c.lineWidth = Math.max(0.015, px * 0.8);
    c.stroke();
    // plateforme
    c.beginPath();
    c.arc(x, y, ri, 0, Math.PI * 2);
    c.fillStyle = darken(base, 0.08);
    c.fill();
    c.strokeStyle = rgba(ink, 0.6);
    c.lineWidth = Math.max(0.025, px);
    c.stroke();
    c.beginPath();
    for (let k = 1; k < 4; k++) {
      c.moveTo(x - ri, y + (k / 4 - 0.5) * ri * 2);
      c.lineTo(x + ri, y + (k / 4 - 0.5) * ri * 2);
    }
    c.save();
    c.beginPath();
    c.arc(x, y, ri, 0, Math.PI * 2);
    c.clip();
    c.beginPath();
    for (let k = 1; k < 5; k++) {
      const yy = y - ri + (k / 5) * ri * 2;
      c.moveTo(x - ri, yy);
      c.lineTo(x + ri, yy);
    }
    c.strokeStyle = rgba(ink, 0.25);
    c.lineWidth = Math.max(0.015, px * 0.7);
    c.stroke();
    c.restore();
  }
}

function drawPalisade(c: Ctx, r: Rampart, P: number[], theme: ResolvedTheme, px: number): void {
  const ink = theme.pal.ink;
  const wood = theme.pal.wood,
    dark = theme.pal.woodDark;
  const rr = Math.max(0.1, Math.min(0.4, r.width / 2));
  const rng = new Rng(hashString(r.id));
  // traverse (poutre) derrière les rondins
  c.beginPath();
  pathOf(c, P, r.closed);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = ink;
  c.lineWidth = rr * 1.5 + 2 * px;
  c.stroke();
  c.strokeStyle = dark;
  c.lineWidth = rr * 1.5;
  c.stroke();
  // rondins régulièrement espacés le long du tracé
  const step = rr * 1.85;
  let carry = 0;
  const logs: number[] = [];
  for (const [x1, y1, x2, y2] of segmentsOf(P, r.closed)) {
    const L = Math.hypot(x2 - x1, y2 - y1);
    let d = carry;
    for (; d <= L; d += step) logs.push(x1 + ((x2 - x1) * d) / L, y1 + ((y2 - y1) * d) / L);
    carry = d - L;
  }
  for (let i = 0; i < logs.length; i += 2) {
    const x = logs[i],
      y = logs[i + 1];
    const k = rng.float(0.88, 1.06);
    const g = c.createRadialGradient(x - rr * 0.3, y - rr * 0.3, 0, x, y, rr * k);
    g.addColorStop(0, lighten(wood, 0.25));
    g.addColorStop(0.7, wood);
    g.addColorStop(1, darken(wood, 0.2));
    c.beginPath();
    c.arc(x, y, rr * k, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = ink;
    c.lineWidth = Math.max(0.03, px * 1.2);
    c.stroke();
    // pointe taillée vue de dessus : cernes concentriques
    c.beginPath();
    c.arc(x, y, rr * k * 0.55, 0, Math.PI * 2);
    c.moveTo(x + rr * 0.18, y);
    c.arc(x, y, rr * k * 0.18, 0, Math.PI * 2);
    c.strokeStyle = rgba(dark, 0.6);
    c.lineWidth = Math.max(0.012, px * 0.6);
    c.stroke();
  }
  // tours de guet carrées en bois
  const R = towerSize(r);
  const T = towerPoints(r, P);
  for (let i = 0; i < T.length; i += 2) {
    const x = T[i],
      y = T[i + 1];
    c.beginPath();
    c.rect(x - R, y - R, R * 2, R * 2);
    c.fillStyle = wood;
    c.fill();
    c.save();
    c.clip();
    c.beginPath();
    for (let u = -R + 0.22; u < R; u += 0.22) {
      c.moveTo(x + u, y - R);
      c.lineTo(x + u, y + R);
    }
    c.strokeStyle = rgba(dark, 0.7);
    c.lineWidth = Math.max(0.015, px * 0.8);
    c.stroke();
    const g = c.createLinearGradient(x - R, y - R, x + R, y + R);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    c.fillStyle = g;
    c.fillRect(x - R, y - R, R * 2, R * 2);
    c.restore();
    c.beginPath();
    c.rect(x - R, y - R, R * 2, R * 2);
    c.strokeStyle = ink;
    c.lineWidth = Math.max(0.05, 1.5 * px);
    c.stroke();
    // poteaux d'angle
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      c.beginPath();
      c.arc(x + sx * (R - 0.1), y + sy * (R - 0.1), 0.1, 0, Math.PI * 2);
      c.fillStyle = dark;
      c.fill();
      c.strokeStyle = ink;
      c.lineWidth = Math.max(0.02, px);
      c.stroke();
    }
  }
}

/** Ombre portée (avant le dessin, pour tous les remparts visibles). */
function drawShadow(c: Ctx, r: Rampart, P: number[], dark: boolean): void {
  c.save();
  c.translate(0.22, 0.3);
  c.fillStyle = c.strokeStyle = dark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.24)';
  c.beginPath();
  pathOf(c, P, r.closed);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.lineWidth = r.style === 'palisade' ? Math.max(0.2, Math.min(0.8, r.width)) : r.width;
  c.stroke();
  const R = towerSize(r);
  const T = towerPoints(r, P);
  c.beginPath();
  for (let i = 0; i < T.length; i += 2) {
    if (r.style === 'palisade') c.rect(T[i] - R, T[i + 1] - R, R * 2, R * 2);
    else {
      c.moveTo(T[i] + R, T[i + 1]);
      c.arc(T[i], T[i + 1], R, 0, Math.PI * 2);
    }
  }
  c.fill();
  c.restore();
}

export function rampartBounds(r: Rampart): { x0: number; y0: number; x1: number; y1: number } {
  const P = rampartPoints(r);
  const m = r.width / 2 + (r.towers ? towerSize(r) : 0) + 0.4;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < P.length; i += 2) {
    x0 = Math.min(x0, P[i] - m);
    x1 = Math.max(x1, P[i] + m);
    y0 = Math.min(y0, P[i + 1] - m);
    y1 = Math.max(y1, P[i + 1] + m);
  }
  return { x0, y0, x1, y1 };
}

/** Dessine les remparts du niveau (ombres d'abord). */
export function drawRamparts(c: Ctx, list: Rampart[], theme: ResolvedTheme, px: number, view?: { x0: number; y0: number; x1: number; y1: number }): void {
  const vis = list.filter((r) => {
    if (r.pts.length < 4) return false;
    if (!view) return true;
    const b = rampartBounds(r);
    return b.x1 >= view.x0 && b.x0 <= view.x1 && b.y1 >= view.y0 && b.y0 <= view.y1;
  });
  if (!vis.length) return;
  c.save();
  for (const r of vis) drawShadow(c, r, rampartPoints(r), theme.dark);
  for (const r of vis) {
    const P = rampartPoints(r);
    if (r.style === 'palisade') drawPalisade(c, r, P, theme, px);
    else drawStone(c, r, P, theme, px);
  }
  c.restore();
}

/** Contour de sélection (pointillés). */
export function strokeRampartOutline(c: Ctx, r: Rampart, color: string, px: number): void {
  const P = rampartPoints(r);
  c.save();
  c.beginPath();
  pathOf(c, P, r.closed);
  c.setLineDash([px * 6, px * 4]);
  c.strokeStyle = color;
  c.lineWidth = px * 2;
  c.lineJoin = 'round';
  c.stroke();
  c.setLineDash([]);
  for (let i = 0; i < P.length; i += 2) {
    c.beginPath();
    c.arc(P[i], P[i + 1], px * 4, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
  }
  c.restore();
}

// ---------- Géométrie : murs Foundry, éclairage, sélection ----------

/** Ligne décalée de `d` (à gauche du sens de parcours), raccords en onglet. */
function offsetLine(P: number[], closed: boolean, d: number): number[] {
  const n = P.length / 2;
  const nrm = (i: number, j: number): [number, number] => {
    const dx = P[j * 2] - P[i * 2],
      dy = P[j * 2 + 1] - P[i * 2 + 1];
    const L = Math.hypot(dx, dy) || 1;
    return [dy / L, -dx / L];
  };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const hasPrev = closed || i > 0,
      hasNext = closed || i < n - 1;
    const a = hasPrev ? nrm((i - 1 + n) % n, i) : null;
    const b = hasNext ? nrm(i, (i + 1) % n) : null;
    let mx: number, my: number, len: number;
    if (a && b) {
      mx = a[0] + b[0];
      my = a[1] + b[1];
      const L = Math.hypot(mx, my);
      if (L < 1e-6) {
        mx = b[0];
        my = b[1];
        len = d;
      } else {
        mx /= L;
        my /= L;
        len = Math.min(3 * Math.abs(d), Math.abs(d / (mx * b[0] + my * b[1]))) * Math.sign(d);
      }
    } else {
      const v = (a ?? b)!;
      mx = v[0];
      my = v[1];
      len = d;
    }
    out.push(P[i * 2] + mx * len, P[i * 2 + 1] + my * len);
  }
  return out;
}

function polySegs(out: Seg[], P: number[], closed: boolean, type: number): void {
  for (const [x1, y1, x2, y2] of segmentsOf(P, closed)) out.push({ x1, y1, x2, y2, type });
}

/** Murs Foundry / aperçu d'éclairage : les deux faces de chaque rempart, les extrémités et les tours. */
export function rampartSegments(map: DungeonMap): Seg[] {
  const out: Seg[] = [];
  for (const r of map.ramparts) {
    const P = rampartPoints(r);
    if (P.length < 4) continue;
    const W = r.style === 'palisade' ? Math.max(0.2, Math.min(0.8, r.width)) : r.width;
    const A = offsetLine(P, r.closed, W / 2),
      B = offsetLine(P, r.closed, -W / 2);
    polySegs(out, A, r.closed, EDGE.WALL);
    polySegs(out, B, r.closed, EDGE.WALL);
    if (!r.closed) {
      const n = A.length;
      out.push({ x1: A[0], y1: A[1], x2: B[0], y2: B[1], type: EDGE.WALL });
      out.push({ x1: A[n - 2], y1: A[n - 1], x2: B[n - 2], y2: B[n - 1], type: EDGE.WALL });
    }
    const R = towerSize(r);
    const T = towerPoints(r, P);
    for (let i = 0; i < T.length; i += 2) {
      const pts: number[] = [];
      const k = r.style === 'palisade' ? 4 : 8;
      for (let j = 0; j < k; j++) {
        const a = (j / k) * Math.PI * 2 + Math.PI / k;
        const rr = r.style === 'palisade' ? R * Math.SQRT2 : R / Math.cos(Math.PI / k);
        pts.push(T[i] + Math.cos(a) * rr, T[i + 1] + Math.sin(a) * rr);
      }
      polySegs(out, pts, true, EDGE.WALL);
    }
  }
  return out;
}

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1,
    dy = y2 - y1;
  const L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Taille d'une porte selon le style du rempart. */
function gateSize(r: Rampart): { kind: string; w: number; h: number; half: number } {
  return r.style === 'palisade'
    ? { kind: 'palisadeGate', w: 3, h: 0.8, half: 1.1 }
    : { kind: 'cityGate', w: 4, h: Math.max(1.6, +(r.width + 0.6).toFixed(2)), half: 1.4 };
}

function fromAbs(src: Rampart, P: number[], ends: [boolean, boolean]): Rampart {
  const x = P[0],
    y = P[1];
  return { ...src, id: uid(), x, y, pts: P.map((v, i) => +(v - (i % 2 ? y : x)).toFixed(3)), closed: false, ends };
}

/**
 * Perce une porte dans un rempart au point (x, y) : le tracé est coupé (une enceinte fermée
 * devient une ligne ouverte, une ligne ouverte devient deux) et une porte assortie est posée
 * dans la brèche, dans l'axe du mur. Renvoie null si le point est loin du rempart ou le tronçon trop court.
 */
export function cutGate(r: Rampart, x: number, y: number): { parts: Rampart[]; gate: Prop } | null {
  const P = rampartPoints(r);
  const segs = segmentsOf(P, r.closed);
  let best = -1,
    bt = 0,
    bd = Infinity;
  segs.forEach(([x1, y1, x2, y2], k) => {
    const dx = x2 - x1,
      dy = y2 - y1;
    const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L2));
    const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
    if (d < bd) {
      bd = d;
      best = k;
      bt = t;
    }
  });
  if (best < 0 || bd > r.width / 2 + 0.6) return null;
  const g = gateSize(r);
  const [x1, y1, x2, y2] = segs[best];
  const L = Math.hypot(x2 - x1, y2 - y1);
  if (L < 2 * g.half + 0.2) return null;
  const ux = (x2 - x1) / L,
    uy = (y2 - y1) / L;
  const t = Math.max(g.half + 0.05, Math.min(L - g.half - 0.05, bt * L));
  const cx = x1 + ux * t,
    cy = y1 + uy * t;
  const s1 = [x1 + ux * (t - g.half), y1 + uy * (t - g.half)],
    s2 = [x1 + ux * (t + g.half), y1 + uy * (t + g.half)];
  const n = P.length / 2;
  let parts: Rampart[];
  if (r.closed) {
    const seq: number[] = [...s2];
    for (let i = 1; i <= n; i++) {
      const k = (best + i) % n;
      seq.push(P[k * 2], P[k * 2 + 1]);
    }
    seq.push(...s1);
    parts = [fromAbs(r, seq, [false, false])];
  } else {
    const [ea, eb] = r.ends ?? [true, true];
    parts = [fromAbs(r, [...P.slice(0, (best + 1) * 2), ...s1], [ea, false]), fromAbs(r, [...s2, ...P.slice((best + 1) * 2)], [false, eb])];
  }
  const gate: Prop = { id: uid(), kind: g.kind, x: +cx.toFixed(3), y: +cy.toFixed(3), w: g.w, h: g.h, rot: Math.round((Math.atan2(uy, ux) * 180) / Math.PI + 360) % 360, gmOnly: false };
  return { parts, gate };
}

export function hitRampart(r: Rampart, x: number, y: number): boolean {
  const P = rampartPoints(r);
  const W = Math.max(0.3, r.width);
  for (const [x1, y1, x2, y2] of segmentsOf(P, r.closed)) if (distToSeg(x, y, x1, y1, x2, y2) <= W / 2 + 0.1) return true;
  if (r.towers) {
    const R = towerSize(r);
    for (let i = 0; i < P.length; i += 2) if (Math.hypot(x - P[i], y - P[i + 1]) <= R) return true;
  }
  return false;
}

/** Sommet le plus proche (pour l'édition), à moins de `tol` cases. */
export function nearestVertex(list: Rampart[], x: number, y: number, tol: number): { r: Rampart; i: number } | null {
  let best: { r: Rampart; i: number } | null = null;
  let bd = tol;
  for (const r of list)
    for (let i = 0; i < r.pts.length; i += 2) {
      const d = Math.hypot(x - (r.x + r.pts[i]), y - (r.y + r.pts[i + 1]));
      if (d <= bd) {
        bd = d;
        best = { r, i };
      }
    }
  return best;
}

/** Signature (cache de l'éclairage). */
export function rampartSig(map: DungeonMap): string {
  return map.ramparts.map((r) => `${r.x},${r.y},${r.pts.join(',')},${r.closed},${r.width},${r.style},${r.towers}`).join(';');
}
