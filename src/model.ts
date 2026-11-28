import { base64ToBytes, bytesToBase64, uid } from './util';

// ---------- Arêtes (murs, portes...) ----------
// Chaque arête de la grille porte un type. Entre une case de sol et une case sans sol,
// un mur est automatique (type NONE suffit). Entre deux cases de sol, il faut un type explicite.

export const EDGE = {
  NONE: 0,
  WALL: 1,
  DOOR: 2,
  LOCKED: 3,
  SECRET: 4,
  WINDOW: 5,
  BARS: 6,
} as const;

export const EDGE_NAMES: Record<number, string> = {
  1: 'Mur',
  2: 'Porte',
  3: 'Porte verrouillée',
  4: 'Porte secrète',
  5: 'Fenêtre',
  6: 'Herse / barreaux',
};

export function isDoorEdge(e: number): boolean {
  return e === EDGE.DOOR || e === EDGE.LOCKED || e === EDGE.SECRET;
}

// ---------- Terrains ----------
// Deux calques par niveau :
//  - cells  : le sol bâti (salles, couloirs, maisons). Les murs se créent autour.
//  - ground : le terrain extérieur (herbe, chemins, eau...), sous les bâtiments, sans murs.

export const T = {
  EMPTY: 0,
  STONE: 1,
  WOOD: 2,
  TILES: 3,
  DIRT: 4,
  GRASS: 5,
  WATER: 6,
  DEEP: 7,
  LAVA: 8,
  CARPET: 9,
  PIT: 10,
  CAVE: 11,
  FOREST: 12,
  ROAD: 13,
  SAND: 14,
  MUD: 15,
  FIELD: 16,
  SNOW: 17,
  PATH: 18,
  ROCKY: 19,
} as const;

export type Detail =
  | 'none'
  | 'planks'
  | 'tiles'
  | 'speckle'
  | 'grass'
  | 'ripples'
  | 'cracks'
  | 'weave'
  | 'pit'
  | 'rock'
  | 'leaves'
  | 'cobble'
  | 'rows'
  | 'snow'
  | 'pebbles';

export interface TerrainDef {
  id: number;
  name: string;
  base: string; // couleur canonique (teintée par le thème)
  smooth: boolean; // contour arrondi (flaques, herbe...)
  detail: Detail;
}

export const TERRAINS: TerrainDef[] = [
  { id: T.STONE, name: 'Dalle (sol)', base: '#ffffff', smooth: false, detail: 'none' },
  { id: T.WOOD, name: 'Plancher', base: '#a8743f', smooth: false, detail: 'planks' },
  { id: T.TILES, name: 'Carrelage', base: '#cfc8b8', smooth: false, detail: 'tiles' },
  { id: T.CARPET, name: 'Tapis', base: '#9c2f45', smooth: false, detail: 'weave' },
  { id: T.DIRT, name: 'Terre', base: '#8a6a43', smooth: true, detail: 'speckle' },
  { id: T.GRASS, name: 'Herbe', base: '#6c9a45', smooth: true, detail: 'grass' },
  { id: T.CAVE, name: 'Roche (grotte)', base: '#8d7a63', smooth: false, detail: 'rock' },
  { id: T.WATER, name: 'Eau', base: '#3d86c6', smooth: true, detail: 'ripples' },
  { id: T.DEEP, name: 'Eau profonde', base: '#1d4f8f', smooth: true, detail: 'ripples' },
  { id: T.LAVA, name: 'Lave', base: '#ff6a1a', smooth: true, detail: 'cracks' },
  { id: T.PIT, name: 'Gouffre', base: '#0d0d10', smooth: true, detail: 'pit' },
  { id: T.FOREST, name: 'Sous-bois', base: '#556f36', smooth: true, detail: 'leaves' },
  { id: T.PATH, name: 'Chemin', base: '#b39260', smooth: true, detail: 'speckle' },
  { id: T.ROAD, name: 'Pavés', base: '#9d978c', smooth: true, detail: 'cobble' },
  { id: T.SAND, name: 'Sable', base: '#dcc68e', smooth: true, detail: 'speckle' },
  { id: T.MUD, name: 'Boue', base: '#6b5233', smooth: true, detail: 'speckle' },
  { id: T.FIELD, name: 'Champ', base: '#9b7b45', smooth: false, detail: 'rows' },
  { id: T.SNOW, name: 'Neige', base: '#eef3f7', smooth: true, detail: 'snow' },
  { id: T.ROCKY, name: 'Rocaille', base: '#8f8a80', smooth: true, detail: 'pebbles' },
];

