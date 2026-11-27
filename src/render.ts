import { DungeonMap, EDGE, Prop, T } from './model';
import { GeoCache, Geometry, Portal, TerrainGeo } from './geometry';
import { LightingCache, allLights } from './lighting';
import { PROP_BY_KIND, drawProp, propBounds } from './props';
import type { ResolvedTheme } from './themes';
import { hash2, luminance, mix, rgba } from './util';

export interface View {
  scale: number; // pixels par case
  ox: number; // coordonnée monde du coin haut-gauche
  oy: number;
}

export type RenderMode = 'editor' | 'gm' | 'player';

export interface RenderOpts {
  view: View;
  width: number;
  height: number;
  mode: RenderMode;
  grid: boolean;
  lighting: boolean;
  labels?: boolean;
  selection?: ReadonlySet<string>;
  /** Filtre des objets dessinés dans l'image (les tuiles Foundry séparées en sont exclues). */
  bakeProp?: (p: Prop) => boolean;
}

// ---------- Texture de papier (tuile périodique) ----------

let paperTile: HTMLCanvasElement | null = null;

function tileNoise(u: number, v: number, P: number, seed: number): number {
  const xi = Math.floor(u),
    yi = Math.floor(v);
  const fx = u - xi,
    fy = v - yi;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % P) + P) % P,
    y0 = ((yi % P) + P) % P;
  const x1 = (x0 + 1) % P,
    y1 = (y0 + 1) % P;
  const a = hash2(x0, y0, seed),
    b = hash2(x1, y0, seed),
    c = hash2(x0, y1, seed),
    d = hash2(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function getPaperTile(): HTMLCanvasElement {
  if (paperTile) return paperTile;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S,
        v = y / S;
      const n = 0.4 * tileNoise(u * 4, v * 4, 4, 3) + 0.35 * tileNoise(u * 12, v * 12, 12, 5) + 0.25 * tileNoise(u * 40, v * 40, 40, 7);
      const g = hash2(x, y, 9);
      const a = Math.max(0, Math.min(1, (n - 0.5) * 0.55 + 0.06 + (g - 0.5) * 0.28));
      const i = (y * S + x) * 4;
      img.data[i] = 60;
      img.data[i + 1] = 38;
      img.data[i + 2] = 15;
      img.data[i + 3] = a * 255;
    }
  ctx.putImageData(img, 0, 0);
  paperTile = cv;
  return cv;
}

// ---------- Rendu ----------

export class Renderer {
  geo = new GeoCache();
  lights = new LightingCache();
  private patterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
  private groundPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
  private lightLayer: HTMLCanvasElement | null = null;

  geometry(map: DungeonMap, theme: ResolvedTheme): Geometry {
    return this.geo.get(map, theme);
  }

  private drawTerrains(ctx: CanvasRenderingContext2D, list: TerrainGeo[], theme: ResolvedTheme, px: number): void {
    for (const t of list) {
      ctx.fillStyle = theme.terrain[t.id];
      ctx.fill(t.fill);
      if (t.id === T.PIT) {
        ctx.save();
        ctx.clip(t.fill);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 0.6;
        ctx.stroke(t.fill);
        ctx.restore();
      }
      if (t.detail) {
        ctx.save();
        ctx.clip(t.fill);
        ctx.strokeStyle = theme.terrainDetail[t.id];
        ctx.lineWidth = Math.max(t.detailWidth, 0.7 * px);
        ctx.stroke(t.detail);
        ctx.restore();
      }
      if (t.id === T.WATER || t.id === T.DEEP || t.id === T.LAVA) {
        ctx.save();
        ctx.clip(t.fill);
        ctx.strokeStyle = t.id === T.LAVA ? 'rgba(255,235,150,0.55)' : 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 0.08;
        ctx.stroke(t.fill);
        ctx.restore();
      }
    }
  }

