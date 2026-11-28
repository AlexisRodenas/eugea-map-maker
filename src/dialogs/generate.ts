import type { App } from '../app';
import { DungeonMap } from '../model';
import { Renderer } from '../render';
import { DEFAULT_DUNGEON, DungeonParams, generateDungeon } from '../generators/dungeon';
import { CaveParams, DEFAULT_CAVE, generateCave } from '../generators/cave';
import { DEFAULT_MAZE, MazeParams, generateMaze } from '../generators/maze';
import { DEFAULT_FOREST, ForestParams, generateForest } from '../generators/forest';
import { DEFAULT_VILLAGE, VillageParams, generateVillage } from '../generators/village';
import { CityParams, DEFAULT_CITY, generateCity } from '../generators/city';
import { DEFAULT_WORLD, WorldParams, generateWorld } from '../generators/world';
import { FLAVORS } from '../generators/dressing';
import { PROP_BY_KIND } from '../props';
import { mapTheme } from '../themes';
import { button, checkbox, field, h, modal, range, segmented, select, toast } from '../ui';
import { randomSeed } from '../util';

type Kind = 'dungeon' | 'cave' | 'maze' | 'forest' | 'village' | 'city' | 'world';

/** Thème conseillé par type de carte (null : garder le thème actuel). */
const SUGGESTED_THEME: Record<Kind, string | null> = { dungeon: null, maze: null, cave: 'caverne', forest: 'pleinair', village: 'pleinair', city: 'pleinair', world: 'parchemin' };

/** Plans (ville, monde) : leur échelle et leur affichage priment sur ceux de la carte actuelle. */
const PLAN: Kind[] = ['city', 'world'];

type Spec =
  | { key: string; label: string; type: 'int'; min: number; max: number; step?: number }
  | { key: string; label: string; type: 'pct' }
  | { key: string; label: string; type: 'float'; min: number; max: number; step: number }
  | { key: string; label: string; type: 'bool' }
  | { key: string; label: string; type: 'select'; options: [string, string][] };

const SIZE: Spec[] = [
  { key: 'cols', label: 'Largeur', type: 'int', min: 16, max: 160 },
  { key: 'rows', label: 'Hauteur', type: 'int', min: 12, max: 120 },
];

