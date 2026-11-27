import { DungeonMap, LIGHT_ANIMS, Label, Light, Prop, SavedMap, T, WallStyle } from './model';
import { History } from './history';
import { Renderer } from './render';
import { COLOR_KEYS, ResolvedTheme, THEMES, resolveTheme } from './themes';
import { PInfo, Tool, ToolOpts, createTools, defaultToolOpts } from './tools';
import { PROP_BY_KIND, drawProp, hitProp, isTile } from './props';
import { button, checkbox, colorInput, field, h, icon, modal, numberInput, range, section, segmented, select, toast } from './ui';
import { clamp, downloadBlob, slugify, toHex, uid } from './util';
import { openGenerator } from './dialogs/generate';
import { openExport } from './dialogs/export';
import { generateDungeon, DEFAULT_DUNGEON } from './generators/dungeon';

const AUTOSAVE_KEY = 'eugea:autosave';
const LEGACY_AUTOSAVE_KEY = 'jdr-map-maker:autosave';
const BASE_SCALE = 32;

type Obj = Prop | Light | Label;

export class App {
  map: DungeonMap;
  history = new History();
  renderer = new Renderer();
  theme!: ResolvedTheme;
  opts: ToolOpts = defaultToolOpts();
  tools: Tool[];
  tool: Tool;
  selection = new Set<string>();
  hover: { wx: number; wy: number } | null = null;
  view = { scale: BASE_SCALE, ox: -2, oy: -2 };
  viewMode: 'editor' | 'player' = 'editor';
  lightingPreview = false;
  showGhost = true;
  private ghost: { id: string; map: DungeonMap } | null = null;
  private ghostRenderer = new Renderer();

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private stage: HTMLElement;
  private panelEl: HTMLElement;
  private statusEl: HTMLElement;
  private hintEl: HTMLElement;
  private nameInput: HTMLInputElement;
  private raf = 0;
  private pointer: { button: number; panning: boolean; lx: number; ly: number } | null = null;
  private spaceDown = false;
  private autosaveTimer = 0;
  private overlayTexts: [string, number, number][] = [];
  private sectionOpen: Record<string, boolean> = { Carte: false, Style: true };

  constructor() {
    this.canvas = document.getElementById('view') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.stage = document.getElementById('stage')!;
    this.panelEl = document.getElementById('panel')!;
    this.statusEl = document.getElementById('status')!;
    this.hintEl = document.getElementById('hint')!;
    this.nameInput = document.getElementById('mapName') as HTMLInputElement;

    this.map = this.loadAutosave() ?? this.demoMap();
    this.refreshTheme();
    this.tools = createTools(this);
    this.tool = this.tools[1];
    this.buildToolbar();
    this.bindTopbar();
    this.bindCanvas();
    this.bindKeys();
    this.bindDrop();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.resize();
    this.nameInput.value = this.map.name;
    this.fitView();
    this.selectTool('room');
    this.renderLevelBar();
  }

  // ---------- Carte ----------

  private demoMap(): DungeonMap {
    const m = generateDungeon({ ...DEFAULT_DUNGEON, seed: 'bienvenue-1', cols: 44, rows: 32, rooms: 9 });
    m.name = 'Ma première carte';
    return m;
  }

  /** Remplace le contenu de la carte (annulable). */
  loadMap(src: DungeonMap, keepStyle = false): void {
    this.edit();
    const m = this.map;
    const settings = keepStyle ? { ...src.settings, theme: m.settings.theme, colors: { ...m.settings.colors }, gridDistance: m.settings.gridDistance, gridUnits: m.settings.gridUnits, darkness: m.settings.darkness, showGrid: m.settings.showGrid } : src.settings;
    m.name = src.name;
    m.cols = src.cols;
    m.rows = src.rows;
    m.levels = src.levels;
    m.cur = src.cur;
    m.settings = settings;
    m.touchAll();
    this.afterStructureChange(true);
  }

  /**
   * Applique une carte générée. S'il y a plusieurs niveaux, seul le niveau courant est remplacé
   * (les autres sont redimensionnés au besoin pour rester superposables).
   */
  applyGenerated(gen: DungeonMap, keepStyle: boolean): void {
    if (this.map.levels.length <= 1) {
      this.loadMap(gen, keepStyle);
      return;
    }
    this.edit();
    const m = this.map;
    if (gen.cols !== m.cols || gen.rows !== m.rows) {
      const r = m.resized(gen.cols, gen.rows, 0, 0);
      m.cols = r.cols;
      m.rows = r.rows;
      m.levels = r.levels;
    }
    const cur = m.level;
    const src = gen.levels[0];
    Object.assign(cur, { cells: src.cells, hEdges: src.hEdges, vEdges: src.vEdges, ground: src.ground, props: src.props, lights: src.lights, labels: src.labels });
    m.settings.wallStyle = gen.settings.wallStyle;
    if (!keepStyle) m.settings = { ...gen.settings };
    m.touchAll();
    this.afterStructureChange(true);
  }

