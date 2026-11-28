// Mobilier et équipements des bâtiments (tavernes, maisons, forges, échoppes, chapelles, granges).
// Convention : le « devant » d'un meuble est vers +y (un meuble adossé à un mur a son dos en -y).
import { DrawEnv, PropDef, circle, flame, fs, line, poly, rrect, st } from './draw';
import { darken, lighten, mix, rgba } from './util';

/** Bois avec un léger dégradé (lumière en haut à gauche). */
function woodFill(e: DrawEnv, x: number, y: number, w: number, h: number, base = e.pal.wood): CanvasGradient {
  const g = e.c.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, lighten(base, 0.12));
  g.addColorStop(1, darken(base, 0.12));
  return g;
}

/** Veinage de planches parallèles à x. */
function planks(e: DrawEnv, x: number, y: number, w: number, h: number, step = 0.18): void {
  const { c, pal } = e;
  c.beginPath();
  for (let v = y + step; v < y + h - 0.02; v += step) line(c, x + 0.03, v, x + w - 0.03, v);
  st(e, rgba(pal.woodDark, 0.45), e.lw * 0.5);
}

/** Petits objets posés (chopes, bouteilles, assiettes) dans un rectangle. */
function clutter(e: DrawEnv, x: number, y: number, w: number, h: number, n: number): void {
  const { c, pal, rng } = e;
  for (let k = 0; k < n; k++) {
    const px = rng.float(x + 0.08, x + w - 0.08),
      py = rng.float(y + 0.06, y + h - 0.06);
    const t = rng.int(0, 3);
    if (t === 0) {
      // chope
      circle(c, px, py, 0.055);
      fs(e, lighten(pal.wood, 0.2), pal.ink, e.lw * 0.5);
      circle(c, px, py, 0.03);
      c.fillStyle = rgba('#d9a441', 0.9);
      c.fill();
    } else if (t === 1) {
      // bouteille
      circle(c, px, py, 0.045);
      fs(e, rng.pick(['#3f6b3a', '#6b3a2a', '#2f4f6b']), pal.ink, e.lw * 0.5);
    } else if (t === 2) {
      // assiette
      circle(c, px, py, 0.08);
      fs(e, lighten(pal.paper, 0.1), pal.ink, e.lw * 0.5);
      circle(c, px, py, 0.035);
      c.fillStyle = rng.pick([pal.cloth, pal.plant, pal.gold]);
      c.fill();
    } else {
      // bougie
      circle(c, px, py, 0.03);
      fs(e, '#f3ead2', pal.ink, e.lw * 0.4);
      flame(e, px, py, 0.08);
    }
  }
}

