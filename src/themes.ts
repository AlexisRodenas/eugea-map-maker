import { MapSettings, T, TERRAINS } from './model';
import { darken, lighten, luminance, mix } from './util';

export type HatchStyle = 'clusters' | 'lines' | 'dots' | 'none';
export type GridStyle = 'solid' | 'dashed' | 'dotted' | 'none';

/** Couleurs personnalisables (exposées dans le panneau Style). */
export const COLOR_KEYS: [keyof ThemeColors, string][] = [
  ['bg', 'Fond'],
  ['floor', 'Sol'],
  ['wall', 'Murs'],
  ['hatch', 'Hachures'],
  ['grid', 'Grille'],
  ['door', 'Portes'],
  ['ink', 'Contours objets'],
  ['label', 'Texte'],
  ['accent', 'Accent (secrets)'],
];

export interface ThemeColors {
  bg: string;
  floor: string;
  wall: string;
  hatch: string;
  grid: string;
  shadow: string;
  door: string;
  ink: string;
  label: string;
  accent: string;
}

export interface ThemeDef extends ThemeColors {
  id: string;
  name: string;
  hatchStyle: HatchStyle;
  hatchWidth: number; // largeur de la bande hachurée, en cases
  hatchLine: number; // épaisseur des traits de hachure
  wallWidth: number;
  gridStyle: GridStyle;
  gridWidth: number;
  shadowWidth: number;
  paper: number; // grain de papier 0..1
  terrainMix: number; // 0 : couleurs pures, 1 : couleur du sol
  propMix: number;
}

export interface PropPalette {
  ink: string;
  fill: string;
  wood: string;
  woodDark: string;
  stone: string;
  stoneDark: string;
  metal: string;
  cloth: string;
  gold: string;
  fire: string;
  water: string;
  plant: string;
  bone: string;
  magic: string;
  paper: string;
  accent: string;
}