const SPECS: Record<Kind, Spec[]> = {
  dungeon: [
    ...SIZE,
    {
      key: 'layout',
      label: 'Disposition',
      type: 'select',
      options: [
        ['scatter', 'Salles dispersées'],
        ['bsp', 'Compacte (BSP)'],
      ],
    },
    { key: 'flavor', label: 'Ambiance', type: 'select', options: FLAVORS },
    { key: 'rooms', label: 'Salles', type: 'int', min: 2, max: 60 },
    { key: 'roomMin', label: 'Taille min.', type: 'int', min: 3, max: 12 },
    { key: 'roomMax', label: 'Taille max.', type: 'int', min: 4, max: 20 },
    { key: 'corridorWidth', label: 'Largeur couloirs', type: 'int', min: 1, max: 3 },
    { key: 'loops', label: 'Boucles', type: 'pct' },
    { key: 'roundRooms', label: 'Salles rondes', type: 'pct' },
    { key: 'doors', label: 'Portes', type: 'pct' },
    { key: 'secret', label: 'Portes secrètes', type: 'pct' },
    { key: 'water', label: 'Eau', type: 'pct' },
    { key: 'props', label: 'Mobilier', type: 'pct' },
    { key: 'lights', label: 'Éclairage', type: 'pct' },
    { key: 'numbers', label: 'Numéroter les salles (MJ)', type: 'bool' },
    { key: 'levels', label: 'Niveaux (sous-sols reliés)', type: 'int', min: 1, max: 4 },
  ],
  cave: [
    ...SIZE,
    { key: 'fill', label: 'Densité de roche', type: 'float', min: 0.38, max: 0.58, step: 0.01 },
    { key: 'smooth', label: 'Lissage', type: 'int', min: 1, max: 8 },
    { key: 'connect', label: 'Relier les poches isolées', type: 'bool' },
    { key: 'water', label: 'Eau', type: 'pct' },
    { key: 'lava', label: 'Lave', type: 'pct' },
    { key: 'props', label: 'Décor', type: 'pct' },
    { key: 'lights', label: 'Éclairage', type: 'pct' },
  ],
  maze: [
    ...SIZE,
    { key: 'corridor', label: 'Largeur couloirs', type: 'int', min: 1, max: 3 },
    { key: 'thin', label: 'Murs fins', type: 'bool' },
    { key: 'braid', label: 'Moins de culs-de-sac', type: 'pct' },
    { key: 'rooms', label: 'Salles', type: 'int', min: 0, max: 12 },
    { key: 'props', label: 'Trésors & pièges', type: 'pct' },
  ],
  forest: [
    ...SIZE,
    { key: 'trees', label: 'Densité des arbres', type: 'pct' },
    { key: 'pathWidth', label: 'Largeur du sentier', type: 'int', min: 1, max: 4 },
    { key: 'branches', label: 'Embranchements', type: 'int', min: 0, max: 3 },
    { key: 'stream', label: 'Ruisseau (avec pont)', type: 'bool' },
    { key: 'clearing', label: 'Clairière avec campement', type: 'bool' },
    { key: 'ruins', label: 'Ruines anciennes', type: 'bool' },
    { key: 'winter', label: 'Hiver (neige, sapins)', type: 'bool' },
    { key: 'props', label: 'Sous-bois', type: 'pct' },
    { key: 'lights', label: 'Éclairage', type: 'pct' },
  ],
  village: [
    ...SIZE,
    { key: 'town', label: 'Ville (rues pavées, bâti serré)', type: 'bool' },
    { key: 'buildings', label: 'Bâtiments', type: 'int', min: 2, max: 40 },
    { key: 'roadWidth', label: 'Largeur des rues', type: 'int', min: 1, max: 4 },
    { key: 'river', label: 'Rivière (avec ponts)', type: 'bool' },
    { key: 'fields', label: 'Champs clôturés', type: 'pct' },
    { key: 'trees', label: 'Arbres', type: 'pct' },
    { key: 'interiors', label: 'Mobilier intérieur', type: 'pct' },
    { key: 'floors', label: 'Maisons à étage', type: 'pct' },
    { key: 'lights', label: 'Lanternes', type: 'pct' },
    { key: 'names', label: 'Noms des bâtiments (MJ)', type: 'bool' },
    { key: 'roofs', label: 'Toits (s’effacent quand on entre, touche K)', type: 'bool' },
    {
      key: 'wall',
      label: 'Enceinte',
      type: 'select',
      options: [
        ['none', 'Aucune'],
        ['palisade', 'Palissade'],
        ['stone', 'Muraille de pierre'],
      ],
    },
  ],
  city: [
    { key: 'cols', label: 'Largeur', type: 'int', min: 60, max: 260 },
    { key: 'rows', label: 'Hauteur', type: 'int', min: 50, max: 200 },
    {
      key: 'size',
      label: 'Agglomération',
      type: 'select',
      options: [
        ['bourg', 'Bourg rural (maisons le long des routes)'],
        ['ville', 'Ville'],
        ['cite', 'Grande cité'],
      ],
    },
    { key: 'districts', label: 'Quartiers', type: 'int', min: 4, max: 30 },
    { key: 'density', label: 'Densité du bâti', type: 'pct' },
    { key: 'walls', label: 'Remparts et portes', type: 'bool' },
    { key: 'castle', label: 'Château', type: 'bool' },
    { key: 'river', label: 'Rivière et ponts', type: 'bool' },
    { key: 'countryside', label: 'Campagne (champs, bois, fermes)', type: 'pct' },
    { key: 'names', label: 'Noms (ville, quartiers, monuments)', type: 'bool' },
  ],
  world: [
    { key: 'cols', label: 'Largeur', type: 'int', min: 60, max: 260 },
    { key: 'rows', label: 'Hauteur', type: 'int', min: 50, max: 200 },
    {
      key: 'shape',
      label: 'Forme',
      type: 'select',
      options: [
        ['continent', 'Continent'],
        ['archipel', 'Archipel'],
        ['interieur', 'Terres intérieures'],
      ],
    },
    { key: 'sea', label: 'Océans', type: 'pct' },
    { key: 'mountains', label: 'Montagnes', type: 'pct' },
    { key: 'forests', label: 'Forêts', type: 'pct' },
    { key: 'rivers', label: 'Rivières', type: 'int', min: 0, max: 30 },
    { key: 'cities', label: 'Villes', type: 'int', min: 2, max: 30 },
    { key: 'roads', label: 'Routes entre les villes', type: 'bool' },
    { key: 'names', label: 'Noms (villes, mers, montagnes)', type: 'bool' },
  ],
};

