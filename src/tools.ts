import type { App } from './app';
import { EDGE, EDGE_NAMES, FLOOR_TERRAINS, GROUND_TERRAINS, LIGHT_ANIMS, LightAnim, Prop, T, TerrainDef } from './model';
import { PROPS, PROP_BY_KIND, PROP_CATS, drawProp, propBounds } from './props';
import { library } from './assets';
import { libraryView } from './library-panel';
import { autoRoofs } from './roofs';
import { button, checkbox, colorInput, field, h, range, section, segmented, select } from './ui';
import { uid } from './util';

export interface PInfo {
  wx: number;
  wy: number;
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  button: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export interface Tool {
  id: string;
  name: string;
  key: string;
  icon: string;
  hint: string;
  down?(p: PInfo): void;
  move?(p: PInfo, dragging: boolean): void;
  up?(p: PInfo): void;
  overlay?(ctx: CanvasRenderingContext2D, px: number): void;
  panel?(): HTMLElement | null;
  onKey?(e: KeyboardEvent): boolean;
  onWheel?(e: WheelEvent): boolean;
  activate?(): void;
  deactivate?(): void;
}

export interface ToolOpts {
  terrain: number;
  brushSize: number;
  brushRound: boolean;
  roomShape: 'rect' | 'ellipse';
  doorType: number;
  propKind: string;
  propRot: number;
  propGm: boolean;
  propRoof: boolean;
  propTile: boolean;
  /** Image personnelle choisie (objets « image ») et sa taille en cases. */
  propAsset: string;
  propAssetPath: string;
  propAssetW: number;
  propAssetH: number;
  lightRadius: number;
  lightColor: string;
  lightIntensity: number;
  lightAnim: LightAnim;
  labelSize: number;
  labelGm: boolean;
  autoNumber: boolean;
  nextNumber: number;
  eraseProps: boolean;
  fillIgnoreWalls: boolean;
  groundTerrain: number;
  groundSize: number;
  groundRound: boolean;
  groundFill: boolean;
}

export function defaultToolOpts(): ToolOpts {
  return {
    terrain: T.STONE,
    brushSize: 1,
    brushRound: false,
    roomShape: 'rect',
    doorType: EDGE.DOOR,
    propKind: 'pillar',
    propRot: 0,
    propGm: false,
    propRoof: false,
    propTile: false,
    propAsset: '',
    propAssetPath: '',
    propAssetW: 1,
    propAssetH: 1,
    lightRadius: 6,
    lightColor: '#ffb066',
    lightIntensity: 0.8,
    lightAnim: 'torch',
    labelSize: 0.8,
    labelGm: true,
    autoNumber: false,
    nextNumber: 1,
    eraseProps: true,
    fillIgnoreWalls: false,
    groundTerrain: T.GRASS,
    groundSize: 3,
    groundRound: true,
    groundFill: false,
  };
}

const ACCENT = '#4cc2ff';
const MINE = 'Mes images';
const ERASE = '#ff5a5a';

// ---------- Sélecteur de terrain ----------

function terrainPicker(app: App, list: TerrainDef[] = FLOOR_TERRAINS, key: 'terrain' | 'groundTerrain' = 'terrain'): HTMLElement {
  const wrap = h('div', { class: 'swatches' });
  for (const t of list) {
    const b = h(
      'button',
      { class: 'swatch' + (app.opts[key] === t.id ? ' on' : ''), title: t.name, type: 'button' },
      h('span', { class: 'chip', style: { background: app.theme.terrain[t.id] } }),
      h('span', { class: 'swatch-label' }, t.name),
    );
    b.addEventListener('click', () => {
      app.opts[key] = t.id;
      wrap.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
    wrap.append(b);
  }
  return wrap;
}

function brushOptions(app: App): HTMLElement[] {
  return [
    field('Taille', range(app.opts.brushSize, 1, 9, 1, (v) => (app.opts.brushSize = v), (v) => `${v} case${v > 1 ? 's' : ''}`)),
    field(
      'Forme',
      segmented<string>(
        [
          ['square', 'Carrée'],
          ['round', 'Ronde'],
        ],
        app.opts.brushRound ? 'round' : 'square',
        (v) => (app.opts.brushRound = v === 'round'),
      ),
    ),
  ];
}

function brushCells(s: number, round: boolean, cx: number, cy: number): [number, number][] {
  const lo = -Math.floor((s - 1) / 2),
    hi = Math.ceil((s - 1) / 2);
  const out: [number, number][] = [];
  const c = (s - 1) / 2 + lo;
  for (let dy = lo; dy <= hi; dy++)
    for (let dx = lo; dx <= hi; dx++) {
      if (round && s > 2) {
        const ex = dx - c,
          ey = dy - c;
        if (ex * ex + ey * ey > (s / 2) * (s / 2) + 0.1) continue;
      }
      out.push([cx + dx, cy + dy]);
    }
  return out;
}

function lineCells(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0),
    dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 10000; guard++) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}

/** Arête la plus proche d'un point (horizontale ou verticale). */
export function nearestEdge(wx: number, wy: number): { horiz: boolean; x: number; y: number; d: number } {
  const ry = Math.round(wy),
    dy = Math.abs(wy - ry);
  const rx = Math.round(wx),
    dx = Math.abs(wx - rx);
  if (dy <= dx) return { horiz: true, x: Math.floor(wx), y: ry, d: dy };
  return { horiz: false, x: rx, y: Math.floor(wy), d: dx };
}

function strokeEdge(ctx: CanvasRenderingContext2D, e: { horiz: boolean; x: number; y: number }, color: string, w: number): void {
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  if (e.horiz) ctx.lineTo(e.x + 1, e.y);
  else ctx.lineTo(e.x, e.y + 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ---------- Outils ----------

export function createTools(app: App): Tool[] {
  const opts = app.opts;

  // --- Sélection
  const sel = (() => {
    let drag: { sx: number; sy: number; items: { o: { x: number; y: number }; x: number; y: number }[]; moved: boolean } | null = null;
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    const tool: Tool = {
      id: 'select',
      name: 'Sélection',
      key: 'v',
      icon: 'select',
      hint: 'Clic : sélectionner · Glisser : déplacer (Alt = libre) · Maj : ajouter · Suppr : effacer · Q : pivoter · Ctrl+D : dupliquer',
      down(p) {
        const hit = app.hitTest(p.wx, p.wy);
        if (hit) {
          if (p.shift) {
            if (app.selection.has(hit)) app.selection.delete(hit);
            else app.selection.add(hit);
          } else if (!app.selection.has(hit)) {
            app.selection.clear();
            app.selection.add(hit);
          }
          const items = app.selectedObjects().map((o) => ({ o, x: o.x, y: o.y }));
          drag = { sx: p.wx, sy: p.wy, items, moved: false };
          app.selectionChanged();
        } else {
          if (!p.shift) app.selection.clear();
          box = { x0: p.wx, y0: p.wy, x1: p.wx, y1: p.wy };
          app.selectionChanged();
        }
      },
      move(p, dragging) {
        if (!dragging) return;
        if (drag) {
          let dx = p.wx - drag.sx,
            dy = p.wy - drag.sy;
          if (!drag.moved && Math.hypot(dx, dy) < 0.15) return;
          if (!drag.moved) {
            app.edit();
            drag.moved = true;
          }
          if (!p.alt) {
            dx = Math.round(dx * 2) / 2;
            dy = Math.round(dy * 2) / 2;
          }
          for (const it of drag.items) {
            it.o.x = it.x + dx;
            it.o.y = it.y + dy;
          }
          app.changed(false);
        } else if (box) {
          box.x1 = p.wx;
          box.y1 = p.wy;
          app.requestRender();
        }
      },
      up() {
        if (box) {
          const x0 = Math.min(box.x0, box.x1),
            x1 = Math.max(box.x0, box.x1),
            y0 = Math.min(box.y0, box.y1),
            y1 = Math.max(box.y0, box.y1);
          if (x1 - x0 > 0.2 || y1 - y0 > 0.2) {
            const inside = (o: { x: number; y: number }) => o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1;
            for (const o of app.map.props) if (inside(o)) app.selection.add(o.id);
            for (const o of app.map.lights) if (inside(o)) app.selection.add(o.id);
            for (const o of app.map.labels) if (inside(o)) app.selection.add(o.id);
            app.selectionChanged();
          }
          box = null;
          app.requestRender();
        }
        if (drag?.moved) app.renderPanel();
        drag = null;
      },
      overlay(ctx, px) {
        if (!box) return;
        ctx.fillStyle = 'rgba(76,194,255,0.12)';
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = px * 1.5;
        ctx.setLineDash([px * 5, px * 3]);
        ctx.fillRect(Math.min(box.x0, box.x1), Math.min(box.y0, box.y1), Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
        ctx.strokeRect(Math.min(box.x0, box.x1), Math.min(box.y0, box.y1), Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
        ctx.setLineDash([]);
      },
      onKey(e) {
        if (e.key === 'q' || e.key === 'Q') {
          app.rotateSelection(e.shiftKey ? -90 : 90);
          return true;
        }
        return false;
      },
      onWheel(e) {
        if (!e.shiftKey || !app.selection.size) return false;
        app.rotateSelection(e.deltaY > 0 ? (e.altKey ? 15 : 90) : e.altKey ? -15 : -90);
        return true;
      },
    };
    return tool;
  })();

  // --- Salle (rectangle / ellipse)
  const room = (() => {
    let start: { x: number; y: number } | null = null;
    let cur = { x: 0, y: 0 };
    let erase = false;
    const rect = () => {
      const x0 = Math.min(start!.x, cur.x),
        y0 = Math.min(start!.y, cur.y);
      return { x0, y0, x1: Math.max(start!.x, cur.x) + 1, y1: Math.max(start!.y, cur.y) + 1 };
    };
    const cellsOf = (r: { x0: number; y0: number; x1: number; y1: number }) => {
      const out: [number, number][] = [];
      const ell = opts.roomShape === 'ellipse';
      const cx = (r.x0 + r.x1) / 2,
        cy = (r.y0 + r.y1) / 2,
        rx = (r.x1 - r.x0) / 2,
        ry = (r.y1 - r.y0) / 2;
      for (let y = r.y0; y < r.y1; y++)
        for (let x = r.x0; x < r.x1; x++) {
          if (ell) {
            const dx = (x + 0.5 - cx) / rx,
              dy = (y + 0.5 - cy) / ry;
            if (dx * dx + dy * dy > 1.05) continue;
          }
          out.push([x, y]);
        }
      return out;
    };
    const tool: Tool = {
      id: 'room',
      name: 'Salle',
      key: 'r',
      icon: 'room',
      hint: 'Glisser : tracer une salle · Clic droit + glisser : creuser du vide · Maj : carré',
      down(p) {
        start = { x: p.cx, y: p.cy };
        cur = { x: p.cx, y: p.cy };
        erase = p.button === 2;
        app.requestRender();
      },
      move(p, dragging) {
        if (!dragging || !start) return;
        cur = { x: p.cx, y: p.cy };
        if (p.shift) {
          const s = Math.max(Math.abs(cur.x - start.x), Math.abs(cur.y - start.y));
          cur = { x: start.x + Math.sign(cur.x - start.x || 1) * s, y: start.y + Math.sign(cur.y - start.y || 1) * s };
        }
        app.requestRender();
      },
      up() {
        if (!start) return;
        app.edit();
        const v = erase ? 0 : opts.terrain;
        for (const [x, y] of cellsOf(rect())) app.map.set(x, y, v);
        start = null;
        app.changed(true);
      },
      overlay(ctx, px) {
        if (!start) {
          if (app.hover) {
            ctx.strokeStyle = 'rgba(76,194,255,0.8)';
            ctx.lineWidth = px * 1.5;
            ctx.strokeRect(Math.floor(app.hover.wx), Math.floor(app.hover.wy), 1, 1);
          }
          return;
        }
        const r = rect();
        const color = erase ? ERASE : ACCENT;
        ctx.fillStyle = erase ? 'rgba(255,90,90,0.18)' : 'rgba(76,194,255,0.18)';
        ctx.strokeStyle = color;
        ctx.lineWidth = px * 2;
        ctx.beginPath();
        if (opts.roomShape === 'ellipse') ctx.ellipse((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, (r.x1 - r.x0) / 2, (r.y1 - r.y0) / 2, 0, 0, Math.PI * 2);
        else ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        ctx.fill();
        ctx.stroke();
        app.overlayText(`${r.x1 - r.x0} × ${r.y1 - r.y0}`, r.x1, r.y0 - 0.2);
      },
      panel: () =>
        section('Salle', [
          field(
            'Forme',
            segmented<string>(
              [
                ['rect', 'Rectangle'],
                ['ellipse', 'Ellipse'],
              ],
              opts.roomShape,
              (v) => (opts.roomShape = v as 'rect' | 'ellipse'),
            ),
          ),
          h('div', { class: 'sub' }, 'Sol'),
          terrainPicker(app),
        ]),
    };
    return tool;
  })();

  // --- Pinceau / gomme
  const makeBrush = (erase: boolean): Tool => {
    let last: { x: number; y: number } | null = null;
    let rightErase = false;
    const paint = (x: number, y: number) => {
      const v = erase || rightErase ? 0 : opts.terrain;
      const pts = last ? lineCells(last.x, last.y, x, y) : [[x, y] as [number, number]];
      let changed = false;
      for (const [px, py] of pts)
        for (const [cx, cy] of brushCells(app.opts.brushSize, app.opts.brushRound, px, py)) {
          if (app.map.set(cx, cy, v)) changed = true;
          if (v === 0 && erase && opts.eraseProps) {
            const before = app.map.props.length;
            app.map.props = app.map.props.filter((p) => !(Math.floor(p.x) === cx && Math.floor(p.y) === cy));
            if (app.map.props.length !== before) changed = true;
          }
        }
      last = { x, y };
      if (changed) app.changed(true);
    };
    return {
      id: erase ? 'erase' : 'brush',
      name: erase ? 'Gomme' : 'Pinceau',
      key: erase ? 'e' : 'b',
      icon: erase ? 'erase' : 'brush',
      hint: erase ? 'Glisser : effacer le sol (et les objets) · [ ] : taille' : 'Glisser : peindre le sol · Clic droit : effacer · [ ] : taille',
      down(p) {
        app.edit();
        rightErase = p.button === 2;
        last = null;
        paint(p.cx, p.cy);
      },
      move(p, dragging) {
        if (dragging) paint(p.cx, p.cy);
        else app.requestRender();
      },
      up() {
        last = null;
      },
      overlay(ctx, px) {
        if (!app.hover) return;
        ctx.fillStyle = erase ? 'rgba(255,90,90,0.25)' : 'rgba(76,194,255,0.25)';
        ctx.strokeStyle = erase ? ERASE : ACCENT;
        ctx.lineWidth = px;
        for (const [x, y] of brushCells(app.opts.brushSize, app.opts.brushRound, Math.floor(app.hover.wx), Math.floor(app.hover.wy))) {
          ctx.fillRect(x, y, 1, 1);
        }
      },
      onKey(e) {
        if (e.key === '[' || e.key === ']') {
          opts.brushSize = Math.max(1, Math.min(9, opts.brushSize + (e.key === ']' ? 1 : -1)));
          app.renderPanel();
          app.requestRender();
          return true;
        }
        return false;
      },
      panel: () =>
        erase
          ? section('Gomme', [...brushOptions(app), checkbox('Effacer aussi les objets', opts.eraseProps, (v) => (opts.eraseProps = v))])
          : section('Pinceau', [...brushOptions(app), h('div', { class: 'sub' }, 'Sol'), terrainPicker(app)]),
    };
  };

  // --- Pot de peinture
  const fill: Tool = {
    id: 'fill',
    name: 'Remplissage',
    key: 'f',
    icon: 'fill',
    hint: "Clic dans une salle : change son sol (s'arrête aux murs et portes)",
    down(p) {
      const m = app.map;
      const from = m.get(p.cx, p.cy);
      if (!from) {
        app.toast('Cliquez à l’intérieur d’une salle.');
        return;
      }
      if (from === opts.terrain) return;
      app.edit();
      const stack = [[p.cx, p.cy]];
      const seen = new Uint8Array(m.cols * m.rows);
      seen[p.cy * m.cols + p.cx] = 1;
      while (stack.length) {
        const [x, y] = stack.pop()!;
        m.set(x, y, opts.terrain);
        const nb: [number, number, number][] = [
          [x + 1, y, m.vEdge(x + 1, y)],
          [x - 1, y, m.vEdge(x, y)],
          [x, y + 1, m.hEdge(x, y + 1)],
          [x, y - 1, m.hEdge(x, y)],
        ];
        for (const [nx, ny, e] of nb) {
          if (!m.inBounds(nx, ny) || seen[ny * m.cols + nx]) continue;
          if (m.get(nx, ny) !== from) continue;
          if (e && !opts.fillIgnoreWalls) continue;
          seen[ny * m.cols + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      app.changed(true);
    },
    panel: () =>
      section('Remplissage', [
        checkbox('Traverser murs et portes', opts.fillIgnoreWalls, (v) => (opts.fillIgnoreWalls = v)),
        h('div', { class: 'sub' }, 'Sol'),
        terrainPicker(app),
      ]),
  };

  // --- Terrain extérieur (calque sous les bâtiments)
  const terrain = (() => {
    let last: { x: number; y: number } | null = null;
    let erase = false;
    const fillMode = (p: PInfo) => opts.groundFill || p.shift;
    const paint = (x: number, y: number) => {
      const v = erase ? 0 : opts.groundTerrain;
      const pts = last ? lineCells(last.x, last.y, x, y) : [[x, y] as [number, number]];
      let changed = false;
      for (const [px, py] of pts)
        for (const [cx, cy] of brushCells(opts.groundSize, opts.groundRound, px, py)) if (app.map.setGround(cx, cy, v)) changed = true;
      last = { x, y };
      if (changed) app.changed(true);
    };
    const flood = (x0: number, y0: number, v: number) => {
      const m = app.map;
      if (!m.inBounds(x0, y0)) return;
      const from = m.getGround(x0, y0);
      if (from === v) return;
      app.edit();
      const seen = new Uint8Array(m.cols * m.rows);
      const stack = [y0 * m.cols + x0];
      seen[stack[0]] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % m.cols,
          y = (i / m.cols) | 0;
        m.setGround(x, y, v);
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ]) {
          if (!m.inBounds(nx, ny)) continue;
          const j = ny * m.cols + nx;
          if (seen[j] || m.ground[j] !== from) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
      app.changed(true);
    };
    const tool: Tool = {
      id: 'terrain',
      name: 'Terrain',
      key: 'n',
      icon: 'tree',
      hint: 'Peindre le terrain extérieur (herbe, chemin, eau…) · Clic droit : effacer · Maj+clic : remplir la zone · [ ] : taille',
      down(p) {
        erase = p.button === 2;
        if (fillMode(p)) {
          flood(p.cx, p.cy, erase ? 0 : opts.groundTerrain);
          return;
        }
        app.edit();
        last = null;
        paint(p.cx, p.cy);
      },
      move(p, dragging) {
        if (dragging && last && !fillMode(p)) paint(p.cx, p.cy);
        else app.requestRender();
      },
      up() {
        last = null;
      },
      overlay(ctx) {
        if (!app.hover || opts.groundFill) return;
        ctx.fillStyle = 'rgba(120,220,120,0.25)';
        for (const [x, y] of brushCells(opts.groundSize, opts.groundRound, Math.floor(app.hover.wx), Math.floor(app.hover.wy))) ctx.fillRect(x, y, 1, 1);
      },
      onKey(e) {
        if (e.key === '[' || e.key === ']') {
          opts.groundSize = Math.max(1, Math.min(15, opts.groundSize + (e.key === ']' ? 1 : -1)));
          app.renderPanel();
          app.requestRender();
          return true;
        }
        return false;
      },
      panel: () =>
        section('Terrain extérieur', [
          field(
            'Mode',
            segmented<string>(
              [
                ['brush', 'Pinceau'],
                ['fill', 'Remplissage'],
              ],
              opts.groundFill ? 'fill' : 'brush',
              (v) => (opts.groundFill = v === 'fill'),
            ),
          ),
          field('Taille', range(opts.groundSize, 1, 15, 1, (v) => (opts.groundSize = v), (v) => `${v} case${v > 1 ? 's' : ''}`)),
          field(
            'Forme',
            segmented<string>(
              [
                ['square', 'Carrée'],
                ['round', 'Ronde'],
              ],
              opts.groundRound ? 'round' : 'square',
              (v) => (opts.groundRound = v === 'round'),
            ),
          ),
          h('div', { class: 'sub' }, 'Terrain'),
          terrainPicker(app, GROUND_TERRAINS, 'groundTerrain'),
          button(
            'Remplir tout le niveau',
            () => {
              app.edit();
              app.map.ground.fill(opts.groundTerrain);
              app.map.touchAll();
              app.changed(true);
            },
            'small',
          ),
          h('p', { class: 'help' }, 'Le terrain se place sous les bâtiments, sans murs ni hachures : forêts, villages, routes, rivières. Les salles dessinées par-dessus deviennent des bâtiments.'),
        ]),
    };
    return tool;
  })();

  // --- Murs intérieurs
  const wall = (() => {
    let start: { x: number; y: number } | null = null;
    let end = { x: 0, y: 0 };
    let erase = false;
    const seg = () => {
      const dx = end.x - start!.x,
        dy = end.y - start!.y;
      if (Math.abs(dx) >= Math.abs(dy)) return { horiz: true, a: Math.min(start!.x, end.x), b: Math.max(start!.x, end.x), k: start!.y };
      return { horiz: false, a: Math.min(start!.y, end.y), b: Math.max(start!.y, end.y), k: start!.x };
    };
    const tool: Tool = {
      id: 'wall',
      name: 'Mur',
      key: 'w',
      icon: 'wall',
      hint: 'Glisser le long de la grille : tracer un mur · Clic droit + glisser : effacer · Clic : basculer une arête',
      down(p) {
        start = { x: Math.round(p.wx), y: Math.round(p.wy) };
        end = { ...start };
        erase = p.button === 2;
        app.requestRender();
      },
      move(p, dragging) {
        if (dragging && start) end = { x: Math.round(p.wx), y: Math.round(p.wy) };
        app.requestRender();
      },
      up(p) {
        if (!start) return;
        const s = seg();
        app.edit();
        if (s.a === s.b) {
          const e = nearestEdge(p.wx, p.wy);
          const cur = e.horiz ? app.map.hEdge(e.x, e.y) : app.map.vEdge(e.x, e.y);
          const v = erase ? EDGE.NONE : cur === EDGE.WALL ? EDGE.NONE : EDGE.WALL;
          if (e.horiz) app.map.setHEdge(e.x, e.y, v);
          else app.map.setVEdge(e.x, e.y, v);
        } else {
          for (let i = s.a; i < s.b; i++) {
            if (s.horiz) app.map.setHEdge(i, s.k, erase ? EDGE.NONE : EDGE.WALL);
            else app.map.setVEdge(s.k, i, erase ? EDGE.NONE : EDGE.WALL);
          }
        }
        start = null;
        app.changed(true);
      },
      overlay(ctx, px) {
        if (start) {
          const s = seg();
          ctx.beginPath();
          if (s.horiz) {
            ctx.moveTo(s.a, s.k);
            ctx.lineTo(s.b, s.k);
          } else {
            ctx.moveTo(s.k, s.a);
            ctx.lineTo(s.k, s.b);
          }
          ctx.strokeStyle = erase ? ERASE : ACCENT;
          ctx.lineWidth = Math.max(0.15, px * 4);
          ctx.lineCap = 'round';
          ctx.stroke();
        } else if (app.hover) {
          ctx.beginPath();
          ctx.arc(Math.round(app.hover.wx), Math.round(app.hover.wy), Math.max(0.08, px * 4), 0, Math.PI * 2);
          ctx.fillStyle = ACCENT;
          ctx.fill();
        }
      },
      panel: () =>
        section('Mur', [
          h(
            'p',
            { class: 'help' },
            'Les murs extérieurs sont automatiques autour du sol. Cet outil ajoute des cloisons entre deux zones de sol (et des murs Foundry correspondants).',
          ),
        ]),
    };
    return tool;
  })();

  // --- Portes et ouvertures
  const door = (() => {
    const DOOR_TYPES = [EDGE.DOOR, EDGE.LOCKED, EDGE.SECRET, EDGE.WINDOW, EDGE.BARS];
    const tool: Tool = {
      id: 'door',
      name: 'Porte',
      key: 'd',
      icon: 'door',
      hint: 'Clic sur une arête : poser / retirer · Clic droit : retirer · 1-5 : type de porte',
      down(p) {
        const e = nearestEdge(p.wx, p.wy);
        if (e.d > 0.4) return;
        const cur = e.horiz ? app.map.hEdge(e.x, e.y) : app.map.vEdge(e.x, e.y);
        const v = p.button === 2 || cur === opts.doorType ? EDGE.NONE : opts.doorType;
        app.edit();
        if (e.horiz) app.map.setHEdge(e.x, e.y, v);
        else app.map.setVEdge(e.x, e.y, v);
        app.changed(true);
      },
      move() {
        app.requestRender();
      },
      overlay(ctx, px) {
        if (!app.hover) return;
        const e = nearestEdge(app.hover.wx, app.hover.wy);
        if (e.d > 0.4) return;
        strokeEdge(ctx, e, 'rgba(76,194,255,0.85)', Math.max(0.2, px * 6));
      },
      onKey(e) {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= DOOR_TYPES.length) {
          opts.doorType = DOOR_TYPES[n - 1];
          app.renderPanel();
          return true;
        }
        return false;
      },
      panel: () =>
        section('Porte', [
          h(
            'div',
            { class: 'list' },
            DOOR_TYPES.map((t, i) => {
              const b = h('button', { class: 'list-item' + (opts.doorType === t ? ' on' : ''), type: 'button' }, h('kbd', {}, String(i + 1)), EDGE_NAMES[t]);
              b.addEventListener('click', () => {
                opts.doorType = t;
                app.renderPanel();
              });
              return b;
            }),
          ),
          h('p', { class: 'help' }, 'Les portes secrètes sont dessinées comme des murs dans l’image joueurs, et exportées en portes secrètes Foundry.'),
        ]),
    };
    return tool;
  })();

  // --- Objets
  const prop = (() => {
    let ghost: Prop | null = null;
    let cat = PROP_BY_KIND[opts.propKind]?.cat || (opts.propKind === 'image' ? MINE : PROP_CATS[0]);
    let area: { x0: number; y0: number; x1: number; y1: number } | null = null;
    const snapPos = (p: { wx: number; wy: number; alt: boolean }, pr: Prop) => {
      const b = propBounds({ ...pr, x: 0, y: 0 });
      const fw = b.x1 - b.x0,
        fh = b.y1 - b.y0;
      if (p.alt) return { x: p.wx, y: p.wy };
      const step = (s: number) => (s >= 1 ? 1 : 0.25);
      const sx = step(fw),
        sy = step(fh);
      return { x: Math.round((p.wx - fw / 2) / sx) * sx + fw / 2, y: Math.round((p.wy - fh / 2) / sy) * sy + fh / 2 };
    };
    /** Objet à poser (avant position). */
    const template = (): Prop => {
      const image = opts.propKind === 'image' && opts.propAsset;
      const def = PROP_BY_KIND[image ? 'image' : opts.propKind] ?? PROP_BY_KIND.pillar;
      const g: Prop = {
        id: 'ghost',
        kind: def.kind,
        x: 0,
        y: 0,
        w: image ? opts.propAssetW : def.w,
        h: image ? opts.propAssetH : def.h,
        rot: opts.propRot,
        gmOnly: opts.propGm || !!def.gmOnly,
      };
      if (image) g.asset = opts.propAsset;
      if (opts.propRoof && !def.roof) g.roof = true;
      if (opts.propTile && !def.tile) g.tile = true;
      return g;
    };
    const makeGhost = (p: { wx: number; wy: number; alt: boolean }) => {
      const g = template();
      Object.assign(g, snapPos(p, g));
      return g;
    };
    const isArea = () => opts.propKind !== 'image' && !!PROP_BY_KIND[opts.propKind]?.area;
    /** Rectangle glissé -> objet (toits : léger débord pour couvrir les murs). */
    const areaProp = (): Prop | null => {
      if (!area) return null;
      const x0 = Math.min(area.x0, area.x1),
        x1 = Math.max(area.x0, area.x1),
        y0 = Math.min(area.y0, area.y1),
        y1 = Math.max(area.y0, area.y1);
      if (x1 - x0 < 1 || y1 - y0 < 1) return null;
      const g = template();
      const ov = g.kind.startsWith('roof') ? 0.15 : 0;
      return { ...g, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0 + 2 * ov, h: y1 - y0 + 2 * ov, rot: 0 };
    };
    const tool: Tool = {
      id: 'prop',
      name: 'Objets',
      key: 'o',
      icon: 'prop',
      hint: 'Clic : poser · Toits : glisser pour couvrir une zone · Q ou Maj+molette : pivoter · Alt : placement libre · Clic droit : supprimer l’objet survolé',
      down(p) {
        if (p.button === 2) {
          const id = app.hitTest(p.wx, p.wy, ['prop']);
          if (id) {
            app.edit();
            app.map.props = app.map.props.filter((o) => o.id !== id);
            app.changed(false);
          }
          return;
        }
        if (opts.propKind === 'image' && !opts.propAsset) {
          app.toast('Choisissez d’abord une image dans « Mes images ».');
          return;
        }
        if (isArea()) {
          area = { x0: Math.round(p.wx), y0: Math.round(p.wy), x1: Math.round(p.wx), y1: Math.round(p.wy) };
          ghost = null;
          app.requestRender();
          return;
        }
        const g = makeGhost(p);
        app.edit();
        app.map.props.push({ ...g, id: uid() });
        app.changed(false);
      },
      move(p, dragging) {
        if (area) {
          area.x1 = Math.round(p.wx);
          area.y1 = Math.round(p.wy);
          app.requestRender();
          return;
        }
        ghost = makeGhost(p);
        if (dragging && p.button === 0 && p.shift) {
          // Maj + glisser : peindre des objets
          const last = app.map.props[app.map.props.length - 1];
          if (last && last.kind === ghost.kind && Math.hypot(last.x - ghost.x, last.y - ghost.y) >= Math.max(ghost.w, ghost.h) - 0.01) {
            app.map.props.push({ ...ghost, id: uid() });
            app.changed(false);
          }
        }
        app.requestRender();
      },
      up(p) {
        if (!area) return;
        const r = areaProp() ?? makeGhost(p);
        area = null;
        app.edit();
        app.map.props.push({ ...r, id: uid() });
        app.changed(false);
      },
      overlay(ctx) {
        const r = area ? areaProp() : ghost && app.hover ? ghost : null;
        if (!r) return;
        if (area) app.overlayText(`${Math.abs(area.x1 - area.x0)} × ${Math.abs(area.y1 - area.y0)}`, r.x + r.w / 2, r.y - r.h / 2);
        ctx.save();
        ctx.globalAlpha = 0.65;
        drawProp(ctx, r, app.theme.pal, app.map.settings.skins);
        ctx.restore();
      },
      deactivate() {
        ghost = null;
        area = null;
      },
      onKey(e) {
        if (e.key === 'q' || e.key === 'Q') {
          opts.propRot = (opts.propRot + (e.shiftKey ? 270 : 90)) % 360;
          if (app.hover) ghost = makeGhost({ wx: app.hover.wx, wy: app.hover.wy, alt: false });
          app.requestRender();
          return true;
        }
        return false;
      },
      onWheel(e) {
        if (!e.shiftKey) return false;
        opts.propRot = (opts.propRot + (e.deltaY > 0 ? 90 : 270)) % 360;
        if (app.hover) ghost = makeGhost({ wx: app.hover.wx, wy: app.hover.wy, alt: false });
        app.requestRender();
        return true;
      },
      panel: () => {
        const content = h('div', {});
        const fill = () => {
          content.innerHTML = '';
          if (cat === MINE) {
            content.append(
              libraryView(app, opts.propAssetPath, (a, e) => {
                const s = library.sizeOf(a);
                opts.propKind = 'image';
                opts.propAsset = a.id;
                opts.propAssetPath = e.path;
                opts.propAssetW = s.w;
                opts.propAssetH = s.h;
                if (app.hover) ghost = makeGhost({ wx: app.hover.wx, wy: app.hover.wy, alt: false });
                app.requestRender();
              }),
            );
            return;
          }
          const grid = h('div', { class: 'prop-grid' });
          for (const def of PROPS.filter((d) => d.cat === cat)) {
            const cv = h('canvas', { width: 96, height: 96 });
            app.drawThumb(cv, def.kind);
            const b = h('button', { class: 'prop-btn' + (opts.propKind === def.kind ? ' on' : ''), title: def.name, type: 'button' }, cv, h('span', {}, def.name));
            b.addEventListener('click', () => {
              opts.propKind = def.kind;
              grid.querySelectorAll('.prop-btn').forEach((x) => x.classList.remove('on'));
              b.classList.add('on');
            });
            grid.append(b);
          }
          content.append(grid);
          if (cat === 'Toits')
            content.append(
              h('p', { class: 'help' }, 'Glisser pour couvrir une zone. Les toits passent au-dessus des jetons dans Foundry et s’effacent quand un jeton entre dessous. Touche K : voir à travers les toits.'),
              button('Couvrir chaque bâtiment d’un toit', () => {
                const kind = PROP_BY_KIND[opts.propKind]?.roof && opts.propKind.startsWith('roof') ? opts.propKind : 'roofThatch';
                app.edit();
                const n = autoRoofs(app.map, kind);
                app.changed(false);
                app.toast(n ? `${n} toit(s) ajouté(s).` : 'Aucun bâtiment sans toit sur ce niveau.', n ? 'ok' : 'info');
              }, 'small', 'Ajoute un toit sur chaque groupe de salles séparé (niveau courant), avec le matériau choisi'),
            );
        };
        fill();
        const tabs = segmented<string>(
          [...PROP_CATS.map((c) => [c, c] as [string, string]), [MINE, MINE]],
          cat,
          (v) => {
            cat = v;
            fill();
          },
        );
        tabs.classList.add('wrap');
        return section('Objets', [
          tabs,
          content,
          field(
            'Rotation',
            segmented<number>(
              [
                [0, '0°'],
                [90, '90°'],
                [180, '180°'],
                [270, '270°'],
              ],
              opts.propRot,
              (v) => (opts.propRot = v),
            ),
          ),
          checkbox('Visible MJ uniquement', opts.propGm, (v) => (opts.propGm = v), 'Absent de l’image joueurs ; exporté en tuile cachée dans Foundry'),
          checkbox('Poser en toit (au-dessus des jetons)', opts.propRoof, (v) => (opts.propRoof = v), 'Cimes d’arbres, auvents, ponts… : tuile Foundry au-dessus des jetons, qui s’efface quand un jeton passe dessous'),
          checkbox('Objet séparé (tuile Foundry)', opts.propTile, (v) => (opts.propTile = v), 'Déplaçable, masquable ou supprimable dans Foundry (coffre pillé, caisse…). Les coffres, tonneaux et caisses le sont déjà par défaut.'),
        ]);
      },
    };
    return tool;
  })();

  // --- Lumières
  const light = (() => {
    let drag: { id: string; moved: boolean } | null = null;
    const tool: Tool = {
      id: 'light',
      name: 'Lumière',
      key: 'l',
      icon: 'light',
      hint: 'Clic : poser une lumière · Glisser une lumière : la déplacer · Clic droit : supprimer · (aperçu de l’éclairage actif)',
      activate() {
        app.requestRender();
      },
      down(p) {
        const id = app.hitTest(p.wx, p.wy, ['light']);
        if (p.button === 2) {
          if (id) {
            app.edit();
            app.map.lights = app.map.lights.filter((l) => l.id !== id);
            app.selection.delete(id);
            app.changed(false);
          }
          return;
        }
        if (id) {
          app.selection.clear();
          app.selection.add(id);
          app.selectionChanged();
          drag = { id, moved: false };
          return;
        }
        app.edit();
        const x = p.alt ? p.wx : Math.round(p.wx * 2) / 2,
          y = p.alt ? p.wy : Math.round(p.wy * 2) / 2;
        const l = app.map.addLight({ x, y, radius: opts.lightRadius, color: opts.lightColor, intensity: opts.lightIntensity, anim: opts.lightAnim });
        app.selection.clear();
        app.selection.add(l.id);
        app.selectionChanged();
        app.changed(false);
      },
      move(p, dragging) {
        if (dragging && drag) {
          const l = app.map.lights.find((o) => o.id === drag!.id);
          if (!l) return;
          if (!drag.moved) {
            app.edit();
            drag.moved = true;
          }
          l.x = p.alt ? p.wx : Math.round(p.wx * 2) / 2;
          l.y = p.alt ? p.wy : Math.round(p.wy * 2) / 2;
          app.changed(false);
        }
      },
      up() {
        drag = null;
      },
      panel: () =>
        section('Nouvelle lumière', [
          field('Rayon', range(opts.lightRadius, 1, 20, 0.5, (v) => (opts.lightRadius = v), (v) => `${v} cases`)),
          field('Couleur', colorInput(opts.lightColor, (v) => (opts.lightColor = v))),
          field('Intensité', range(opts.lightIntensity, 0.1, 1, 0.05, (v) => (opts.lightIntensity = v), (v) => `${Math.round(v * 100)}%`)),
          field('Animation', select(LIGHT_ANIMS, opts.lightAnim, (v) => (opts.lightAnim = v))),
          h('div', { class: 'presets' }, [
            button('Torche', () => setPreset(6, '#ffb066', 0.8, 'torch'), 'small'),
            button('Bougie', () => setPreset(2.5, '#ffd28a', 0.6, 'flame'), 'small'),
            button('Magie', () => setPreset(5, '#8f7bff', 0.7, 'pulse'), 'small'),
            button('Lune', () => setPreset(10, '#bcd4ff', 0.5, 'none'), 'small'),
            button('Feu vert', () => setPreset(5, '#7dff8a', 0.7, 'ghost'), 'small'),
          ]),
        ]),
    };
    const setPreset = (r: number, c: string, i: number, a: LightAnim) => {
      Object.assign(opts, { lightRadius: r, lightColor: c, lightIntensity: i, lightAnim: a });
      app.renderPanel();
    };
    return tool;
  })();

  // --- Texte
  const text: Tool = {
    id: 'text',
    name: 'Texte',
    key: 't',
    icon: 'text',
    hint: 'Clic : ajouter un texte · Clic sur un texte : le modifier · Numérotation auto : un clic = un numéro',
    down(p) {
      if (p.button === 2) {
        const id = app.hitTest(p.wx, p.wy, ['label']);
        if (id) {
          app.edit();
          app.map.labels = app.map.labels.filter((l) => l.id !== id);
          app.changed(false);
        }
        return;
      }
      const id = app.hitTest(p.wx, p.wy, ['label']);
      if (id) {
        const l = app.map.labels.find((o) => o.id === id)!;
        app.textInput(p.sx, p.sy, l.text, (t) => {
          app.edit();
          if (t.trim()) l.text = t;
          else app.map.labels = app.map.labels.filter((o) => o.id !== id);
          app.changed(false);
        });
        return;
      }
      const x = p.alt ? p.wx : Math.round(p.wx * 2) / 2,
        y = p.alt ? p.wy : Math.round(p.wy * 2) / 2;
      if (opts.autoNumber) {
        app.edit();
        app.map.addLabel({ x, y, text: String(opts.nextNumber++), size: opts.labelSize, gmOnly: opts.labelGm });
        app.changed(false);
        app.renderPanel();
        return;
      }
      app.textInput(p.sx, p.sy, '', (t) => {
        if (!t.trim()) return;
        app.edit();
        app.map.addLabel({ x, y, text: t, size: opts.labelSize, gmOnly: opts.labelGm });
        app.changed(false);
      });
    },
    panel: () =>
      section('Texte', [
        field('Taille', range(opts.labelSize, 0.3, 3, 0.05, (v) => (opts.labelSize = v), (v) => `${v.toFixed(2)} case`)),
        checkbox('Visible MJ uniquement', opts.labelGm, (v) => (opts.labelGm = v), 'Absent de l’image joueurs ; exporté en dessin caché dans Foundry'),
        checkbox('Numérotation automatique', opts.autoNumber, (v) => (opts.autoNumber = v)),
        field(
          'Prochain n°',
          h('input', {
            type: 'number',
            class: 'num',
            value: String(opts.nextNumber),
            min: 0,
            onchange: (e: Event) => (opts.nextNumber = parseInt((e.target as HTMLInputElement).value, 10) || 1),
          }),
        ),
      ]),
  };

  const pan: Tool = {
    id: 'pan',
    name: 'Main',
    key: 'h',
    icon: 'pan',
    hint: 'Glisser : déplacer la vue (aussi : clic molette, ou Espace + glisser)',
  };

  return [sel, room, makeBrush(false), makeBrush(true), fill, terrain, wall, door, prop, light, text, pan];
}
