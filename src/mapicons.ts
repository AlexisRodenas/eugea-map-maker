// Pictogrammes pour les cartes du monde et les plans de région : montagnes, collines, bosquets,
// villes, bourgs, hameaux, châteaux, rose des vents. Style gravure, lumière en haut à gauche.
import { DrawEnv, PropDef, circle, fs, line, poly, st } from './draw';
import { darken, lighten, mix, rgba } from './util';

function mountain(e: DrawEnv, snow: boolean): void {
  const { c, w, h, pal, rng } = e;
  const peaks = rng.int(1, 3);
  const rock = mix(pal.stone, '#8a7a66', 0.4);
  for (let k = 0; k < peaks; k++) {
    const s = k === 0 ? 1 : rng.float(0.55, 0.8);
    const cx = (k === 0 ? 0 : (k === 1 ? -1 : 1) * w * 0.25) + rng.float(-0.05, 0.05) * w;
    const base = h / 2 - 0.02;
    const top = base - h * 0.9 * s;
    const half = w * 0.42 * s;
    // versant éclairé (gauche) et versant à l'ombre (droite)
    poly(e.c, [cx - half, base, cx + rng.float(-0.05, 0.05) * w, top, cx, base]);
    fs(e, lighten(rock, 0.18), pal.ink, 0);
    poly(e.c, [cx, base, cx + rng.float(-0.05, 0.05) * w, top, cx + half, base]);
    fs(e, darken(rock, 0.2), pal.ink, 0);
    // crête et hachures
    c.beginPath();
    c.moveTo(cx - half, base);
    c.lineTo(cx, top);
    c.lineTo(cx + half, base);
    st(e, pal.ink, e.lw * 1.2);
    c.beginPath();
    for (let i = 1; i < 5; i++) {
      const t = i / 5;
      line(c, cx + half * t * 0.9, top + (base - top) * t, cx + half * t * 0.9 - half * 0.2, base);
    }
    st(e, rgba(pal.ink, 0.35), e.lw * 0.5);
    if (snow) {
      poly(c, [cx - half * 0.3, top + (base - top) * 0.3, cx, top, cx + half * 0.3, top + (base - top) * 0.3, cx + half * 0.12, top + (base - top) * 0.22, cx - half * 0.05, top + (base - top) * 0.34]);
      fs(e, '#f4f6f8', pal.ink, e.lw * 0.4);
    }
  }
}

function house(e: DrawEnv, x: number, y: number, s: number, roof: string): void {
  const { c, pal } = e;
  c.beginPath();
  c.rect(x - s / 2, y - s * 0.1, s, s * 0.55);
  fs(e, mix(pal.paper, '#e8dcc0', 0.5), pal.ink, e.lw * 0.6);
  poly(c, [x - s * 0.62, y - s * 0.08, x, y - s * 0.6, x + s * 0.62, y - s * 0.08]);
  fs(e, roof, pal.ink, e.lw * 0.6);
}