export const FURNITURE: PropDef[] = [
  {
    kind: 'counter',
    name: 'Comptoir',
    cat: 'Mobilier',
    w: 4,
    h: 0.8,
    rand: true,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const x = -w / 2 + 0.04,
        y = -h / 2 + 0.06,
        bw = w - 0.08,
        bh = h - 0.12;
      rrect(c, x, y, bw, bh, 0.08);
      fs(e, woodFill(e, x, y, bw, bh, pal.woodDark), pal.ink, e.lw * 1.2);
      // plateau
      rrect(c, x + 0.06, y + 0.06, bw - 0.12, bh * 0.62, 0.05);
      fs(e, woodFill(e, x, y, bw, bh), pal.ink, e.lw * 0.6);
      planks(e, x + 0.06, y + 0.06, bw - 0.12, bh * 0.62, 0.16);
      clutter(e, x + 0.1, y + 0.08, bw - 0.2, bh * 0.55, Math.round(w * 1.5));
    },
  },
  {
    kind: 'stool',
    name: 'Tabouret',
    cat: 'Mobilier',
    w: 0.5,
    h: 0.5,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const r = Math.min(w, h) * 0.36;
      circle(c, 0, 0, r);
      const g = c.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
      g.addColorStop(0, lighten(pal.wood, 0.2));
      g.addColorStop(1, darken(pal.wood, 0.1));
      fs(e, g, pal.ink, e.lw * 0.8);
      circle(c, 0, 0, r * 0.6);
      st(e, rgba(pal.woodDark, 0.6), e.lw * 0.4);
    },
  },
  {
    kind: 'fireplace',
    name: 'Cheminée',
    cat: 'Mobilier',
    w: 2,
    h: 1,
    light: { radius: 6, color: '#ff9a4d', anim: 'torch', intensity: 0.85 },
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      const stone = mix(pal.stone, '#8a837a', 0.3);
      // manteau de pierre en U, ouvert vers +y
      c.beginPath();
      c.rect(-w / 2 + 0.05, -h / 2 + 0.05, w - 0.1, h - 0.1);
      fs(e, darken(stone, 0.08), pal.ink, e.lw * 1.3);
      // pierres
      c.beginPath();
      for (let k = 0; k < 10; k++) {
        const x = rng.float(-w / 2 + 0.1, w / 2 - 0.3),
          y = rng.float(-h / 2 + 0.1, h / 2 - 0.25);
        c.rect(x, y, rng.float(0.18, 0.3), rng.float(0.12, 0.18));
      }
      st(e, rgba(pal.ink, 0.25), e.lw * 0.5);
      // âtre
      c.beginPath();
      c.rect(-w / 2 + 0.35, -h / 2 + 0.28, w - 0.7, h - 0.33);
      fs(e, '#2a1d16', pal.ink, e.lw * 0.8);
      // bûches et braises
      c.beginPath();
      line(c, -0.3, 0.12, 0.25, -0.02);
      line(c, -0.25, -0.02, 0.3, 0.12);
      st(e, pal.woodDark, 0.09);
      flame(e, 0, 0.05, 0.42);
      flame(e, -0.1, 0.02, 0.22);
    },
  },
  {
    kind: 'oven',
    name: 'Four à pain',
    cat: 'Mobilier',
    w: 1.5,
    h: 1.5,
    light: { radius: 3, color: '#ff8a3d', anim: 'flame', intensity: 0.6 },
    draw: (e) => {
      const { c, w, h, pal } = e;
      const R = Math.min(w, h) * 0.45;
      const stone = mix(pal.stone, '#b0806a', 0.35);
      circle(c, 0, -0.05, R);
      const g = c.createRadialGradient(-R * 0.3, -R * 0.4, 0, 0, 0, R);
      g.addColorStop(0, lighten(stone, 0.2));
      g.addColorStop(1, darken(stone, 0.2));
      fs(e, g, pal.ink, e.lw * 1.3);
      c.beginPath();
      for (let k = 0; k < 3; k++) c.arc(0, -0.05, R * (0.35 + k * 0.2), 0, Math.PI * 2);
      st(e, rgba(pal.ink, 0.2), e.lw * 0.5);
      // gueule du four (devant)
      rrect(c, -R * 0.4, R * 0.45, R * 0.8, R * 0.5, 0.05);
      fs(e, '#2a1d16', pal.ink, e.lw * 0.8);
      flame(e, 0, R * 0.7, R * 0.4);
    },
  },
  {
    kind: 'worktable',
    name: 'Plan de travail',
    cat: 'Mobilier',
    w: 2,
    h: 0.9,
    rand: true,
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      const x = -w / 2 + 0.05,
        y = -h / 2 + 0.06,
        bw = w - 0.1,
        bh = h - 0.12;
      rrect(c, x, y, bw, bh, 0.04);
      fs(e, woodFill(e, x, y, bw, bh, mix(pal.wood, '#d8b98a', 0.3)), pal.ink, e.lw);
      planks(e, x, y, bw, bh, 0.2);
      // planche à découper, couteau, légumes
      rrect(c, x + 0.15, y + 0.15, 0.5, 0.35, 0.04);
      fs(e, lighten(pal.wood, 0.25), pal.ink, e.lw * 0.6);
      c.beginPath();
      line(c, x + 0.25, y + 0.32, x + 0.55, y + 0.3);
      st(e, pal.metal, e.lw * 1.2);
      for (let k = 0; k < 5; k++) {
        circle(c, rng.float(x + 0.8, x + bw - 0.15), rng.float(y + 0.12, y + bh - 0.12), rng.float(0.05, 0.08));
        fs(e, rng.pick(['#c0392b', '#e67e22', '#7cae3a', '#d9c36a']), pal.ink, e.lw * 0.4);
      }
    },
  },
  {
    kind: 'cauldron',
    name: 'Chaudron',
    cat: 'Mobilier',
    w: 1,
    h: 1,
    light: { radius: 2.5, color: '#ff8a3d', anim: 'flame', intensity: 0.5 },
    draw: (e) => {
      const { c, pal } = e;
      flame(e, 0, 0, 0.48);
      circle(c, 0, 0, 0.34);
      fs(e, '#262626', pal.ink, e.lw * 1.2);
      circle(c, 0, 0, 0.26);
      const g = c.createRadialGradient(-0.08, -0.08, 0, 0, 0, 0.26);
      g.addColorStop(0, '#8fbf5a');
      g.addColorStop(1, '#3f6b2a');
      fs(e, g, pal.ink, e.lw * 0.5);
      c.beginPath();
      c.arc(0, 0, 0.36, Math.PI * 1.1, Math.PI * 1.9);
      st(e, pal.metal, e.lw * 1.4);
    },
  },
  {
    kind: 'wardrobe',
    name: 'Armoire',
    cat: 'Mobilier',
    w: 1.5,
    h: 0.7,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const x = -w / 2 + 0.05,
        y = -h / 2 + 0.05,
        bw = w - 0.1,
        bh = h - 0.1;
      c.beginPath();
      c.rect(x, y, bw, bh);
      fs(e, woodFill(e, x, y, bw, bh, pal.woodDark), pal.ink, e.lw * 1.2);
      c.beginPath();
      c.rect(x + 0.06, y + 0.06, bw - 0.12, bh - 0.12);
      st(e, rgba(lighten(pal.woodDark, 0.3), 0.8), e.lw * 0.6);
      c.beginPath();
      line(c, 0, y + 0.06, 0, y + bh - 0.06);
      st(e, pal.ink, e.lw * 0.7);
      for (const s of [-1, 1]) {
        circle(c, s * 0.08, y + bh - 0.14, 0.03);
        fs(e, pal.gold, pal.ink, e.lw * 0.3);
      }
    },
  },
  {
    kind: 'shelf',
    name: 'Étagère',
    cat: 'Mobilier',
    w: 2,
    h: 0.5,
    rand: true,
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      const x = -w / 2 + 0.04,
        y = -h / 2 + 0.04,
        bw = w - 0.08,
        bh = h - 0.08;
      c.beginPath();
      c.rect(x, y, bw, bh);
      fs(e, woodFill(e, x, y, bw, bh), pal.ink, e.lw);
      // pots, bocaux, sacs, livres
      for (let u = x + 0.06; u < x + bw - 0.1; ) {
        const t = rng.int(0, 2);
        const s = rng.float(0.1, 0.18);
        if (t === 0) {
          circle(c, u + s / 2, 0, s / 2);
          fs(e, rng.pick(['#b8774a', '#8aa3b8', '#6b8f4a', '#c9b37a', '#9c5b8a']), pal.ink, e.lw * 0.4);
        } else if (t === 1) {
          c.beginPath();
          c.rect(u, y + 0.07, s * 0.6, bh - 0.14);
          fs(e, rng.pick([pal.cloth, '#2f4f6b', '#6b3a2a', pal.gold]), pal.ink, e.lw * 0.4);
        } else {
          rrect(c, u, y + 0.08, s, bh - 0.16, 0.03);
          fs(e, mix(pal.paper, '#c2a878', 0.4), pal.ink, e.lw * 0.4);
        }
        u += s + rng.float(0.02, 0.08);
      }
    },
  },
  {
    kind: 'lectern',
    name: 'Lutrin',
    cat: 'Sacré',
    w: 0.8,
    h: 0.8,
    draw: (e) => {
      const { c, pal } = e;
      poly(c, [-0.28, -0.2, 0.28, -0.2, 0.22, 0.25, -0.22, 0.25]);
      fs(e, woodFill(e, -0.3, -0.2, 0.6, 0.45, pal.woodDark), pal.ink, e.lw);
      // livre ouvert
      c.beginPath();
      c.rect(-0.22, -0.12, 0.21, 0.28);
      c.rect(0.01, -0.12, 0.21, 0.28);
      fs(e, pal.paper, pal.ink, e.lw * 0.6);
      c.beginPath();
      for (let k = 0; k < 4; k++) {
        line(c, -0.18, -0.06 + k * 0.05, -0.05, -0.06 + k * 0.05);
        line(c, 0.05, -0.06 + k * 0.05, 0.18, -0.06 + k * 0.05);
      }
      st(e, rgba(pal.ink, 0.4), e.lw * 0.4);
    },
  },
  {
    kind: 'workbench',
    name: 'Établi',
    cat: 'Mobilier',
    w: 2,
    h: 0.9,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const x = -w / 2 + 0.05,
        y = -h / 2 + 0.06,
        bw = w - 0.1,
        bh = h - 0.12;
      c.beginPath();
      c.rect(x, y, bw, bh);
      fs(e, woodFill(e, x, y, bw, bh, mix(pal.wood, '#9a6b3f', 0.3)), pal.ink, e.lw * 1.1);
      planks(e, x, y, bw, bh, 0.25);
      // étau
      c.beginPath();
      c.rect(x + bw - 0.35, y - 0.02, 0.25, 0.18);
      fs(e, pal.metal, pal.ink, e.lw * 0.7);
      // marteau, scie, tenailles
      c.beginPath();
      line(c, x + 0.15, y + 0.25, x + 0.55, y + 0.3);
      st(e, pal.woodDark, e.lw * 1.8);
      c.beginPath();
      c.rect(x + 0.5, y + 0.2, 0.1, 0.18);
      fs(e, pal.metal, pal.ink, e.lw * 0.5);
      poly(c, [x + 0.75, y + bh - 0.12, x + 1.25, y + bh - 0.2, x + 1.25, y + bh - 0.08]);
      fs(e, lighten(pal.metal, 0.2), pal.ink, e.lw * 0.5);
    },
  },
  {
    kind: 'forge',
    name: 'Foyer de forge',
    cat: 'Mobilier',
    w: 1.5,
    h: 1.5,
    light: { radius: 5, color: '#ff7a2e', anim: 'torch', intensity: 0.85 },
    draw: (e) => {
      const { c, w, h, pal } = e;
      const s = Math.min(w, h) / 2 - 0.05;
      const stone = mix(pal.stone, '#7a6f66', 0.3);
      rrect(c, -s, -s, s * 2, s * 2, 0.08);
      fs(e, woodFill(e, -s, -s, s * 2, s * 2, stone), pal.ink, e.lw * 1.3);
      rrect(c, -s * 0.6, -s * 0.6, s * 1.2, s * 1.2, 0.05);
      fs(e, '#2a1a12', pal.ink, e.lw * 0.8);
      // braises
      for (let k = 0; k < 9; k++) {
        circle(c, e.rng.float(-s * 0.45, s * 0.45), e.rng.float(-s * 0.45, s * 0.45), 0.05);
        c.fillStyle = e.rng.pick(['#ff7a2e', '#ffb347', '#d9481f']);
        c.fill();
      }
      flame(e, 0, 0, s * 0.8);
      // soufflet
      poly(c, [s * 0.65, s * 0.4, s + 0.02, s * 0.15, s + 0.02, s * 0.65]);
      fs(e, pal.woodDark, pal.ink, e.lw * 0.6);
    },
  },
  {
    kind: 'weaponRack',
    name: 'Râtelier d’armes',
    cat: 'Mobilier',
    w: 1.6,
    h: 0.5,
    draw: (e) => {
      const { c, w, h, pal } = e;
      c.beginPath();
      c.rect(-w / 2 + 0.05, -h / 2 + 0.08, w - 0.1, 0.12);
      fs(e, pal.woodDark, pal.ink, e.lw);
      for (let k = 0; k < 5; k++) {
        const x = -w / 2 + 0.25 + k * ((w - 0.5) / 4);
        c.beginPath();
        line(c, x, -h / 2 + 0.05, x + (k % 2 ? 0.05 : -0.05), h / 2 - 0.05);
        st(e, k % 2 ? pal.woodDark : pal.metal, e.lw * (k % 2 ? 1.4 : 1.1));
        if (!(k % 2)) {
          c.beginPath();
          line(c, x - 0.07, -h / 2 + 0.25, x + 0.07, -h / 2 + 0.25);
          st(e, pal.gold, e.lw * 1.1);
        }
      }
    },
  },
  {
    kind: 'sacks',
    name: 'Sacs',
    cat: 'Mobilier',
    w: 1,
    h: 1,
    rand: true,
    draw: (e) => {
      const { c, pal, rng } = e;
      const n = rng.int(2, 4);
      for (let k = 0; k < n; k++) {
        const x = rng.float(-0.22, 0.22),
          y = rng.float(-0.22, 0.22),
          a = rng.float(0, Math.PI);
        c.save();
        c.translate(x, y);
        c.rotate(a);
        c.beginPath();
        c.ellipse(0, 0, 0.2, 0.15, 0, 0, Math.PI * 2);
        const col = mix(pal.paper, '#b89a6a', 0.55);
        fs(e, woodFill(e, -0.2, -0.15, 0.4, 0.3, col), pal.ink, e.lw * 0.8);
        c.beginPath();
        line(c, 0.12, -0.06, 0.12, 0.06);
        st(e, rgba(pal.ink, 0.5), e.lw * 0.8);
        c.restore();
      }
    },
  },
  {
    kind: 'woodpile',
    name: 'Tas de bûches',
    cat: 'Extérieur',
    w: 1.5,
    h: 0.8,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const r = Math.min(0.13, h / 6);
      for (let row = 0; row < 3; row++)
        for (let x = -w / 2 + r + 0.05 + (row % 2) * r; x < w / 2 - r; x += r * 2.05) {
          const y = -h / 2 + r + 0.05 + row * r * 1.9;
          if (y > h / 2 - r) continue;
          circle(c, x, y, r);
          fs(e, mix(pal.wood, '#d8b98a', 0.4), pal.ink, e.lw * 0.6);
          circle(c, x, y, r * 0.45);
          st(e, rgba(pal.woodDark, 0.6), e.lw * 0.4);
        }
    },
  },
  {
    kind: 'candelabra',
    name: 'Chandelier',
    cat: 'Lumière',
    w: 0.6,
    h: 0.6,
    layer: 2,
    light: { radius: 3, color: '#ffd28a', anim: 'flame', intensity: 0.6 },
    draw: (e) => {
      const { c, pal } = e;
      circle(c, 0, 0, 0.16);
      fs(e, pal.gold, pal.ink, e.lw * 0.7);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
        circle(c, Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.04);
        fs(e, '#f3ead2', pal.ink, e.lw * 0.4);
        flame(e, Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.1);
      }
    },
  },
  {
    kind: 'garden',
    name: 'Potager',
    cat: 'Extérieur',
    w: 3,
    h: 2,
    layer: 0,
    area: true,
    rand: true,
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      c.beginPath();
      c.rect(-w / 2 + 0.05, -h / 2 + 0.05, w - 0.1, h - 0.1);
      fs(e, mix(pal.woodDark, '#5a4030', 0.5), pal.ink, e.lw * 0.6);
      const rows = Math.max(2, Math.floor((h - 0.2) / 0.45));
      for (let k = 0; k < rows; k++) {
        const y = -h / 2 + 0.25 + k * ((h - 0.4) / Math.max(1, rows - 1));
        c.beginPath();
        line(c, -w / 2 + 0.15, y, w / 2 - 0.15, y);
        st(e, rgba('#3a2a1c', 0.6), 0.12);
        const col = rng.pick([pal.plant, lighten(pal.plant, 0.15), '#7cae3a', '#c9a23a']);
        for (let x = -w / 2 + 0.25; x < w / 2 - 0.15; x += rng.float(0.22, 0.32)) {
          circle(c, x, y + rng.float(-0.03, 0.03), rng.float(0.07, 0.1));
          fs(e, col, darken(col, 0.45), e.lw * 0.4);
        }
      }
    },
  },
  {
    kind: 'trough',
    name: 'Abreuvoir',
    cat: 'Extérieur',
    w: 2,
    h: 0.6,
    draw: (e) => {
      const { c, w, h, pal } = e;
      rrect(c, -w / 2 + 0.05, -h / 2 + 0.05, w - 0.1, h - 0.1, 0.05);
      fs(e, pal.woodDark, pal.ink, e.lw);
      rrect(c, -w / 2 + 0.13, -h / 2 + 0.13, w - 0.26, h - 0.26, 0.03);
      fs(e, pal.water, pal.ink, e.lw * 0.5);
      c.beginPath();
      line(c, -w / 2 + 0.3, -0.02, w / 2 - 0.5, -0.02);
      st(e, 'rgba(255,255,255,0.4)', e.lw * 0.6);
    },
  },
  {
    kind: 'pew',
    name: 'Banc d’église',
    cat: 'Sacré',
    w: 3,
    h: 0.8,
    draw: (e) => {
      const { c, w, h, pal } = e;
      // dossier (derrière, -y) et assise
      c.beginPath();
      c.rect(-w / 2 + 0.05, -h / 2 + 0.08, w - 0.1, 0.14);
      fs(e, pal.woodDark, pal.ink, e.lw);
      c.beginPath();
      c.rect(-w / 2 + 0.05, -h / 2 + 0.24, w - 0.1, h - 0.4);
      fs(e, woodFill(e, -w / 2, 0, w, h, pal.wood), pal.ink, e.lw);
      planks(e, -w / 2 + 0.05, -h / 2 + 0.24, w - 0.1, h - 0.4, 0.13);
      for (const s of [-1, 1]) {
        c.beginPath();
        c.rect(s < 0 ? -w / 2 + 0.02 : w / 2 - 0.12, -h / 2 + 0.05, 0.1, h - 0.18);
        fs(e, pal.woodDark, pal.ink, e.lw * 0.8);
      }
    },
  },
  {
    kind: 'desk',
    name: 'Bureau',
    cat: 'Mobilier',
    w: 1.6,
    h: 0.9,
    rand: true,
    draw: (e) => {
      const { c, w, h, pal, rng } = e;
      const x = -w / 2 + 0.05,
        y = -h / 2 + 0.06,
        bw = w - 0.1,
        bh = h - 0.12;
      rrect(c, x, y, bw, bh, 0.04);
      fs(e, woodFill(e, x, y, bw, bh, pal.woodDark), pal.ink, e.lw * 1.1);
      for (let k = 0; k < 3; k++) {
        c.save();
        c.translate(rng.float(x + 0.3, x + bw - 0.4), rng.float(y + 0.2, y + bh - 0.25));
        c.rotate(rng.float(-0.4, 0.4));
        c.beginPath();
        c.rect(-0.12, -0.16, 0.24, 0.32);
        fs(e, pal.paper, pal.ink, e.lw * 0.4);
        c.restore();
      }
      circle(c, x + bw - 0.15, y + 0.15, 0.05);
      fs(e, '#1b1b2a', pal.ink, e.lw * 0.4);
      circle(c, x + 0.15, y + 0.15, 0.035);
      fs(e, '#f3ead2', pal.ink, e.lw * 0.4);
      flame(e, x + 0.15, y + 0.15, 0.09);
    },
  },
  {
    kind: 'cask',
    name: 'Tonneau couché',
    cat: 'Mobilier',
    w: 1.4,
    h: 0.9,
    draw: (e) => {
      const { c, w, h, pal } = e;
      // chevalet
      c.beginPath();
      line(c, -w / 2 + 0.2, -h / 2 + 0.05, -w / 2 + 0.2, h / 2 - 0.05);
      line(c, w / 2 - 0.2, -h / 2 + 0.05, w / 2 - 0.2, h / 2 - 0.05);
      st(e, pal.woodDark, 0.1);
      // fût vu de côté
      rrect(c, -w / 2 + 0.08, -h / 2 + 0.12, w - 0.16, h - 0.24, (h - 0.24) / 2.5);
      fs(e, woodFill(e, -w / 2, -h / 2, w, h, pal.wood), pal.ink, e.lw);
      c.beginPath();
      for (const u of [-w / 2 + 0.3, 0, w / 2 - 0.3]) line(c, u, -h / 2 + 0.12, u, h / 2 - 0.12);
      st(e, pal.metal, e.lw * 1.2);
      c.beginPath();
      c.ellipse(w / 2 - 0.1, 0, 0.06, (h - 0.3) / 2, 0, 0, Math.PI * 2);
      fs(e, lighten(pal.wood, 0.15), pal.ink, e.lw * 0.6);
      circle(c, w / 2 - 0.1, 0.05, 0.035);
      fs(e, pal.metal, pal.ink, e.lw * 0.4);
    },
  },
  {
    kind: 'bedDouble',
    name: 'Lit double',
    cat: 'Mobilier',
    w: 2,
    h: 2,
    draw: (e) => {
      const { c, w, h, pal } = e;
      const x = -w / 2 + 0.08,
        y = -h / 2 + 0.05,
        bw = w - 0.16,
        bh = h - 0.1;
      rrect(c, x, y, bw, bh, 0.06);
      fs(e, pal.woodDark, pal.ink, e.lw * 1.2);
      rrect(c, x + 0.08, y + 0.1, bw - 0.16, bh - 0.16, 0.05);
      fs(e, pal.paper, pal.ink, e.lw * 0.6);
      // oreillers
      for (const s of [-1, 1]) {
        rrect(c, s * 0.42 - 0.3, y + 0.16, 0.6, 0.32, 0.08);
        fs(e, lighten(pal.paper, 0.15), pal.ink, e.lw * 0.5);
      }
      // couverture
      rrect(c, x + 0.08, y + 0.6, bw - 0.16, bh - 0.66, 0.05);
      const g = c.createLinearGradient(0, y + 0.6, 0, y + bh);
      g.addColorStop(0, lighten(pal.cloth, 0.1));
      g.addColorStop(1, darken(pal.cloth, 0.15));
      fs(e, g, pal.ink, e.lw * 0.6);
      c.beginPath();
      line(c, x + 0.1, y + 0.75, x + bw - 0.1, y + 0.75);
      st(e, rgba(lighten(pal.cloth, 0.4), 0.7), e.lw * 0.8);
    },
  },
  {
    kind: 'plantPot',
    name: 'Plante en pot',
    cat: 'Nature',
    w: 0.6,
    h: 0.6,
    rand: true,
    draw: (e) => {
      const { c, pal, rng } = e;
      circle(c, 0, 0, 0.2);
      fs(e, mix(pal.wood, '#b0603a', 0.5), pal.ink, e.lw * 0.7);
      for (let k = 0; k < 7; k++) {
        const a = rng.float(0, Math.PI * 2);
        c.beginPath();
        c.ellipse(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.12, 0.05, a, 0, Math.PI * 2);
        fs(e, rng.chance(0.5) ? pal.plant : lighten(pal.plant, 0.15), darken(pal.plant, 0.5), e.lw * 0.4);
      }
    },
  },
];