  private afterStructureChange(fit: boolean): void {
    this.selection.clear();
    this.ghost = null;
    this.nameInput.value = this.map.name;
    this.refreshTheme();
    if (fit) this.fitView();
    this.changed(true);
    this.renderPanel();
    this.renderLevelBar();
    this.updateStatus();
  }

  // ---------- Niveaux ----------

  switchLevel(i: number): void {
    if (i === this.map.cur) return;
    this.map.switchLevel(i);
    this.selection.clear();
    this.ghost = null;
    this.requestRender();
    this.renderPanel();
    this.renderLevelBar();
    this.updateStatus();
  }

  private addLevel(where: 'above' | 'below', copy: boolean): void {
    this.edit();
    this.map.addLevel(where, copy);
    this.afterStructureChange(false);
    toast(`Niveau « ${this.map.level.name} » ajouté.`, 'ok');
  }

  private removeLevel(): void {
    if (this.map.levels.length <= 1) return;
    if (!confirm(`Supprimer le niveau « ${this.map.level.name} » et tout son contenu ?`)) return;
    this.edit();
    this.map.removeLevel(this.map.cur);
    this.afterStructureChange(false);
  }

  /** Barre flottante de changement de niveau (affichée s'il y a plusieurs niveaux). */
  private renderLevelBar(): void {
    let bar = document.getElementById('levelbar');
    if (!bar) {
      bar = h('div', { id: 'levelbar' });
      this.stage.append(bar);
    }
    bar.innerHTML = '';
    const m = this.map;
    bar.style.display = m.levels.length > 1 ? 'flex' : 'none';
    for (let i = m.levels.length - 1; i >= 0; i--) {
      const l = m.levels[i];
      const b = button(l.name, () => this.switchLevel(i), i === m.cur ? 'on' : '', `Niveau ${l.z >= 0 ? '+' : ''}${l.z} (PageUp / PageDown)`);
      bar.append(b);
    }
  }

  private levelSection(): HTMLElement {
    const m = this.map;
    const list = h('div', { class: 'list' });
    for (let i = m.levels.length - 1; i >= 0; i--) {
      const l = m.levels[i];
      const item = h('button', { class: 'list-item' + (i === m.cur ? ' on' : ''), type: 'button', title: 'Double-clic : renommer' }, h('kbd', {}, `${l.z >= 0 ? '+' : ''}${l.z}`), l.name);
      item.addEventListener('click', () => this.switchLevel(i));
      item.addEventListener('dblclick', () => {
        const name = prompt('Nom du niveau', l.name);
        if (name && name.trim()) {
          this.edit();
          l.name = name.trim();
          this.changed(false);
          this.renderPanel();
          this.renderLevelBar();
        }
      });
      list.append(item);
    }
    return this.sec('Niveaux', [
      list,
      h(
        'div',
        { class: 'row-actions' },
        button('+ Au-dessus', () => this.addLevel('above', false), 'small', 'Nouvel étage vide au-dessus'),
        button('+ En dessous', () => this.addLevel('below', false), 'small', 'Nouveau sous-sol vide'),
        button('Dupliquer', () => this.addLevel('above', true), 'small', 'Copie du niveau courant, placée au-dessus'),
        m.levels.length > 1 ? button(icon('trash'), () => this.removeLevel(), 'icon danger', 'Supprimer le niveau courant') : null,
      ),
      checkbox('Voir le niveau inférieur en transparence', this.showGhost, (v) => {
        this.showGhost = v;
        this.requestRender();
      }),
      h('p', { class: 'help' }, 'Tous les niveaux partagent la même grille : un escalier placé au même endroit sur deux niveaux se superpose dans Foundry.'),
    ]);
  }

  edit(): void {
    this.history.push(this.map);
    this.updateUndo();
  }