export const MAP_ICONS: PropDef[] = [
  {
    kind: 'mountain',
    name: 'Montagne',
    cat: 'Cartes',
    w: 3,
    h: 2.4,
    rand: true,
    shadow: false,
    draw: (e) => mountain(e, e.rng.chance(0.5)),
  },
  {
    kind: 'hills',
    name: 'Collines',
    cat: 'Cartes',
    w: 2.4,
    h: 1.2,
    rand: true,
    shadow: false,
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      const n = rng.int(2, 3);
      for (let k = 0; k < n; k++) {
        const cx = (k - (n - 1) / 2) * w * 0.32 + rng.float(-0.05, 0.05) * w;
        const r = w * rng.float(0.2, 0.28);
        c.beginPath();
        c.moveTo(cx - r, h / 2);
        c.quadraticCurveTo(cx - r * 0.2, h / 2 - h * rng.float(0.8, 1.05), cx + r, h / 2);
        c.closePath();
        fs(e, mix(pal.plant, '#9aa86a', 0.5), pal.ink, e.lw);
        c.beginPath();
        for (let i = 1; i < 4; i++) line(c, cx + r * (0.1 + i * 0.2), h / 2 - h * 0.35 * (1 - i * 0.2), cx + r * (0.1 + i * 0.2) - r * 0.15, h / 2);
        st(e, rgba(pal.ink, 0.35), e.lw * 0.5);
      }
    },
  },
  {
    kind: 'grove',
    name: 'Bosquet',
    cat: 'Cartes',
    w: 2,
    h: 2,
    rand: true,
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      const n = rng.int(3, 6);
      const pts: [number, number, number][] = [];
      for (let k = 0; k < n; k++) pts.push([rng.float(-0.32, 0.32) * w, rng.float(-0.32, 0.32) * h, rng.float(0.16, 0.24) * Math.min(w, h)]);
      pts.sort((a, b) => a[1] - b[1]);
      for (const [x, y, r] of pts) {
        // tronc
        c.beginPath();
        line(c, x, y + r * 0.6, x, y + r * 1.3);
        st(e, pal.woodDark, e.lw * 1.4);
        // houppier
        circle(c, x, y, r);
        const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r);
        g.addColorStop(0, lighten(pal.plant, 0.25));
        g.addColorStop(1, darken(pal.plant, 0.25));
        fs(e, g, pal.ink, e.lw * 0.9);
      }
    },
  },
  {
    kind: 'pineGrove',
    name: 'Bosquet de sapins',
    cat: 'Cartes',
    w: 2,
    h: 2,
    rand: true,
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      const n = rng.int(3, 6);
      const pts: [number, number, number][] = [];
      for (let k = 0; k < n; k++) pts.push([rng.float(-0.32, 0.32) * w, rng.float(-0.28, 0.32) * h, rng.float(0.18, 0.26) * Math.min(w, h)]);
      pts.sort((a, b) => a[1] - b[1]);
      const col = mix(pal.plant, '#2f5d3a', 0.5);
      for (const [x, y, r] of pts) {
        poly(c, [x - r * 0.7, y + r, x, y - r * 1.2, x + r * 0.7, y + r]);
        const g = c.createLinearGradient(x - r, 0, x + r, 0);
        g.addColorStop(0, lighten(col, 0.15));
        g.addColorStop(1, darken(col, 0.25));
        fs(e, g, pal.ink, e.lw * 0.9);
        c.beginPath();
        line(c, x, y + r, x, y + r * 1.35);
        st(e, pal.woodDark, e.lw * 1.2);
      }
    },
  },
  {
    kind: 'cityIcon',
    name: 'Ville',
    cat: 'Cartes',
    w: 2,
    h: 1.6,
    rand: true,
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      // enceinte et maisons serrées
      c.beginPath();
      c.ellipse(0, h * 0.12, w * 0.46, h * 0.34, 0, 0, Math.PI * 2);
      fs(e, mix(pal.paper, '#d9c9a3', 0.5), pal.ink, e.lw * 1.4);
      for (let k = 0; k < 6; k++) house(e, rng.float(-0.3, 0.3) * w, rng.float(-0.05, 0.25) * h, w * 0.16, rng.pick(['#b24a30', '#8a5a3a', '#5a6470']));
      // tour principale
      c.beginPath();
      c.rect(-w * 0.07, -h * 0.42, w * 0.14, h * 0.4);
      fs(e, pal.stone, pal.ink, e.lw);
      poly(c, [-w * 0.1, -h * 0.42, 0, -h * 0.58, w * 0.1, -h * 0.42]);
      fs(e, '#5a6470', pal.ink, e.lw * 0.7);
    },
  },
  {
    kind: 'townIcon',
    name: 'Bourg',
    cat: 'Cartes',
    w: 1.4,
    h: 1.1,
    rand: true,
    draw: (e) => {
      const { w, h, rng } = e;
      for (let k = 0; k < 3; k++) house(e, (k - 1) * w * 0.28 + rng.float(-0.03, 0.03) * w, (k === 1 ? -0.05 : 0.12) * h, w * 0.3, rng.pick(['#b24a30', '#8a5a3a', '#a8743f']));
    },
  },
  {
    kind: 'hamletIcon',
    name: 'Hameau',
    cat: 'Cartes',
    w: 0.9,
    h: 0.8,
    rand: true,
    draw: (e) => {
      const { w, h, rng } = e;
      house(e, -w * 0.15, h * 0.08, w * 0.42, rng.pick(['#a8743f', '#8a5a3a']));
      house(e, w * 0.22, h * 0.18, w * 0.32, rng.pick(['#a8743f', '#b24a30']));
    },
  },
  {
    kind: 'castleIcon',
    name: 'Château',
    cat: 'Cartes',
    w: 1.6,
    h: 1.6,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const s = Math.min(w, h);
      const stone = mix(pal.stone, '#9a948a', 0.3);
      c.beginPath();
      c.rect(-s * 0.36, -s * 0.1, s * 0.72, s * 0.45);
      fs(e, stone, pal.ink, e.lw * 1.1);
      for (const x of [-0.36, 0.24]) {
        c.beginPath();
        c.rect(x * s, -s * 0.38, s * 0.12, s * 0.73);
        fs(e, lighten(stone, 0.08), pal.ink, e.lw);
        poly(c, [x * s - s * 0.02, -s * 0.38, x * s + s * 0.06, -s * 0.5, x * s + s * 0.14, -s * 0.38]);
        fs(e, '#5a6470', pal.ink, e.lw * 0.7);
      }
      c.beginPath();
      c.rect(-s * 0.06, -s * 0.3, s * 0.12, s * 0.25);
      fs(e, lighten(stone, 0.12), pal.ink, e.lw);
      c.beginPath();
      c.rect(-s * 0.05, s * 0.15, s * 0.1, s * 0.2);
      fs(e, darken(stone, 0.5), pal.ink, e.lw * 0.6);
      c.beginPath();
      line(c, 0, -s * 0.3, 0, -s * 0.5);
      st(e, pal.ink, e.lw);
      poly(c, [0, -s * 0.5, s * 0.14, -s * 0.46, 0, -s * 0.42]);
      fs(e, pal.cloth, pal.ink, e.lw * 0.5);
    },
  },
  {
    kind: 'compass',
    name: 'Rose des vents',
    cat: 'Cartes',
    w: 3,
    h: 3,
    shadow: false,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const R = Math.min(w, h) / 2 - 0.05;
      circle(c, 0, 0, R * 0.62);
      st(e, pal.ink, e.lw);
      circle(c, 0, 0, R * 0.55);
      st(e, rgba(pal.ink, 0.5), e.lw * 0.5);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
        const L = k % 2 ? R * 0.55 : R;
        const wd = k % 2 ? R * 0.08 : R * 0.13;
        const tip = [Math.cos(a) * L, Math.sin(a) * L];
        const l = [Math.cos(a - Math.PI / 2) * wd, Math.sin(a - Math.PI / 2) * wd];
        const r = [Math.cos(a + Math.PI / 2) * wd, Math.sin(a + Math.PI / 2) * wd];
        poly(c, [0, 0, l[0], l[1], tip[0], tip[1]]);
        fs(e, k === 0 ? pal.cloth : pal.paper, pal.ink, e.lw * 0.7);
        poly(c, [0, 0, r[0], r[1], tip[0], tip[1]]);
        fs(e, k === 0 ? darken(pal.cloth, 0.3) : pal.ink, pal.ink, e.lw * 0.7);
      }
      c.font = `700 ${R * 0.28}px Georgia, serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = pal.ink;
      c.fillText('N', 0, -R - R * 0.02 + R * 0.12 - R * 0.28);
    },
  },
];