export interface ResolvedTheme extends ThemeDef {
  terrain: Record<number, string>;
  terrainDetail: Record<number, string>;
  pal: PropPalette;
  dark: boolean;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'parchemin',
    name: 'Parchemin',
    bg: '#e6d6ae',
    floor: '#f7eed6',
    wall: '#3b2816',
    hatch: '#6e5030',
    grid: 'rgba(110,75,40,0.22)',
    shadow: 'rgba(90,55,20,0.16)',
    door: '#c99d62',
    ink: '#3b2816',
    label: '#3b2816',
    accent: '#a4301f',
    hatchStyle: 'clusters',
    hatchWidth: 0.95,
    hatchLine: 0.032,
    wallWidth: 0.15,
    gridStyle: 'solid',
    gridWidth: 0.025,
    shadowWidth: 0.35,
    paper: 0.35,
    terrainMix: 0.35,
    propMix: 0.3,
  },
  {
    id: 'encre',
    name: 'Encre & papier',
    bg: '#ffffff',
    floor: '#ffffff',
    wall: '#141414',
    hatch: '#262626',
    grid: 'rgba(0,0,0,0.17)',
    shadow: 'rgba(0,0,0,0.12)',
    door: '#ffffff',
    ink: '#141414',
    label: '#141414',
    accent: '#c0392b',
    hatchStyle: 'clusters',
    hatchWidth: 0.9,
    hatchLine: 0.03,
    wallWidth: 0.14,
    gridStyle: 'solid',
    gridWidth: 0.022,
    shadowWidth: 0.3,
    paper: 0,
    terrainMix: 0.78,
    propMix: 0.85,
  },
  {
    id: 'pierre',
    name: 'Pierre sombre',
    bg: '#1c1c23',
    floor: '#8e8c86',
    wall: '#111115',
    hatch: '#4c4c5a',
    grid: 'rgba(0,0,0,0.28)',
    shadow: 'rgba(0,0,0,0.38)',
    door: '#7a5230',
    ink: '#18181c',
    label: '#f2efe6',
    accent: '#e0b44a',
    hatchStyle: 'clusters',
    hatchWidth: 1.0,
    hatchLine: 0.035,
    wallWidth: 0.17,
    gridStyle: 'solid',
    gridWidth: 0.025,
    shadowWidth: 0.45,
    paper: 0.3,
    terrainMix: 0.18,
    propMix: 0.12,
  },
  {
    id: 'caverne',
    name: 'Caverne',
    bg: '#2a2019',
    floor: '#a08868',
    wall: '#1c140e',
    hatch: '#5d4733',
    grid: 'rgba(30,20,10,0.25)',
    shadow: 'rgba(25,12,0,0.35)',
    door: '#6b4426',
    ink: '#1c140e',
    label: '#f4e7d0',
    accent: '#e8a33d',
    hatchStyle: 'clusters',
    hatchWidth: 1.1,
    hatchLine: 0.035,
    wallWidth: 0.16,
    gridStyle: 'dashed',
    gridWidth: 0.025,
    shadowWidth: 0.45,
    paper: 0.35,
    terrainMix: 0.2,
    propMix: 0.15,
  },
  {
    id: 'blueprint',
    name: "Plan d'architecte",
    bg: '#123566',
    floor: '#1c4a88',
    wall: '#e8f1ff',
    hatch: 'rgba(190,220,255,0.55)',
    grid: 'rgba(255,255,255,0.17)',
    shadow: 'rgba(0,10,40,0.25)',
    door: '#1c4a88',
    ink: '#e8f1ff',
    label: '#ffffff',
    accent: '#ffd166',
    hatchStyle: 'lines',
    hatchWidth: 0.8,
    hatchLine: 0.025,
    wallWidth: 0.1,
    gridStyle: 'solid',
    gridWidth: 0.02,
    shadowWidth: 0.25,
    paper: 0.15,
    terrainMix: 0.72,
    propMix: 0.86,
  },
  {
    id: 'pleinair',
    name: 'Plein air',
    bg: '#2f3b24',
    floor: '#d3c5a4',
    wall: '#2c261f',
    hatch: '#1f2918',
    grid: 'rgba(25,30,15,0.16)',
    shadow: 'rgba(0,0,0,0.3)',
    door: '#8a6238',
    ink: '#2a241c',
    label: '#fff8e6',
    accent: '#ffcf4a',
    hatchStyle: 'dots',
    hatchWidth: 1,
    hatchLine: 0.05,
    wallWidth: 0.17,
    gridStyle: 'solid',
    gridWidth: 0.02,
    shadowWidth: 0.38,
    paper: 0.18,
    terrainMix: 0.04,
    propMix: 0.06,
  },
  {
    id: 'foret',
    name: 'Ruines sylvestres',
    bg: '#3f5a2e',
    floor: '#c9c1a7',
    wall: '#383126',
    hatch: '#2b411f',
    grid: 'rgba(50,40,20,0.2)',
    shadow: 'rgba(20,30,10,0.3)',
    door: '#7c5a35',
    ink: '#2a241b',
    label: '#fffbe8',
    accent: '#ffd35c',
    hatchStyle: 'dots',
    hatchWidth: 1.2,
    hatchLine: 0.05,
    wallWidth: 0.16,
    gridStyle: 'solid',
    gridWidth: 0.022,
    shadowWidth: 0.4,
    paper: 0.4,
    terrainMix: 0.2,
    propMix: 0.15,
  },
  {
    id: 'glace',
    name: 'Glacier',
    bg: '#cfe5f1',
    floor: '#f3fbff',
    wall: '#22405b',
    hatch: '#6d99bb',
    grid: 'rgba(35,65,92,0.15)',
    shadow: 'rgba(35,65,92,0.18)',
    door: '#9cc3dd',
    ink: '#22405b',
    label: '#22405b',
    accent: '#d1495b',
    hatchStyle: 'clusters',
    hatchWidth: 0.9,
    hatchLine: 0.03,
    wallWidth: 0.14,
    gridStyle: 'dotted',
    gridWidth: 0.05,
    shadowWidth: 0.3,
    paper: 0.15,
    terrainMix: 0.45,
    propMix: 0.4,
  },
  {
    id: 'enfer',
    name: 'Forge infernale',
    bg: '#170605',
    floor: '#4d3833',
    wall: '#0b0303',
    hatch: '#6e1c0d',
    grid: 'rgba(255,120,60,0.13)',
    shadow: 'rgba(0,0,0,0.45)',
    door: '#5e2c16',
    ink: '#0b0303',
    label: '#ffd7b0',
    accent: '#ff7b2e',
    hatchStyle: 'clusters',
    hatchWidth: 1.0,
    hatchLine: 0.035,
    wallWidth: 0.17,
    gridStyle: 'solid',
    gridWidth: 0.025,
    shadowWidth: 0.45,
    paper: 0.3,
    terrainMix: 0.12,
    propMix: 0.1,
  },
  {
    id: 'neon',
    name: 'Néon',
    bg: '#0b0420',
    floor: '#1a0f3d',
    wall: '#ff2bd6',
    hatch: '#4d1f94',
    grid: 'rgba(0,240,255,0.22)',
    shadow: 'rgba(255,43,214,0.14)',
    door: '#0b0420',
    ink: '#00f0ff',
    label: '#00f0ff',
    accent: '#fff200',
    hatchStyle: 'lines',
    hatchWidth: 0.9,
    hatchLine: 0.03,
    wallWidth: 0.11,
    gridStyle: 'solid',
    gridWidth: 0.02,
    shadowWidth: 0.3,
    paper: 0,
    terrainMix: 0.55,
    propMix: 0.7,
  },
];