export const TERRAIN_BY_ID: Record<number, TerrainDef> = Object.fromEntries(TERRAINS.map((t) => [t.id, t]));

/** Sols proposés pour les salles / bâtiments. */
export const FLOOR_TERRAINS = [T.STONE, T.WOOD, T.TILES, T.CARPET, T.DIRT, T.GRASS, T.CAVE, T.WATER, T.DEEP, T.LAVA, T.PIT].map((i) => TERRAIN_BY_ID[i]);
/** Terrains extérieurs. */
export const GROUND_TERRAINS = [T.GRASS, T.FOREST, T.FIELD, T.PATH, T.DIRT, T.ROAD, T.SAND, T.MUD, T.ROCKY, T.SNOW, T.WATER, T.DEEP, T.LAVA].map(
  (i) => TERRAIN_BY_ID[i],
);

// ---------- Objets, lumières, étiquettes ----------

export interface Prop {
  id: string;
  kind: string;
  x: number; // centre, en cases
  y: number;
  w: number; // taille avant rotation, en cases
  h: number;
  rot: number; // degrés (sens horaire à l'écran)
  gmOnly: boolean; // invisible dans l'image joueurs
  noLight?: boolean; // désactive la lumière émise par l'objet (brasero, torche...)
  tile?: boolean; // exporté comme tuile séparée dans Foundry (défaut : selon le type d'objet)
  roof?: boolean; // « toit » : au-dessus des jetons, s'efface quand un jeton passe dessous (défaut : selon le type)
  asset?: string; // image personnelle (objets de type « image »)
}

export type LightAnim = 'none' | 'torch' | 'flame' | 'pulse' | 'fog' | 'ghost' | 'fairy' | 'energy';

export const LIGHT_ANIMS: [LightAnim, string][] = [
  ['none', 'Aucune'],
  ['torch', 'Torche'],
  ['flame', 'Flamme'],
  ['pulse', 'Pulsation'],
  ['fog', 'Brume'],
  ['ghost', 'Spectral'],
  ['fairy', 'Féerique'],
  ['energy', 'Énergie'],
];

export interface Light {
  id: string;
  x: number;
  y: number;
  radius: number; // en cases (lumière faible) ; lumière vive = moitié
  color: string;
  intensity: number; // 0..1
  anim: LightAnim;
}

export interface Label {
  id: string;
  x: number;
  y: number;
  text: string;
  size: number; // hauteur en cases
  gmOnly: boolean;
  color?: string;
}

export type WallStyle = 'straight' | 'rounded' | 'organic';

export type RampartStyle = 'stone' | 'palisade';

/**
 * Rempart / muraille : ligne brisée épaisse (pierre crénelée ou palissade), avec tours aux angles.
 * `x, y` : point d'ancrage (déplacé par la sélection) ; `pts` : sommets relatifs à l'ancrage.
 */
export interface Rampart {
  id: string;
  x: number;
  y: number;
  pts: number[];
  closed: boolean;
  width: number; // épaisseur en cases
  style: RampartStyle;
  towers: boolean;
  /** Créneaux de l'autre côté (lignes ouvertes). */
  flip?: boolean;
  /** Ligne ouverte : tour au début / à la fin (défaut : oui ; non contre une porte). */
  ends?: [boolean, boolean];
}