  /** Calque fantôme : murs et objets du niveau inférieur, en transparence (aide à l'alignement). */
  renderGhost(ctx: CanvasRenderingContext2D, map: DungeonMap, theme: ResolvedTheme, view: View): void {
    const geo = this.geo.get(map, theme);
    const { scale, ox, oy } = view;
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([0.25, 0.18]);
    ctx.strokeStyle = '#4cc2ff';
    ctx.lineWidth = Math.max(0.07, 1.5 / scale);
    ctx.stroke(geo.wallPath);
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.3;
    for (const p of map.props) drawProp(ctx, p, theme.pal);
    ctx.restore();
  }

  render(ctx: CanvasRenderingContext2D, map: DungeonMap, theme: ResolvedTheme, o: RenderOpts): void {
    const geo = this.geo.get(map, theme);
    const { scale, ox, oy } = o.view;
    const px = 1 / scale; // un pixel en unités monde
    const vx0 = ox,
      vy0 = oy,
      vx1 = ox + o.width / scale,
      vy1 = oy + o.height / scale;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, o.width, o.height);
    ctx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Terrain extérieur
    if (geo.ground.length) {
      this.drawTerrains(ctx, geo.ground, theme, px);
      if (geo.groundUnion) {
        ctx.save();
        ctx.clip(geo.groundUnion);
        // variations de teinte (taches d'herbe, ombres) pour casser l'aplat
        let pat = this.groundPatterns.get(ctx);
        if (!pat) {
          pat = ctx.createPattern(getPaperTile(), 'repeat')!;
          this.groundPatterns.set(ctx, pat);
        }
        pat.setTransform(new DOMMatrix([14 / 256, 0, 0, 14 / 256, 0.37, 0.71]));
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = pat;
        ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
        ctx.globalAlpha = 1;
        if (o.grid && theme.gridStyle !== 'none') this.drawGrid(ctx, map, theme, vx0, vy0, vx1, vy1, px);
        ctx.restore();
      }
    }

    // Hachures (uniquement dans le vide)
    if (theme.hatchStyle !== 'none') {
      ctx.strokeStyle = theme.hatch;
      ctx.lineWidth = Math.max(theme.hatchLine, 0.7 * px);
      for (const p of this.geo.hatch.visible(vx0, vy0, vx1, vy1)) ctx.stroke(p);
    }

    // Ombre portée des bâtiments sur le terrain
    if (geo.ground.length && geo.floorCount) {
      ctx.save();
      ctx.translate(0.14, 0.18);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill(geo.floorPath);
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 0.4;
      ctx.stroke(geo.floorPath);
      ctx.restore();
    }

    // Sol
    ctx.fillStyle = theme.floor;
    ctx.fill(geo.floorPath);

    ctx.save();
    ctx.clip(geo.floorPath);
    this.drawTerrains(ctx, geo.terrains, theme, px);

    if (o.grid && theme.gridStyle !== 'none') this.drawGrid(ctx, map, theme, vx0, vy0, vx1, vy1, px);

    // Ombre portée intérieure le long des murs
    ctx.strokeStyle = theme.shadow;
    ctx.lineWidth = theme.shadowWidth * 2;
    ctx.stroke(geo.wallPath);
    ctx.lineWidth = theme.shadowWidth;
    ctx.stroke(geo.wallPath);
    ctx.restore();

    // Murs
    ctx.strokeStyle = theme.wall;
    ctx.lineWidth = Math.max(theme.wallWidth, 1.5 * px);
    ctx.stroke(geo.wallPath);

    // Portes & ouvertures
    const marks: Portal[] = [];
    for (const p of geo.portals) {
      if (Math.max(p.x1, p.x2) < vx0 - 1 || Math.min(p.x1, p.x2) > vx1 + 1 || Math.max(p.y1, p.y2) < vy0 - 1 || Math.min(p.y1, p.y2) > vy1 + 1) continue;
      this.drawPortal(ctx, p, theme, o.mode, px);
      if (p.type === EDGE.SECRET && o.mode !== 'player') marks.push(p);
    }