export const THEME_BY_ID: Record<string, ThemeDef> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

const PROP_BASE = {
  wood: '#9a6a3a',
  woodDark: '#5e3d20',
  stone: '#a7a49c',
  stoneDark: '#6f6c66',
  metal: '#7d8590',
  cloth: '#8e2c3e',
  gold: '#d9a62e',
  fire: '#ff8a1f',
  water: '#3d86c6',
  plant: '#4f8a3a',
  bone: '#e8dfc8',
  magic: '#8a5cff',
  paper: '#efe6cf',
};

export function resolveTheme(id: string, overrides: Record<string, string> = {}): ResolvedTheme {
  const base = THEME_BY_ID[id] ?? THEMES[0];
  const t: ThemeDef = { ...base, ...(overrides as Partial<ThemeColors>) };
  const terrain: Record<number, string> = {};
  const terrainDetail: Record<number, string> = {};
  const dark = luminance(t.floor) < 0.45;
  for (const def of TERRAINS) {
    let c: string;
    if (def.id === T.STONE) c = t.floor;
    else if (def.id === T.PIT) c = mix('#050507', t.bg, 0.15);
    else if (def.id === T.LAVA) c = mix(def.base, t.floor, t.terrainMix * 0.4);
    else c = mix(def.base, t.floor, t.terrainMix);
    terrain[def.id] = c;
    terrainDetail[def.id] =
      def.id === T.LAVA ? mix('#5a1200', c, 0.25) : dark ? lighten(c, 0.22) : darken(c, def.id === T.WATER || def.id === T.DEEP ? 0.18 : 0.28);
  }
  const pm = t.propMix;
  const p = (c: string) => mix(c, t.floor, pm);
  const pal: PropPalette = {
    ink: t.ink,
    fill: mix(t.floor, t.wall, 0.06),
    wood: p(PROP_BASE.wood),
    woodDark: p(PROP_BASE.woodDark),
    stone: p(PROP_BASE.stone),
    stoneDark: p(PROP_BASE.stoneDark),
    metal: p(PROP_BASE.metal),
    cloth: p(PROP_BASE.cloth),
    gold: p(PROP_BASE.gold),
    fire: mix(PROP_BASE.fire, t.floor, pm * 0.5),
    water: p(PROP_BASE.water),
    plant: p(PROP_BASE.plant),
    bone: p(PROP_BASE.bone),
    magic: mix(PROP_BASE.magic, t.accent, 0.3),
    paper: p(PROP_BASE.paper),
    accent: t.accent,
  };
  return { ...t, terrain, terrainDetail, pal, dark };
}

/** Thème d'une carte : thème choisi + couleurs personnalisées + effets autour des murs. */
export function mapTheme(s: MapSettings): ResolvedTheme {
  const t = resolveTheme(s.theme, s.colors);
  if (s.wallFx === false) return { ...t, hatchStyle: 'none', shadowWidth: 0 };
  if (s.hatch && s.hatch !== 'auto') return { ...t, hatchStyle: s.hatch };
  return t;
}