/** Extrémité d'un passage : un niveau et le centre de la zone (en cases). */
export interface PassageEnd {
  level: string;
  x: number;
  y: number;
}

/** Passage (téléportation) entre deux points, sur le même niveau ou deux niveaux différents. */
export interface Passage {
  id: string;
  name: string;
  a: PassageEnd;
  b: PassageEnd;
  size: number; // côté de la zone, en cases
  /** Sens unique : de a vers b seulement. */
  oneWay?: boolean;
}

export type HatchSetting = 'auto' | 'clusters' | 'lines' | 'dots' | 'none';

export interface MapSettings {
  theme: string;
  colors: Record<string, string>; // surcharges de couleurs du thème
  wallStyle: WallStyle;
  gridDistance: number;
  gridUnits: string;
  showGrid: boolean;
  darkness: number; // 0..1 (Foundry + aperçu)
  /** Images personnelles dessinées à la place d'un objet intégré (type -> variantes). */
  skins: Record<string, string[]>;
  /** Effets autour des murs (hachures dans le vide, ombre intérieure). */
  wallFx: boolean;
  /** Style des hachures (« auto » : celui du thème). */
  hatch: HatchSetting;
  /** Ombres portées des objets. */
  shadows: boolean;
  /** Vignette (bords assombris) 0..1, dans l'image exportée aussi. */
  vignette: number;
}

export function defaultSettings(): MapSettings {
  return {
    theme: 'parchemin',
    colors: {},
    wallStyle: 'straight',
    gridDistance: 1.5,
    gridUnits: 'm',
    showGrid: true,
    darkness: 0.6,
    skins: {},
    wallFx: true,
    hatch: 'auto',
    shadows: true,
    vignette: 0,
  };
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number; // exclusif
  y1: number;
}

// ---------- Niveaux (étages) ----------

export function levelName(z: number): string {
  return z === 0 ? 'Rez-de-chaussée' : z > 0 ? `Étage ${z}` : `Sous-sol ${-z}`;
}

export class Level {
  id: string;
  name: string;
  z: number; // 0 = rez-de-chaussée, 1 = premier étage, -1 = sous-sol...
  cells: Uint8Array;
  /** Arête horizontale au-dessus de la case (x, y) ; y ∈ [0, rows]. index = y * cols + x */
  hEdges: Uint8Array;
  /** Arête verticale à gauche de la case (x, y) ; x ∈ [0, cols]. index = y * (cols + 1) + x */
  vEdges: Uint8Array;
  ground: Uint8Array;
  props: Prop[] = [];
  lights: Light[] = [];
  labels: Label[] = [];
  ramparts: Rampart[] = [];

  constructor(cols: number, rows: number, z = 0, name = levelName(z), id = uid()) {
    this.id = id;
    this.z = z;
    this.name = name;
    this.cells = new Uint8Array(cols * rows);
    this.hEdges = new Uint8Array(cols * (rows + 1));
    this.vEdges = new Uint8Array((cols + 1) * rows);
    this.ground = new Uint8Array(cols * rows);
  }

  /** Copie profonde (même identifiant, pour l'historique). */
  clone(): Level {
    const l = Object.create(Level.prototype) as Level;
    l.id = this.id;
    l.name = this.name;
    l.z = this.z;
    l.cells = this.cells.slice();
    l.hEdges = this.hEdges.slice();
    l.vEdges = this.vEdges.slice();
    l.ground = this.ground.slice();
    l.props = this.props.map((p) => ({ ...p }));
    l.lights = this.lights.map((o) => ({ ...o }));
    l.labels = this.labels.map((o) => ({ ...o }));
    l.ramparts = this.ramparts.map((o) => ({ ...o, pts: o.pts.slice() }));
    return l;
  }
}

// ---------- Carte (document : niveaux + réglages) ----------