const STORE = 'eugea:generator';
const KINDS: Kind[] = ['dungeon', 'cave', 'maze', 'forest', 'village', 'city', 'world'];

interface State {
  kind: Kind;
  adaptTheme: boolean;
  dungeon: DungeonParams;
  cave: CaveParams;
  maze: MazeParams;
  forest: ForestParams;
  village: VillageParams;
  city: CityParams;
  world: WorldParams;
}

function loadState(): State {
  const base: State = {
    kind: 'dungeon',
    adaptTheme: true,
    dungeon: { ...DEFAULT_DUNGEON },
    cave: { ...DEFAULT_CAVE },
    maze: { ...DEFAULT_MAZE },
    forest: { ...DEFAULT_FOREST },
    village: { ...DEFAULT_VILLAGE },
    city: { ...DEFAULT_CITY },
    world: { ...DEFAULT_WORLD },
  };
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s) {
      base.kind = KINDS.includes(s.kind) ? s.kind : base.kind;
      base.adaptTheme = s.adaptTheme ?? true;
      for (const k of KINDS) Object.assign(base[k], s[k]);
    }
  } catch {
    /* ignore */
  }
  return base;
}

export function openGenerator(app: App, size?: { cols: number; rows: number }): void {
  const st = loadState();
  if (size) for (const k of KINDS) if (!PLAN.includes(k)) Object.assign(st[k], size);
  let current: DungeonMap | null = null;
  const renderer = new Renderer();
  const preview = h('canvas', { class: 'gen-preview' });
  const info = h('div', { class: 'gen-info' });
  const form = h('div', { class: 'gen-form' });
  const seedInput = h('input', { type: 'text', class: 'grow', spellcheck: false });

  const params = () => st[st.kind] as unknown as Record<string, unknown>;

  const regen = () => {
    const t0 = performance.now();
    try {
      if (st.kind === 'dungeon') current = generateDungeon(st.dungeon);
      else if (st.kind === 'cave') current = generateCave(st.cave);
      else if (st.kind === 'maze') current = generateMaze(st.maze);
      else if (st.kind === 'forest') current = generateForest(st.forest);
      else if (st.kind === 'city') current = generateCity(st.city);
      else if (st.kind === 'world') current = generateWorld(st.world);
      else current = generateVillage(st.village);
    } catch (err) {
      console.error(err);
      toast('Erreur de génération : ' + (err as Error).message, 'error');
      return;
    }
    // réglages : ceux de la carte actuelle, sauf le style de murs (et le thème si « adapté »)
    const s = app.map.settings;
    const g = current.settings;
    const sugg = st.adaptTheme ? SUGGESTED_THEME[st.kind] : null;
    current.settings = {
      ...structuredClone(s),
      wallStyle: g.wallStyle,
      theme: sugg ?? s.theme,
      colors: sugg && sugg !== s.theme ? {} : { ...s.colors },
      darkness: g.darkness,
      skins: s.skins,
      ...(PLAN.includes(st.kind) ? { gridDistance: g.gridDistance, gridUnits: g.gridUnits, showGrid: g.showGrid, vignette: g.vignette } : {}),
    };
    draw();
    const ms = Math.round(performance.now() - t0);
    const nLights = current.lights.length + current.props.filter((p) => PROP_BY_KIND[p.kind]?.light).length;
    info.textContent = `${current.cols}×${current.rows} cases · ${current.props.length} objets · ${nLights} sources de lumière · ${ms} ms`;
    localStorage.setItem(STORE, JSON.stringify(st));
  };

  const draw = () => {
    if (!current) return;
    const dpr = window.devicePixelRatio || 1;
    const W = preview.clientWidth || 640,
      H = preview.clientHeight || 480;
    preview.width = Math.round(W * dpr);
    preview.height = Math.round(H * dpr);
    const scale = Math.min(preview.width / current.cols, preview.height / current.rows);
    const ox = -(preview.width / scale - current.cols) / 2,
      oy = -(preview.height / scale - current.rows) / 2;
    const theme = mapTheme(current.settings);
    renderer.render(preview.getContext('2d')!, current, theme, {
      view: { scale, ox, oy },
      width: preview.width,
      height: preview.height,
      mode: 'gm',
      grid: true,
      lighting: false,
    });
  };

  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(regen, 90);
  };

  const buildForm = () => {
    form.innerHTML = '';
    const p = params();
    seedInput.value = String(p.seed ?? '');
    for (const s of SPECS[st.kind]) {
      const set = (v: unknown) => {
        p[s.key] = v;
        schedule();
      };
      if (s.type === 'int') form.append(field(s.label, range(p[s.key] as number, s.min, s.max, s.step ?? 1, set)));
      else if (s.type === 'float') form.append(field(s.label, range(p[s.key] as number, s.min, s.max, s.step, set, (v) => v.toFixed(2))));
      else if (s.type === 'pct') form.append(field(s.label, range(p[s.key] as number, 0, 1, 0.05, set, (v) => `${Math.round(v * 100)}%`)));
      else if (s.type === 'bool') form.append(checkbox(s.label, !!p[s.key], set));
      else form.append(field(s.label, select(s.options, p[s.key] as string, set)));
    }
  };

  seedInput.addEventListener('input', () => {
    params().seed = seedInput.value;
    schedule();
  });

  const reroll = () => {
    params().seed = randomSeed();
    seedInput.value = String(params().seed);
    regen();
  };

  const tabs = segmented<Kind>(
    [
      ['dungeon', 'Donjon'],
      ['cave', 'Grotte'],
      ['maze', 'Labyrinthe'],
      ['forest', 'Forêt'],
      ['village', 'Village'],
      ['city', 'Plan de ville'],
      ['world', 'Monde'],
    ],
    st.kind,
    (k) => {
      st.kind = k;
      buildForm();
      regen();
    },
  );
  tabs.classList.add('wrap');
  const multi = app.map.levels.length > 1;

  const body = h(
    'div',
    { class: 'gen' },
    h(
      'div',
      { class: 'gen-left' },
      tabs,
      h('div', { class: 'seed-row' }, h('span', { class: 'field-label' }, 'Graine'), seedInput, button('🎲', reroll, 'icon', 'Nouvelle graine aléatoire')),
      form,
      checkbox('Thème adapté (grotte → Caverne, extérieurs → Plein air)', st.adaptTheme, (v) => {
        st.adaptTheme = v;
        regen();
      }),
      multi ? h('p', { class: 'help' }, `Une carte d’un seul niveau remplacera uniquement le niveau « ${app.map.level.name} » ; une carte à étages remplace toute la carte.`) : null,
      PLAN.includes(st.kind) ? h('p', { class: 'help' }, st.kind === 'world' ? 'Carte du monde : 1 case = 5 km, sans grille. Montagnes, forêts et villes sont des pictogrammes modifiables (Objets → Cartes).' : 'Plan de ville : 1 case = 5 m, sans grille. Les maisons sont des toits ; remparts et portes deviennent des murs dans Foundry.') : null,
    ),
    h(
      'div',
      { class: 'gen-right' },
      preview,
      info,
      h(
        'div',
        { class: 'modal-foot' },
        button('🎲 Relancer', reroll),
        button(
          'Utiliser cette carte',
          () => {
            if (!current) return;
            app.applyGenerated(current, false);
            md.close();
            toast('Carte générée — Ctrl+Z pour revenir en arrière.', 'ok');
          },
          'primary',
        ),
      ),
    ),
  );
  const md = modal('Générateur aléatoire', body, { wide: true });
  buildForm();
  requestAnimationFrame(regen);
}