  changed(_geometry = true): void {
    this.requestRender();
    this.updateUndo();
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.autosave(), 700);
  }

  undo(): void {
    if (this.history.undo(this.map)) this.afterHistory();
  }
  redo(): void {
    if (this.history.redo(this.map)) this.afterHistory();
  }
  private afterHistory(): void {
    this.afterStructureChange(false);
  }
  private updateUndo(): void {
    (document.querySelector('[data-cmd=undo]') as HTMLButtonElement).disabled = !this.history.canUndo;
    (document.querySelector('[data-cmd=redo]') as HTMLButtonElement).disabled = !this.history.canRedo;
  }

  private autosave(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.map.toJSON()));
    } catch {
      /* quota dépassé : on ignore */
    }
  }

  private loadAutosave(): DungeonMap | null {
    try {
      const s = localStorage.getItem(AUTOSAVE_KEY) ?? localStorage.getItem(LEGACY_AUTOSAVE_KEY);
      return s ? DungeonMap.fromJSON(JSON.parse(s)) : null;
    } catch {
      return null;
    }
  }

  refreshTheme(): void {
    this.theme = resolveTheme(this.map.settings.theme, this.map.settings.colors);
    this.requestRender();
  }

  toast(msg: string): void {
    toast(msg);
  }

  // ---------- Vue ----------

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.stage.clientWidth,
      hh = this.stage.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(hh * this.dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = hh + 'px';
    this.requestRender();
  }

  fitView(): void {
    const b = this.map.contentBounds() ?? { x0: 0, y0: 0, x1: this.map.cols, y1: this.map.rows };
    const w = this.stage.clientWidth || 800,
      hh = this.stage.clientHeight || 600;
    const bw = b.x1 - b.x0 + 2,
      bh = b.y1 - b.y0 + 2;
    const s = clamp(Math.min(w / bw, hh / bh), 4, 120);
    this.view.scale = s;
    this.view.ox = (b.x0 + b.x1) / 2 - w / s / 2;
    this.view.oy = (b.y0 + b.y1) / 2 - hh / s / 2;
    this.requestRender();
  }

  zoomAt(f: number, sx: number, sy: number): void {
    const v = this.view;
    const wx = v.ox + sx / v.scale,
      wy = v.oy + sy / v.scale;
    v.scale = clamp(v.scale * f, 3, 300);
    v.ox = wx - sx / v.scale;
    v.oy = wy - sy / v.scale;
    this.requestRender();
    this.updateStatus();
  }

  requestRender(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  private frame(): void {
    this.raf = 0;
    const { ctx } = this;
    const s = this.view.scale * this.dpr;
    const v = { scale: s, ox: this.view.ox, oy: this.view.oy };
    const lighting = this.lightingPreview || this.tool.id === 'light';
    this.renderer.render(ctx, this.map, this.theme, {
      view: v,
      width: this.canvas.width,
      height: this.canvas.height,
      mode: this.viewMode === 'player' ? 'player' : 'editor',
      grid: this.map.settings.showGrid,
      lighting,
      selection: this.selection,
    });
    if (this.viewMode === 'editor' && this.showGhost && this.map.cur > 0) {
      const below = this.map.levels[this.map.cur - 1];
      if (!this.ghost || this.ghost.id !== below.id) this.ghost = { id: below.id, map: this.map.levelView(this.map.cur - 1) };
      this.ghostRenderer.renderGhost(ctx, this.ghost.map, this.theme, v);
    }
    this.overlayTexts = [];
    ctx.save();
    ctx.setTransform(s, 0, 0, s, -v.ox * s, -v.oy * s);
    this.tool.overlay?.(ctx, 1 / s);
    ctx.restore();
    if (this.overlayTexts.length) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = `600 ${13 * this.dpr}px system-ui, sans-serif`;
      ctx.textBaseline = 'bottom';
      for (const [t, x, y] of this.overlayTexts) {
        const sx = (x - v.ox) * s,
          sy = (y - v.oy) * s;
        const w = ctx.measureText(t).width;
        ctx.fillStyle = 'rgba(10,12,18,0.85)';
        ctx.fillRect(sx - w - 10 * this.dpr, sy - 20 * this.dpr, w + 10 * this.dpr, 20 * this.dpr);
        ctx.fillStyle = '#fff';
        ctx.fillText(t, sx - w - 5 * this.dpr, sy - 3 * this.dpr);
      }
      ctx.restore();
    }
  }

  overlayText(text: string, wx: number, wy: number): void {
    this.overlayTexts.push([text, wx, wy]);
  }

  // ---------- Entrées ----------

  private pinfo(e: PointerEvent | MouseEvent): PInfo {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left,
      sy = e.clientY - r.top;
    const wx = this.view.ox + sx / this.view.scale,
      wy = this.view.oy + sy / this.view.scale;
    return {
      wx,
      wy,
      cx: Math.floor(wx),
      cy: Math.floor(wy),
      sx,
      sy,
      button: this.pointer?.button ?? e.button,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
    };
  }

  private bindCanvas(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.pointer) return;
      c.setPointerCapture(e.pointerId);
      const panning = e.button === 1 || (e.button === 0 && (this.spaceDown || this.tool.id === 'pan'));
      this.pointer = { button: e.button, panning, lx: e.clientX, ly: e.clientY };
      if (panning) {
        c.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      if (e.button === 0 || e.button === 2) this.tool.down?.(this.pinfo(e));
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pinfo(e);
      this.hover = { wx: p.wx, wy: p.wy };
      if (this.pointer?.panning) {
        this.view.ox -= (e.clientX - this.pointer.lx) / this.view.scale;
        this.view.oy -= (e.clientY - this.pointer.ly) / this.view.scale;
        this.pointer.lx = e.clientX;
        this.pointer.ly = e.clientY;
        this.requestRender();
        return;
      }
      this.tool.move?.(p, !!this.pointer);
      if (!this.pointer) this.requestRender();
      this.updateStatus();
    });
    const end = (e: PointerEvent) => {
      if (!this.pointer) return;
      const wasPan = this.pointer.panning;
      const p = this.pinfo(e);
      this.pointer = null;
      if (!wasPan) this.tool.up?.(p);
      this.updateCursor();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      if (!this.pointer) {
        this.hover = null;
        this.requestRender();
      }
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.tool.onWheel?.(e)) return;
        const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        const r = this.canvas.getBoundingClientRect();
        this.zoomAt(Math.exp(-d * 0.0015), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('.modal-back')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === ' ') {
        this.spaceDown = true;
        this.canvas.style.cursor = 'grab';
        e.preventDefault();
        return;
      }
      if (ctrl) {
        const map: Record<string, () => void> = {
          z: () => (e.shiftKey ? this.redo() : this.undo()),
          y: () => this.redo(),
          s: () => this.save(),
          o: () => this.openFile(),
          e: () => openExport(this),
          g: () => openGenerator(this),
          d: () => this.duplicateSelection(),
          a: () => this.selectAll(),
        };
        if (map[k]) {
          e.preventDefault();
          map[k]();
        }
        return;
      }
      if (this.tool.onKey?.(e)) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteSelection();
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        this.selection.clear();
        this.selectionChanged();
        return;
      }
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        this.switchLevel(Math.max(0, Math.min(this.map.levels.length - 1, this.map.cur + (e.key === 'PageUp' ? 1 : -1))));
        return;
      }
      const tool = this.tools.find((x) => x.key === k);
      if (tool) {
        this.selectTool(tool.id);
        return;
      }
      if (k === 'g') this.toggle('grid');
      else if (k === 'p') this.toggle('player');
      else if (k === 'i') this.toggle('light');
      else if (k === '0') this.fitView();
      else if (k === '+' || k === '=') this.zoomAt(1.25, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
      else if (k === '-') this.zoomAt(0.8, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
      else if (k === '?') this.help();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this.spaceDown = false;
        this.updateCursor();
      }
    });
  }

  private bindDrop(): void {
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) this.readFile(f);
    });
  }

  private updateCursor(): void {
    const c: Record<string, string> = { pan: 'grab', select: 'default', text: 'text' };
    this.canvas.style.cursor = this.spaceDown ? 'grab' : c[this.tool.id] ?? 'crosshair';
  }

  private updateStatus(): void {
    const hv = this.hover;
    const pos = hv ? `X ${Math.floor(hv.wx)} · Y ${Math.floor(hv.wy)}` : '—';
    const zoom = Math.round((this.view.scale / BASE_SCALE) * 100);
    const s = this.map.settings;
    this.statusEl.innerHTML = '';
    this.statusEl.append(
      h('span', {}, this.tool.name),
      h('span', {}, this.map.level.name),
      h('span', {}, pos),
      h('span', {}, `Zoom ${zoom}%`),
      h('span', {}, `${this.map.cols} × ${this.map.rows} cases (1 case = ${s.gridDistance} ${s.gridUnits})`),
      h('span', { class: 'grow' }),
      h('span', { class: 'muted' }, this.viewMode === 'player' ? 'Vue joueurs' : 'Vue éditeur'),
    );
  }

  // ---------- Outils & barre d'outils ----------

  private buildToolbar(): void {
    const tb = document.getElementById('toolbar')!;
    tb.innerHTML = '';
    for (const t of this.tools) {
      const b = h('button', { class: 'tool', 'data-tool': t.id, title: `${t.name} (${t.key.toUpperCase()})`, type: 'button' }, icon(t.icon), h('kbd', {}, t.key.toUpperCase()));
      b.addEventListener('click', () => this.selectTool(t.id));
      tb.append(b);
    }
  }

  selectTool(id: string): void {
    const t = this.tools.find((x) => x.id === id);
    if (!t) return;
    if (this.tool !== t) {
      this.tool.deactivate?.();
      this.tool = t;
      t.activate?.();
    }
    document.querySelectorAll('#toolbar .tool').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tool === id));
    this.hintEl.textContent = t.hint;
    this.updateCursor();
    this.renderPanel();
    this.updateStatus();
    this.requestRender();
  }

  private bindTopbar(): void {
    const cmds: Record<string, () => void> = {
      new: () => this.newMap(),
      open: () => this.openFile(),
      save: () => this.save(),
      undo: () => this.undo(),
      redo: () => this.redo(),
      generate: () => openGenerator(this),
      export: () => openExport(this),
      grid: () => this.toggle('grid'),
      player: () => this.toggle('player'),
      light: () => this.toggle('light'),
      fit: () => this.fitView(),
      help: () => this.help(),
    };
    document.querySelectorAll<HTMLElement>('[data-cmd]').forEach((b) => {
      const ico = b.dataset.icon;
      if (ico) b.prepend(icon(ico));
      b.addEventListener('click', () => cmds[b.dataset.cmd!]?.());
    });
    this.nameInput.addEventListener('change', () => {
      this.edit();
      this.map.name = this.nameInput.value.trim() || 'Carte';
      this.changed(false);
    });
    this.updateToggles();
  }

  private toggle(what: 'grid' | 'player' | 'light'): void {
    if (what === 'grid') {
      this.map.settings.showGrid = !this.map.settings.showGrid;
      this.changed(false);
    } else if (what === 'player') this.viewMode = this.viewMode === 'player' ? 'editor' : 'player';
    else this.lightingPreview = !this.lightingPreview;
    this.updateToggles();
    this.updateStatus();
    this.requestRender();
  }

  private updateToggles(): void {
    const set = (cmd: string, on: boolean) => document.querySelector(`[data-cmd=${cmd}]`)?.classList.toggle('on', on);
    set('grid', this.map.settings.showGrid);
    set('player', this.viewMode === 'player');
    set('light', this.lightingPreview);
  }

  // ---------- Sélection ----------

  hitTest(wx: number, wy: number, kinds: ('label' | 'light' | 'prop')[] = ['label', 'light', 'prop']): string | null {
    const m = this.map;
    if (kinds.includes('label')) {
      this.ctx.save();
      for (let i = m.labels.length - 1; i >= 0; i--) {
        const l = m.labels[i];
        this.ctx.font = `700 100px "Palatino Linotype", Georgia, serif`;
        const w = (this.ctx.measureText(l.text).width / 100) * l.size;
        if (Math.abs(wx - l.x) <= w / 2 + 0.1 && Math.abs(wy - l.y) <= l.size / 2 + 0.1) {
          this.ctx.restore();
          return l.id;
        }
      }
      this.ctx.restore();
    }
    if (kinds.includes('light')) {
      const r = Math.max(0.3, 11 / this.view.scale);
      for (let i = m.lights.length - 1; i >= 0; i--) if (Math.hypot(wx - m.lights[i].x, wy - m.lights[i].y) <= r) return m.lights[i].id;
    }
    if (kinds.includes('prop')) {
      const order = m.props.map((p, i) => [p, i] as [Prop, number]).sort((a, b) => (PROP_BY_KIND[b[0].kind]?.layer ?? 1) - (PROP_BY_KIND[a[0].kind]?.layer ?? 1) || b[1] - a[1]);
      for (const [p] of order) {
        if (this.viewMode === 'player' && p.gmOnly) continue;
        if (hitProp(p, wx, wy)) return p.id;
      }
    }
    return null;
  }

  selectedObjects(): Obj[] {
    const s = this.selection;
    return [...this.map.props.filter((o) => s.has(o.id)), ...this.map.lights.filter((o) => s.has(o.id)), ...this.map.labels.filter((o) => s.has(o.id))];
  }

  selectionChanged(): void {
    this.requestRender();
    this.renderPanel();
  }

  private selectAll(): void {
    this.selectTool('select');
    for (const o of [...this.map.props, ...this.map.lights, ...this.map.labels]) this.selection.add(o.id);
    this.selectionChanged();
  }

  rotateSelection(deg: number): void {
    const props = this.map.props.filter((p) => this.selection.has(p.id));
    if (!props.length) return;
    this.edit();
    for (const p of props) p.rot = (((p.rot + deg) % 360) + 360) % 360;
    this.changed(false);
    this.renderPanel();
  }

  deleteSelection(): void {
    if (!this.selection.size) return;
    this.edit();
    const s = this.selection;
    this.map.props = this.map.props.filter((o) => !s.has(o.id));
    this.map.lights = this.map.lights.filter((o) => !s.has(o.id));
    this.map.labels = this.map.labels.filter((o) => !s.has(o.id));
    s.clear();
    this.changed(false);
    this.renderPanel();
  }

  duplicateSelection(): void {
    if (!this.selection.size) return;
    this.edit();
    const s = this.selection;
    const ids: string[] = [];
    const dup = <T extends Obj>(arr: T[]) => {
      for (const o of arr.filter((x) => s.has(x.id))) {
        const c = { ...o, id: uid(), x: o.x + 1, y: o.y + 1 };
        arr.push(c);
        ids.push(c.id);
      }
    };
    dup(this.map.props);
    dup(this.map.lights);
    dup(this.map.labels);
    s.clear();
    ids.forEach((i) => s.add(i));
    this.changed(false);
    this.renderPanel();
  }

  // ---------- Saisie de texte sur la carte ----------

  textInput(sx: number, sy: number, initial: string, done: (t: string) => void): void {
    const input = h('input', { class: 'map-text-input', value: initial, style: { left: sx + 'px', top: sy + 'px' } });
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      input.remove();
      if (ok) done(input.value);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
    this.stage.append(input);
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  drawThumb(cv: HTMLCanvasElement, kind: string): void {
    const def = PROP_BY_KIND[kind];
    const ctx = cv.getContext('2d')!;
    const S = cv.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = this.theme.floor;
    ctx.fillRect(0, 0, S, S);
    const sc = (S / Math.max(def.w, def.h, 1)) * 0.86;
    ctx.setTransform(sc, 0, 0, sc, S / 2, S / 2);
    drawProp(ctx, { id: 'thumb-' + kind, kind, x: 0, y: 0, w: def.w, h: def.h, rot: 0, gmOnly: false }, this.theme.pal);
  }

  // ---------- Panneau latéral ----------

  private sec(title: string, body: (Node | null)[], extra?: HTMLElement): HTMLElement {
    const s = section(title, body, this.sectionOpen[title] ?? true, extra);
    s.addEventListener('toggle', () => (this.sectionOpen[title] = (s as HTMLDetailsElement).open));
    return s;
  }

  renderPanel(): void {
    const p = this.panelEl;
    const scroll = p.scrollTop;
    p.innerHTML = '';
    const tp = this.tool.panel?.();
    if (tp) p.append(tp);
    const ins = this.inspector();
    if (ins) p.append(ins);
    p.append(this.levelSection(), this.mapSection(), this.styleSection());
    p.scrollTop = scroll;
  }

  private inspector(): HTMLElement | null {
    const objs = this.selectedObjects();
    if (!objs.length) return null;
    let editing = false;
    const ed = () => {
      if (!editing) {
        this.edit();
        editing = true;
      }
    };
    const done = () => {
      editing = false;
      this.changed(false);
    };
    const actions = h(
      'div',
      { class: 'row-actions' },
      button(icon('copy'), () => this.duplicateSelection(), 'icon', 'Dupliquer (Ctrl+D)'),
      button(icon('trash'), () => this.deleteSelection(), 'icon danger', 'Supprimer (Suppr)'),
    );
    if (objs.length > 1) {
      const props = objs.filter((o): o is Prop => 'kind' in o);
      return this.sec('Sélection', [
        h('p', { class: 'help' }, `${objs.length} éléments sélectionnés`),
        props.length ? field('Pivoter', button(icon('rotL'), () => this.rotateSelection(-90), 'icon'), button(icon('rotR'), () => this.rotateSelection(90), 'icon')) : null,
        actions,
      ]);
    }
    const o = objs[0];
    if ('kind' in o) {
      const def = PROP_BY_KIND[o.kind];
      return this.sec('Objet : ' + (def?.name ?? o.kind), [
        field(
          'Rotation',
          button(icon('rotL'), () => this.rotateSelection(-90), 'icon', '-90°'),
          numberInput(o.rot, {
            min: 0,
            max: 359,
            step: 15,
            onChange: (v) => {
              ed();
              o.rot = v;
              done();
            },
          }),
          button(icon('rotR'), () => this.rotateSelection(90), 'icon', '+90°'),
        ),
        field(
          'Taille',
          numberInput(o.w, {
            min: 0.25,
            max: 20,
            step: 0.25,
            onChange: (v) => {
              ed();
              o.w = v;
              done();
            },
          }),
          h('span', { class: 'muted' }, '×'),
          numberInput(o.h, {
            min: 0.25,
            max: 20,
            step: 0.25,
            onChange: (v) => {
              ed();
              o.h = v;
              done();
            },
          }),
        ),
        checkbox('Visible MJ uniquement', o.gmOnly, (v) => {
          ed();
          o.gmOnly = v;
          done();
        }),
        checkbox(
          'Objet séparé (tuile Foundry)',
          isTile(o),
          (v) => {
            ed();
            o.tile = v;
            done();
          },
          'Exporté comme tuile indépendante : déplaçable, masquable ou supprimable dans Foundry (coffre pillé, caisse…)',
        ),
        def?.light
          ? checkbox('Émet de la lumière', !o.noLight, (v) => {
              ed();
              o.noLight = !v;
              done();
            })
          : null,
        actions,
      ]);
    }
    if ('radius' in o) {
      const l = o;
      return this.sec('Lumière', [
        field(
          'Rayon',
          range(l.radius, 1, 20, 0.5, (v) => {
            ed();
            l.radius = v;
            this.requestRender();
          }, (v) => `${v} cases`),
        ),
        field(
          'Couleur',
          colorInput(toHex(l.color), (v) => {
            ed();
            l.color = v;
            this.requestRender();
          }),
        ),
        field(
          'Intensité',
          range(l.intensity, 0.1, 1, 0.05, (v) => {
            ed();
            l.intensity = v;
            this.requestRender();
          }, (v) => `${Math.round(v * 100)}%`),
        ),
        field(
          'Animation',
          select(LIGHT_ANIMS, l.anim, (v) => {
            ed();
            l.anim = v;
            done();
          }),
        ),
        actions,
      ]);
    }
    const lb = o as Label;
    const ti = h('input', { type: 'text', value: lb.text, class: 'grow' });
    ti.addEventListener('input', () => {
      ed();
      lb.text = ti.value;
      this.requestRender();
    });
    ti.addEventListener('change', done);
    return this.sec('Texte', [
      field('Texte', ti),
      field(
        'Taille',
        range(lb.size, 0.3, 3, 0.05, (v) => {
          ed();
          lb.size = v;
          this.requestRender();
        }, (v) => v.toFixed(2)),
      ),
      field(
        'Couleur',
        colorInput(toHex(lb.color || this.theme.label), (v) => {
          ed();
          lb.color = v;
          this.requestRender();
        }),
        button('Défaut', () => {
          ed();
          delete lb.color;
          done();
          this.renderPanel();
        }, 'small'),
      ),
      checkbox('Visible MJ uniquement', lb.gmOnly, (v) => {
        ed();
        lb.gmOnly = v;
        done();
      }),
      actions,
    ]);
  }

  private mapSection(): HTMLElement {
    const m = this.map;
    const s = m.settings;
    let cols = m.cols,
      rows = m.rows,
      center = false;
    return this.sec('Carte', [
      field(
        'Taille',
        numberInput(m.cols, { min: 8, max: 300, onChange: (v) => (cols = v) }),
        h('span', { class: 'muted' }, '×'),
        numberInput(m.rows, { min: 8, max: 300, onChange: (v) => (rows = v) }),
      ),
      h(
        'div',
        { class: 'row-actions' },
        checkbox('Centrer', false, (v) => (center = v)),
        button('Redimensionner', () => {
          const dx = center ? Math.floor((cols - m.cols) / 2) : 0,
            dy = center ? Math.floor((rows - m.rows) / 2) : 0;
          this.loadMap(m.resized(cols, rows, dx, dy));
        }, 'small'),
        button('Rogner au contenu', () => {
          const b = m.contentBounds();
          if (!b) return;
          const mg = 2;
          this.loadMap(m.resized(b.x1 - b.x0 + mg * 2, b.y1 - b.y0 + mg * 2, mg - b.x0, mg - b.y0));
        }, 'small'),
      ),
      field(
        'Murs',
        segmented<WallStyle>(
          [
            ['straight', 'Droits'],
            ['rounded', 'Arrondis'],
            ['organic', 'Organiques'],
          ],
          s.wallStyle,
          (v) => {
            this.edit();
            s.wallStyle = v;
            this.changed(true);
          },
        ),
      ),
      field(
        '1 case =',
        numberInput(s.gridDistance, {
          min: 0.1,
          max: 1000,
          step: 0.5,
          onChange: (v) => {
            this.edit();
            s.gridDistance = v;
            this.changed(false);
            this.updateStatus();
          },
        }),
        select(
          [
            ['m', 'm'],
            ['ft', 'ft'],
            ['km', 'km'],
            ['mi', 'mi'],
          ],
          s.gridUnits as 'm',
          (v) => {
            this.edit();
            s.gridUnits = v;
            this.changed(false);
            this.updateStatus();
          },
        ),
      ),
      field(
        'Obscurité',
        range(s.darkness, 0, 1, 0.05, (v) => {
          s.darkness = v;
          this.changed(false);
        }, (v) => `${Math.round(v * 100)}%`),
      ),
      h('p', { class: 'help' }, 'Obscurité de la scène Foundry et de l’aperçu d’éclairage (touche I).'),
    ]);
  }

  private styleSection(): HTMLElement {
    const s = this.map.settings;
    const grid = h('div', { class: 'theme-grid' });
    for (const t of THEMES) {
      const card = h(
        'button',
        { class: 'theme-card' + (s.theme === t.id ? ' on' : ''), type: 'button', title: t.name },
        h(
          'span',
          { class: 'theme-prev', style: { background: t.bg } },
          h('span', { style: { background: t.floor, borderColor: t.wall } }),
        ),
        h('span', { class: 'theme-name' }, t.name),
      );
      card.addEventListener('click', () => {
        this.edit();
        s.theme = t.id;
        s.colors = {};
        this.refreshTheme();
        this.changed(false);
        this.renderPanel();
      });
      grid.append(card);
    }
    let editing = false;
    const colors = h(
      'div',
      { class: 'colors' },
      COLOR_KEYS.map(([k, label]) =>
        h(
          'label',
          { class: 'color-row' },
          colorInput(toHex(this.theme[k]), (v) => {
            if (!editing) {
              this.edit();
              editing = true;
            }
            s.colors[k] = v;
            this.refreshTheme();
            this.changed(false);
          }),
          h('span', {}, label),
        ),
      ),
    );
    return this.sec('Style', [
      grid,
      h('div', { class: 'sub' }, 'Couleurs personnalisées'),
      colors,
      button('Réinitialiser les couleurs', () => {
        this.edit();
        s.colors = {};
        this.refreshTheme();
        this.changed(false);
        this.renderPanel();
      }, 'small'),
    ]);
  }

  // ---------- Fichiers ----------

  save(): void {
    const blob = new Blob([JSON.stringify(this.map.toJSON())], { type: 'application/json' });
    downloadBlob(blob, `${slugify(this.map.name)}.eugea.json`);
    toast('Carte enregistrée.', 'ok');
  }

  openFile(): void {
    const input = h('input', { type: 'file', accept: '.json' });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) this.readFile(f);
    });
    input.click();
  }

  private readFile(f: File): void {
    f.text()
      .then((txt) => {
        const data = JSON.parse(txt) as SavedMap;
        this.loadMap(DungeonMap.fromJSON(data));
        toast(`« ${this.map.name} » ouverte.`, 'ok');
      })
      .catch((err) => toast('Impossible d’ouvrir ce fichier : ' + (err?.message ?? err), 'error'));
  }

  private newMap(): void {
    let cols = 40,
      rows = 30,
      outdoor = false;
    const cIn = numberInput(cols, { min: 8, max: 300, onChange: (v) => (cols = v) });
    const rIn = numberInput(rows, { min: 8, max: 300, onChange: (v) => (rows = v) });
    const presets: [string, number, number][] = [
      ['Petite', 24, 18],
      ['Moyenne', 40, 30],
      ['Grande', 70, 50],
      ['Immense', 120, 90],
    ];
    const body = h(
      'div',
      { class: 'form' },
      h(
        'div',
        { class: 'presets' },
        presets.map(([n, c, r]) =>
          button(`${n} (${c}×${r})`, () => {
            cols = c;
            rows = r;
            cIn.value = String(c);
            rIn.value = String(r);
          }, 'small'),
        ),
      ),
      field('Taille (cases)', cIn, h('span', { class: 'muted' }, '×'), rIn),
      field(
        'Type',
        segmented<string>(
          [
            ['in', 'Souterrain / intérieur'],
            ['out', 'Extérieur (herbe)'],
          ],
          'in',
          (v) => (outdoor = v === 'out'),
        ),
      ),
      h(
        'div',
        { class: 'modal-foot' },
        button('Générer aléatoirement…', () => {
          md.close();
          openGenerator(this, { cols, rows });
        }),
        button('Créer une carte vide', () => {
          md.close();
          const m = new DungeonMap(cols, rows);
          m.name = 'Nouvelle carte';
          if (outdoor) m.ground.fill(T.GRASS);
          m.settings = { ...structuredClone(this.map.settings), wallStyle: 'straight' };
          this.loadMap(m);
          this.view.scale = BASE_SCALE;
          this.view.ox = -2;
          this.view.oy = -2;
        }, 'primary'),
      ),
    );
    const md = modal('Nouvelle carte', body);
  }

  help(): void {
    const k = (keys: string, what: string) => h('tr', {}, h('td', {}, h('kbd', {}, keys)), h('td', {}, what));
    const body = h(
      'div',
      { class: 'help-body' },
      h(
        'div',
        { class: 'cols2' },
        h(
          'div',
          {},
          h('h3', {}, 'Outils'),
          h('table', {}, ...this.tools.map((t) => k(t.key.toUpperCase(), t.name))),
          h('h3', {}, 'Navigation'),
          h(
            'table',
            {},
            k('Molette', 'Zoom'),
            k('Clic molette / Espace', 'Déplacer la vue'),
            k('0', 'Recadrer sur la carte'),
            k('G', 'Afficher / masquer la grille'),
            k('P', 'Vue joueurs (cache les infos MJ)'),
            k('I', "Aperçu de l'éclairage"),
          ),
        ),
        h(
          'div',
          {},
          h('h3', {}, 'Édition'),
          h(
            'table',
            {},
            k('Ctrl+Z / Ctrl+Y', 'Annuler / rétablir'),
            k('Ctrl+S', 'Enregistrer la carte'),
            k('Ctrl+G', 'Générateur aléatoire'),
            k('Ctrl+E', 'Exporter'),
            k('Clic droit', 'Effacer (salle, pinceau, porte, objet)'),
            k('Q / Maj+molette', 'Pivoter objet'),
            k('Alt', 'Placement libre (sans grille)'),
            k('[ ]', 'Taille du pinceau'),
            k('Suppr', 'Supprimer la sélection'),
            k('Ctrl+D', 'Dupliquer'),
          ),
          h('h3', {}, 'Vers Foundry VTT'),
          h(
            'p',
            {},
            'Exporter → « Foundry VTT » : un seul fichier avec les images de chaque niveau, les murs, portes (normales, verrouillées, secrètes), fenêtres, lumières, objets séparés (tuiles) et notes MJ cachées. Dans Foundry, avec le module « Eugéa Importer » : onglet Scènes → bouton « Importer une carte Eugéa ». En V14 les étages deviennent des niveaux natifs ; avant, une scène par étage.',
          ),
        ),
      ),
    );
    modal('Aide', body, { wide: true });
  }
}