    // Objets
    const props = map.props
      .filter((p) => !(p.gmOnly && o.mode === 'player'))
      .filter((p) => !o.bakeProp || o.bakeProp(p))
      .filter((p) => {
        const b = propBounds(p);
        return b.x1 >= vx0 && b.x0 <= vx1 && b.y1 >= vy0 && b.y0 <= vy1;
      })
      .sort((a, b) => (PROP_BY_KIND[a.kind]?.layer ?? 1) - (PROP_BY_KIND[b.kind]?.layer ?? 1));
    for (const p of props) {
      drawProp(ctx, p, theme.pal);
      if (p.gmOnly && o.mode !== 'player' && p.kind !== 'trap') {
        const b = propBounds(p);
        ctx.save();
        ctx.setLineDash([0.12, 0.08]);
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = Math.max(0.03, px);
        ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
        ctx.restore();
      }
    }

    // Éclairage
    if (o.lighting) this.drawLighting(ctx, map, geo, o);

    // Grain de papier
    if (theme.paper > 0) {
      let pat = this.patterns.get(ctx);
      if (!pat) {
        pat = ctx.createPattern(getPaperTile(), 'repeat')!;
        this.patterns.set(ctx, pat);
      }
      pat.setTransform(new DOMMatrix([8 / 256, 0, 0, 8 / 256, 0, 0]));
      ctx.globalAlpha = theme.paper;
      ctx.fillStyle = pat;
      ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
      ctx.globalAlpha = 1;
    }