export class DungeonMap {
  name = 'Nouvelle carte';
  cols: number;
  rows: number;
  levels: Level[];
  /** Index du niveau courant (les niveaux sont triés par z croissant). */
  cur = 0;
  settings: MapSettings = defaultSettings();
  /** Passages entre deux points (escaliers éloignés, portails, trappes...), tous niveaux. */
  passages: Passage[] = [];

  /** Incrémenté à chaque modification des cases/arêtes (invalide la géométrie). */
  version = 0;
  /** Zone modifiée depuis la dernière reconstruction (pour les hachures par blocs). */
  dirty: Rect | null = null;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.levels = [new Level(cols, rows)];
  }

  // Accès au niveau courant : tout le code d'édition et de rendu passe par ici.
  get level(): Level {
    return this.levels[this.cur];
  }
  get cells(): Uint8Array {
    return this.level.cells;
  }
  set cells(v: Uint8Array) {
    this.level.cells = v;
  }
  get hEdges(): Uint8Array {
    return this.level.hEdges;
  }
  set hEdges(v: Uint8Array) {
    this.level.hEdges = v;
  }
  get vEdges(): Uint8Array {
    return this.level.vEdges;
  }
  set vEdges(v: Uint8Array) {
    this.level.vEdges = v;
  }
  get ground(): Uint8Array {
    return this.level.ground;
  }
  set ground(v: Uint8Array) {
    this.level.ground = v;
  }
  get props(): Prop[] {
    return this.level.props;
  }
  set props(v: Prop[]) {
    this.level.props = v;
  }
  get lights(): Light[] {
    return this.level.lights;
  }
  set lights(v: Light[]) {
    this.level.lights = v;
  }
  get labels(): Label[] {
    return this.level.labels;
  }
  set labels(v: Label[]) {
    this.level.labels = v;
  }
  get ramparts(): Rampart[] {
    return this.level.ramparts;
  }
  set ramparts(v: Rampart[]) {
    this.level.ramparts = v;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return 0;
    return this.cells[y * this.cols + x];
  }

  set(x: number, y: number, v: number): boolean {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return false;
    const i = y * this.cols + x;
    if (this.cells[i] === v) return false;
    this.cells[i] = v;
    this.touch(x, y, x + 1, y + 1);
    return true;
  }

  getGround(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return 0;
    return this.ground[y * this.cols + x];
  }

  setGround(x: number, y: number, v: number): boolean {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return false;
    const i = y * this.cols + x;
    if (this.ground[i] === v) return false;
    this.ground[i] = v;
    this.touch(x, y, x + 1, y + 1);
    return true;
  }

  hEdge(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.cols || y > this.rows) return 0;
    return this.hEdges[y * this.cols + x];
  }

  vEdge(x: number, y: number): number {
    if (x < 0 || y < 0 || x > this.cols || y >= this.rows) return 0;
    return this.vEdges[y * (this.cols + 1) + x];
  }

  setHEdge(x: number, y: number, v: number): boolean {
    if (x < 0 || y < 0 || x >= this.cols || y > this.rows) return false;
    const i = y * this.cols + x;
    if (this.hEdges[i] === v) return false;
    this.hEdges[i] = v;
    this.touch(x, y - 1, x + 1, y + 1);
    return true;
  }

  setVEdge(x: number, y: number, v: number): boolean {
    if (x < 0 || y < 0 || x > this.cols || y >= this.rows) return false;
    const i = y * (this.cols + 1) + x;
    if (this.vEdges[i] === v) return false;
    this.vEdges[i] = v;
    this.touch(x - 1, y, x + 1, y + 1);
    return true;
  }

  touch(x0: number, y0: number, x1: number, y1: number): void {
    this.version++;
    if (!this.dirty) this.dirty = { x0, y0, x1, y1 };
    else {
      const d = this.dirty;
      d.x0 = Math.min(d.x0, x0);
      d.y0 = Math.min(d.y0, y0);
      d.x1 = Math.max(d.x1, x1);
      d.y1 = Math.max(d.y1, y1);
    }
  }

  touchAll(): void {
    this.touch(0, 0, this.cols, this.rows);
  }

  hasGround(): boolean {
    return this.levels.some((l) => l.ground.some((v) => v !== 0));
  }

  // ---------- Niveaux ----------

  switchLevel(i: number): void {
    if (i < 0 || i >= this.levels.length || i === this.cur) return;
    this.cur = i;
    this.touchAll();
  }

  /** Ajoute un niveau au-dessus / en dessous du courant (vide ou copie) ; renvoie son index. */
  addLevel(where: 'above' | 'below', copy = false): number {
    const zs = this.levels.map((l) => l.z);
    const z = where === 'above' ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
    let lvl: Level;
    if (copy) {
      lvl = this.level.clone();
      lvl.id = uid();
      lvl.z = z;
      lvl.name = levelName(z);
      lvl.props = lvl.props.map((p) => ({ ...p, id: uid() }));
      lvl.lights = lvl.lights.map((p) => ({ ...p, id: uid() }));
      lvl.labels = lvl.labels.map((p) => ({ ...p, id: uid() }));
      lvl.ramparts = lvl.ramparts.map((p) => ({ ...p, id: uid() }));
    } else lvl = new Level(this.cols, this.rows, z);
    this.levels.push(lvl);
    this.levels.sort((a, b) => a.z - b.z);
    this.cur = this.levels.indexOf(lvl);
    this.touchAll();
    return this.cur;
  }

  removeLevel(i: number): void {
    if (this.levels.length <= 1) return;
    const gone = this.levels[i].id;
    this.passages = this.passages.filter((p) => p.a.level !== gone && p.b.level !== gone);
    this.levels.splice(i, 1);
    this.cur = Math.max(0, Math.min(this.cur >= i ? this.cur - 1 : this.cur, this.levels.length - 1));
    this.touchAll();
  }

  /** Carte "vue" sur un seul niveau (partage les données ; pour le rendu et l'export). */
  levelView(i: number): DungeonMap {
    const m = new DungeonMap(1, 1);
    m.cols = this.cols;
    m.rows = this.rows;
    m.name = this.name;
    m.levels = [this.levels[i]];
    m.settings = this.settings;
    m.touchAll();
    return m;
  }

  /** Rectangle englobant le contenu du niveau courant (ou de tous), ou null si vide. */
  contentBounds(all = false): Rect | null {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    const levels = all ? this.levels : [this.level];
    for (const lv of levels) {
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          const i = y * this.cols + x;
          if (lv.cells[i] || lv.ground[i]) {
            if (x < x0) x0 = x;
            if (x + 1 > x1) x1 = x + 1;
            if (y < y0) y0 = y;
            if (y + 1 > y1) y1 = y + 1;
          }
        }
      }
      for (const p of lv.props) {
        const r = Math.max(p.w, p.h) / 2;
        x0 = Math.min(x0, Math.floor(p.x - r));
        y0 = Math.min(y0, Math.floor(p.y - r));
        x1 = Math.max(x1, Math.ceil(p.x + r));
        y1 = Math.max(y1, Math.ceil(p.y + r));
      }
      for (const r of lv.ramparts) {
        const m = r.width / 2 + (r.towers ? r.width : 0.5);
        for (let i = 0; i < r.pts.length; i += 2) {
          x0 = Math.min(x0, Math.floor(r.x + r.pts[i] - m));
          y0 = Math.min(y0, Math.floor(r.y + r.pts[i + 1] - m));
          x1 = Math.max(x1, Math.ceil(r.x + r.pts[i] + m));
          y1 = Math.max(y1, Math.ceil(r.y + r.pts[i + 1] + m));
        }
      }
      for (const l of lv.labels) {
        const hw = Math.max(0.5, l.text.length * l.size * 0.32),
          hh = l.size * 0.6;
        x0 = Math.min(x0, Math.floor(l.x - hw));
        y0 = Math.min(y0, Math.floor(l.y - hh));
        x1 = Math.max(x1, Math.ceil(l.x + hw));
        y1 = Math.max(y1, Math.ceil(l.y + hh));
      }
    }
    if (!isFinite(x0)) return null;
    return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(this.cols, x1), y1: Math.min(this.rows, y1) };
  }

  /** Nouvelle carte redimensionnée (tous les niveaux) ; le contenu est décalé de (dx, dy). */
  resized(cols: number, rows: number, dx: number, dy: number): DungeonMap {
    const m = new DungeonMap(cols, rows);
    m.name = this.name;
    m.settings = structuredClone(this.settings);
    m.cur = this.cur;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x <= cols && y <= rows;
    m.levels = this.levels.map((src) => {
      const l = new Level(cols, rows, src.z, src.name, src.id);
      const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;
      for (let y = 0; y < this.rows; y++)
        for (let x = 0; x < this.cols; x++) {
          const i = y * this.cols + x;
          const nx = x + dx,
            ny = y + dy;
          if (!ok(nx, ny)) continue;
          l.cells[ny * cols + nx] = src.cells[i];
          l.ground[ny * cols + nx] = src.ground[i];
        }
      for (let y = 0; y <= this.rows; y++)
        for (let x = 0; x < this.cols; x++) {
          const v = src.hEdges[y * this.cols + x];
          const nx = x + dx,
            ny = y + dy;
          if (v && nx >= 0 && nx < cols && ny >= 0 && ny <= rows) l.hEdges[ny * cols + nx] = v;
        }
      for (let y = 0; y < this.rows; y++)
        for (let x = 0; x <= this.cols; x++) {
          const v = src.vEdges[y * (this.cols + 1) + x];
          const nx = x + dx,
            ny = y + dy;
          if (v && nx >= 0 && nx <= cols && ny >= 0 && ny < rows) l.vEdges[ny * (cols + 1) + nx] = v;
        }
      l.props = src.props.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })).filter((p) => inside(p.x, p.y));
      l.lights = src.lights.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })).filter((o) => inside(o.x, o.y));
      l.labels = src.labels.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })).filter((o) => inside(o.x, o.y));
      l.ramparts = src.ramparts.map((o) => ({ ...o, pts: o.pts.slice(), x: o.x + dx, y: o.y + dy }));
      return l;
    });
    m.passages = this.passages.map((p) => ({ ...p, a: { ...p.a, x: p.a.x + dx, y: p.a.y + dy }, b: { ...p.b, x: p.b.x + dx, y: p.b.y + dy } }));
    m.touchAll();
    return m;
  }

  addProp(p: Omit<Prop, 'id'> & { id?: string }): Prop {
    const prop: Prop = { id: p.id ?? uid(), ...p } as Prop;
    this.props.push(prop);
    return prop;
  }

  addLight(l: Omit<Light, 'id'>): Light {
    const light: Light = { id: uid(), ...l };
    this.lights.push(light);
    return light;
  }

  addLabel(l: Omit<Label, 'id'>): Label {
    const label: Label = { id: uid(), ...l };
    this.labels.push(label);
    return label;
  }

  // ---------- Sérialisation ----------

  toJSON(): SavedMap {
    return {
      format: 'eugea-map',
      version: 2,
      name: this.name,
      cols: this.cols,
      rows: this.rows,
      current: this.cur,
      settings: this.settings,
      levels: this.levels.map((l) => ({
        id: l.id,
        name: l.name,
        z: l.z,
        cells: bytesToBase64(l.cells),
        hEdges: bytesToBase64(l.hEdges),
        vEdges: bytesToBase64(l.vEdges),
        ground: bytesToBase64(l.ground),
        props: l.props,
        lights: l.lights,
        labels: l.labels,
        ramparts: l.ramparts,
      })),
      passages: this.passages,
    };
  }

  static fromJSON(d: SavedMap | SavedMapV1): DungeonMap {
    if (!d || (d.format !== 'eugea-map' && d.format !== 'jdr-map-maker')) throw new Error("Ce fichier n'est pas une carte Eugéa.");
    const m = new DungeonMap(d.cols, d.rows);
    m.name = d.name || 'Carte';
    m.settings = { ...defaultSettings(), ...(d.settings || {}) };
    if (!m.settings.skins || typeof m.settings.skins !== 'object') m.settings.skins = {};
    const fill = (target: Uint8Array, b64: string | undefined, what: string) => {
      if (!b64) return;
      const bytes = base64ToBytes(b64);
      if (bytes.length !== target.length) throw new Error(`Fichier de carte corrompu (${what}).`);
      target.set(bytes);
    };
    const srcLevels: SavedLevel[] =
      d.format === 'jdr-map-maker'
        ? [{ id: uid(), name: levelName(0), z: 0, cells: d.cells, hEdges: d.hEdges, vEdges: d.vEdges, props: d.props, lights: d.lights, labels: d.labels }]
        : d.levels;
    m.levels = srcLevels.map((s) => {
      const l = new Level(d.cols, d.rows, s.z ?? 0, s.name, s.id || uid());
      fill(l.cells, s.cells, 'sol');
      fill(l.hEdges, s.hEdges, 'murs');
      fill(l.vEdges, s.vEdges, 'murs');
      fill(l.ground, s.ground, 'terrain');
      l.props = s.props || [];
      l.lights = s.lights || [];
      l.labels = s.labels || [];
      l.ramparts = s.ramparts || [];
      return l;
    });
    if (!m.levels.length) m.levels = [new Level(d.cols, d.rows)];
    m.levels.sort((a, b) => a.z - b.z);
    m.cur = d.format === 'eugea-map' ? Math.max(0, Math.min(m.levels.length - 1, d.current ?? 0)) : 0;
    const ids = new Set(m.levels.map((l) => l.id));
    m.passages = (d.format === 'eugea-map' ? d.passages ?? [] : []).filter((p) => ids.has(p.a?.level) && ids.has(p.b?.level));
    m.touchAll();
    return m;
  }

  /** Identifiants des images personnelles utilisées (objets et habillages). */
  usedAssets(): string[] {
    const ids = new Set<string>();
    for (const l of this.levels) for (const p of l.props) if (p.asset) ids.add(p.asset);
    for (const list of Object.values(this.settings.skins || {})) for (const id of list) ids.add(id);
    return [...ids];
  }

  /** Copie complète. */
  clone(): DungeonMap {
    const m = new DungeonMap(1, 1);
    m.cols = this.cols;
    m.rows = this.rows;
    m.name = this.name;
    m.cur = this.cur;
    m.levels = this.levels.map((l) => l.clone());
    m.settings = structuredClone(this.settings);
    m.touchAll();
    return m;
  }
}

export interface SavedLevel {
  id: string;
  name: string;
  z: number;
  cells: string;
  hEdges: string;
  vEdges: string;
  ground?: string;
  props: Prop[];
  lights: Light[];
  labels: Label[];
  ramparts?: Rampart[];
}

export interface SavedMap {
  format: 'eugea-map';
  version: number;
  name: string;
  cols: number;
  rows: number;
  current: number;
  settings: MapSettings;
  levels: SavedLevel[];
  passages?: Passage[];
  /** Images personnelles intégrées au fichier (absentes de la sauvegarde automatique). */
  assets?: Record<string, SavedAsset>;
}

export interface SavedAsset {
  name: string;
  mime: string;
  data: string; // base64
}

/** Ancien format v1 (un seul niveau), toujours lisible. */
export interface SavedMapV1 {
  format: 'jdr-map-maker';
  version: number;
  name: string;
  cols: number;
  rows: number;
  cells: string;
  hEdges: string;
  vEdges: string;
  props: Prop[];
  lights: Light[];
  labels: Label[];
  settings: MapSettings;
}