    // Repères "S" des portes secrètes (MJ)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (marks.length && scale > 12) {
      ctx.font = `700 ${Math.round(scale * 0.32)}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = theme.accent;
      for (const p of marks) {
        const horiz = p.y1 === p.y2;
        const mx = (p.x1 + p.x2) / 2 + (horiz ? 0 : 0.28),
          my = (p.y1 + p.y2) / 2 + (horiz ? 0.3 : 0);
        ctx.fillText('S', (mx - ox) * scale, (my - oy) * scale);
      }
    }

    // Étiquettes (en espace écran pour un texte net)
    if (o.labels !== false) {
      for (const l of map.labels) {
        if (l.gmOnly && o.mode === 'player') continue;
        const fpx = l.size * scale;
        if (fpx < 5) continue;
        const sx = (l.x - ox) * scale,
          sy = (l.y - oy) * scale;
        if (sx < -fpx * 10 || sy < -fpx || sx > o.width + fpx * 10 || sy > o.height + fpx) continue;
        const color = l.color || theme.label;
        ctx.font = `700 ${fpx}px "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(2, fpx * 0.22);
        ctx.strokeStyle = luminance(color) > 0.5 ? 'rgba(0,0,0,0.75)' : rgba(mix(theme.floor, '#ffffff', 0.4), 0.9);
        ctx.strokeText(l.text, sx, sy);
        ctx.fillStyle = color;
        ctx.fillText(l.text, sx, sy);
      }
    }

    // Repères d'édition
    if (o.mode === 'editor') this.drawEditorOverlay(ctx, map, theme, o);
    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, map: DungeonMap, theme: ResolvedTheme, vx0: number, vy0: number, vx1: number, vy1: number, px: number): void {
    const x0 = Math.max(0, Math.floor(vx0)),
      x1 = Math.min(map.cols, Math.ceil(vx1));
    const y0 = Math.max(0, Math.floor(vy0)),
      y1 = Math.min(map.rows, Math.ceil(vy1));
    if (x1 <= x0 || y1 <= y0) return;
    // Évite une grille illisible en dézoom extrême
    if (1 / px < 6) return;
    const path = new Path2D();
    ctx.strokeStyle = theme.grid;
    if (theme.gridStyle === 'dotted') {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          path.moveTo(x, y);
          path.lineTo(x + 0.001, y);
        }
      ctx.lineWidth = Math.max(theme.gridWidth, 1.5 * px);
      ctx.stroke(path);
      return;
    }
    for (let x = x0; x <= x1; x++) {
      path.moveTo(x, y0);
      path.lineTo(x, y1);
    }
    for (let y = y0; y <= y1; y++) {
      path.moveTo(x0, y);
      path.lineTo(x1, y);
    }
    ctx.lineWidth = Math.max(theme.gridWidth, 0.8 * px);
    if (theme.gridStyle === 'dashed') ctx.setLineDash([0.16, 0.1]);
    ctx.lineCap = 'butt';
    ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
  }

  private drawPortal(ctx: CanvasRenderingContext2D, p: Portal, theme: ResolvedTheme, mode: RenderMode, px: number): void {
    const mx = (p.x1 + p.x2) / 2,
      my = (p.y1 + p.y2) / 2;
    const horiz = p.y1 === p.y2;
    const ww = Math.max(theme.wallWidth, 1.5 * px);
    ctx.save();
    ctx.translate(mx, my);
    if (!horiz) ctx.rotate(Math.PI / 2);
    const jambs = (a: number) => {
      ctx.beginPath();
      ctx.moveTo(-0.5, 0);
      ctx.lineTo(-a, 0);
      ctx.moveTo(a, 0);
      ctx.lineTo(0.5, 0);
      ctx.strokeStyle = theme.wall;
      ctx.lineWidth = ww;
      ctx.stroke();
    };
    switch (p.type) {
      case EDGE.DOOR:
      case EDGE.LOCKED: {
        jambs(0.36);
        ctx.beginPath();
        ctx.rect(-0.36, -0.11, 0.72, 0.22);
        ctx.fillStyle = theme.door;
        ctx.fill();
        ctx.lineWidth = Math.max(ww * 0.45, px);
        ctx.strokeStyle = theme.wall;
        ctx.stroke();
        if (p.type === EDGE.LOCKED) {
          ctx.beginPath();
          ctx.moveTo(0, -0.17);
          ctx.lineTo(0, 0.17);
          ctx.lineWidth = Math.max(ww * 0.7, px);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, 0.07, 0, Math.PI * 2);
          ctx.fillStyle = theme.wall;
          ctx.fill();
        }
        break;
      }
      case EDGE.SECRET: {
        ctx.beginPath();
        ctx.moveTo(-0.5, 0);
        ctx.lineTo(0.5, 0);
        ctx.strokeStyle = theme.wall;
        ctx.lineWidth = ww;
        ctx.stroke();
        if (mode !== 'player') {
          ctx.setLineDash([0.07, 0.05]);
          ctx.strokeStyle = theme.accent;
          ctx.lineWidth = Math.max(0.03, px);
          ctx.strokeRect(-0.38, -0.14, 0.76, 0.28);
          ctx.setLineDash([]);
        }
        break;
      }
      case EDGE.WINDOW: {
        jambs(0.4);
        ctx.beginPath();
        ctx.rect(-0.4, -0.07, 0.8, 0.14);
        ctx.fillStyle = mix(theme.floor, '#9fd0ff', 0.55);
        ctx.fill();
        ctx.lineWidth = Math.max(ww * 0.4, px);
        ctx.strokeStyle = theme.wall;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-0.4, 0);
        ctx.lineTo(0.4, 0);
        ctx.lineWidth = Math.max(ww * 0.25, px);
        ctx.stroke();
        break;
      }
      case EDGE.BARS: {
        jambs(0.42);
        ctx.fillStyle = theme.wall;
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.arc(-0.32 + i * 0.16, 0, 0.045, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }
    ctx.restore();
  }

  private drawLighting(ctx: CanvasRenderingContext2D, map: DungeonMap, geo: Geometry, o: RenderOpts): void {
    const { scale, ox, oy } = o.view;
    if (!this.lightLayer) this.lightLayer = document.createElement('canvas');
    const layer = this.lightLayer;
    if (layer.width !== o.width || layer.height !== o.height) {
      layer.width = o.width;
      layer.height = o.height;
    }
    const l = layer.getContext('2d')!;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, o.width, o.height);
    l.fillStyle = `rgba(5,7,16,${map.settings.darkness})`;
    l.fillRect(0, 0, o.width, o.height);
    l.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
    l.globalCompositeOperation = 'destination-out';
    const vx1 = ox + o.width / scale,
      vy1 = oy + o.height / scale;
    const tint: [number[], number, number, number, string][] = [];
    for (const li of allLights(map)) {
      if (li.x + li.radius < ox || li.x - li.radius > vx1 || li.y + li.radius < oy || li.y - li.radius > vy1) continue;
      const poly = this.lights.polygon(map, geo, li.x, li.y, li.radius);
      if (poly.length < 6) continue;
      const g = l.createRadialGradient(li.x, li.y, 0, li.x, li.y, li.radius);
      g.addColorStop(0, `rgba(0,0,0,${li.intensity})`);
      g.addColorStop(0.5, `rgba(0,0,0,${li.intensity * 0.85})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      l.beginPath();
      l.moveTo(poly[0], poly[1]);
      for (let i = 2; i < poly.length; i += 2) l.lineTo(poly[i], poly[i + 1]);
      l.closePath();
      l.fillStyle = g;
      l.fill();
      tint.push([poly, li.x, li.y, li.radius, li.color]);
    }
    // Teinte colorée sous l'obscurité
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    for (const [poly, x, y, r, color] of tint) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(color, 0.9));
      g.addColorStop(1, rgba(color, 0));
      ctx.beginPath();
      ctx.moveTo(poly[0], poly[1]);
      for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  private drawEditorOverlay(ctx: CanvasRenderingContext2D, map: DungeonMap, theme: ResolvedTheme, o: RenderOpts): void {
    const { scale, ox, oy } = o.view;
    const sx = (x: number) => (x - ox) * scale;
    const sy = (y: number) => (y - oy) * scale;
    // Hors carte
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, o.width, o.height);
    ctx.rect(sx(0), sy(0), map.cols * scale, map.rows * scale);
    ctx.fillStyle = 'rgba(10,10,14,0.45)';
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(sx(0) + 0.5, sy(0) + 0.5, map.cols * scale, map.rows * scale);
    ctx.restore();

    // Lumières (icônes)
    const sel = o.selection;
    for (const l of map.lights) {
      const x = sx(l.x),
        y = sy(l.y);
      const isSel = sel?.has(l.id);
      if (isSel) {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, l.radius * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, (l.radius / 2) * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = l.color;
      ctx.fill();
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.strokeStyle = isSel ? '#ffffff' : 'rgba(0,0,0,0.7)';
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.moveTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
        ctx.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Sélection
    if (sel && sel.size) {
      ctx.save();
      ctx.strokeStyle = '#4cc2ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      for (const p of map.props) {
        if (!sel.has(p.id)) continue;
        ctx.save();
        ctx.translate(sx(p.x), sy(p.y));
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.strokeRect((-p.w / 2) * scale - 3, (-p.h / 2) * scale - 3, p.w * scale + 6, p.h * scale + 6);
        ctx.restore();
      }
      for (const l of map.labels) {
        if (!sel.has(l.id)) continue;
        const fpx = l.size * scale;
        ctx.font = `700 ${fpx}px "Palatino Linotype", Georgia, serif`;
        const w = ctx.measureText(l.text).width;
        ctx.strokeRect(sx(l.x) - w / 2 - 4, sy(l.y) - fpx / 2 - 4, w + 8, fpx + 8);
      }
      ctx.restore();
    }
  }
}
