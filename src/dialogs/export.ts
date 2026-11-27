import type { App } from '../app';
import {
  ImageFormat,
  MAX_SIDE,
  blobToBase64,
  canvasToBlob,
  computeCrop,
  extOf,
  foundryBaseScene,
  foundryLevel,
  mimeOf,
  propImageKey,
  renderLevelImage,
  renderPropImage,
  tileProps,
  universalVTT,
} from '../export';
import { Prop } from '../model';
import { button, checkbox, field, h, modal, segmented, select, toast } from '../ui';
import { downloadBlob, slugify } from '../util';
import { makeZip, ZipEntry } from '../zip';

type Target = 'foundry' | 'uvtt' | 'image' | 'foundry-json';

const STORE = 'eugea:export';

interface ExportState {
  target: Target;
  ppg: number;
  format: ImageFormat;
  grid: boolean;
  foundryGrid: boolean;
  lighting: boolean;
  crop: boolean;
  margin: number;
  gmView: boolean;
  gmDrawings: boolean;
  tiles: boolean;
  imageDir: string;
}

const TARGETS: { id: Target; title: string; desc: string; badge?: string }[] = [
  {
    id: 'foundry',
    title: 'Foundry VTT',
    badge: 'Recommandé',
    desc: 'Un seul fichier : images des niveaux, murs, portes (verrouillées, secrètes), fenêtres, lumières, objets séparés (tuiles) et notes MJ cachées. À importer avec le module « Eugéa Importer ».',
  },
  {
    id: 'uvtt',
    title: 'Universal VTT (.dd2vtt)',
    desc: 'Format standard : module « Universal Battlemap Importer » de Foundry, Arkenforge… Un fichier par niveau.',
  },
  { id: 'image', title: 'Image seule', desc: 'PNG / WebP / JPEG pour impression, Roll20, Owlbear Rodeo, Discord… Une image par niveau.' },
  {
    id: 'foundry-json',
    title: 'Foundry — scènes JSON + images',
    desc: 'Sans module : une archive à décompresser dans Data, puis clic droit sur une scène → « Importer des données ».',
  },
];

function load(): ExportState {
  const d: ExportState = {
    target: 'foundry',
    ppg: 100,
    format: 'webp',
    grid: true,
    foundryGrid: false,
    lighting: false,
    crop: true,
    margin: 1,
    gmView: false,
    gmDrawings: true,
    tiles: true,
    imageDir: 'maps',
  };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
  } catch {
    return d;
  }
}

export function openExport(app: App): void {
  const st = load();
  const body = h('div', { class: 'export' });
  const targetsEl = h('div', { class: 'targets' });
  const optsEl = h('div', { class: 'form' });
  const infoEl = h('div', { class: 'export-info' });
  const go = button('Exporter', () => run(), 'primary big');
  const nLevels = app.map.levels.length;

  const renderTargets = () => {
    targetsEl.innerHTML = '';
    for (const t of TARGETS) {
      const card = h(
        'button',
        { class: 'target' + (st.target === t.id ? ' on' : ''), type: 'button' },
        h('span', { class: 'target-title' }, t.title, t.badge ? h('span', { class: 'badge' }, t.badge) : null),
        h('span', { class: 'target-desc' }, t.desc),
      );
      card.addEventListener('click', () => {
        st.target = t.id;
        renderTargets();
        renderOpts();
      });
      targetsEl.append(card);
    }
  };

  const updateInfo = () => {
    const crop = computeCrop(app.map, st.crop, st.margin);
    const W = Math.round(crop.w * st.ppg),
      H = Math.round(crop.h * st.ppg);
    const warn = W > MAX_SIDE || H > MAX_SIDE ? ' ⛔ trop grand pour le navigateur' : W > 8192 || H > 8192 ? ' ⚠ au-delà de 8192 px, certaines cartes graphiques peinent dans Foundry' : '';
    const lv = nLevels > 1 ? `${nLevels} niveaux · ` : '';
    infoEl.textContent = `${lv}${crop.w} × ${crop.h} cases → ${W} × ${H} px${warn}`;
    infoEl.classList.toggle('warn', !!warn);
    go.disabled = W > MAX_SIDE || H > MAX_SIDE;
  };

  const renderOpts = () => {
    optsEl.innerHTML = '';
    const t = st.target;
    const isFoundry = t === 'foundry' || t === 'foundry-json';
    optsEl.append(
      field(
        'Pixels par case',
        select(
          [
            ['50', '50 px'],
            ['70', '70 px'],
            ['100', '100 px (Foundry par défaut)'],
            ['140', '140 px'],
            ['200', '200 px (impression)'],
          ],
          String(st.ppg) as '100',
          (v) => {
            st.ppg = parseInt(v, 10);
            updateInfo();
          },
        ),
      ),
    );
    if (t !== 'uvtt')
      optsEl.append(
        field(
          'Format image',
          segmented<ImageFormat>(
            [
              ['webp', 'WebP', 'Léger, recommandé pour Foundry'],
              ['png', 'PNG', 'Sans perte'],
              ['jpeg', 'JPEG'],
            ],
            st.format,
            (v) => (st.format = v),
          ),
        ),
      );
    if (t === 'image') optsEl.append(checkbox('Version MJ (portes secrètes, pièges, numéros visibles)', st.gmView, (v) => (st.gmView = v)));
    optsEl.append(
      checkbox('Grille dessinée dans l’image', st.grid, (v) => (st.grid = v)),
      checkbox('Éclairage intégré à l’image (ambiance)', st.lighting, (v) => (st.lighting = v), 'Assombrit la carte et dessine la lumière des torches. Inutile dans Foundry, qui gère l’éclairage dynamique.'),
      checkbox('Recadrer sur le contenu', st.crop, (v) => {
        st.crop = v;
        updateInfo();
      }),
    );
    if (isFoundry)
      optsEl.append(
        checkbox('Objets séparés en tuiles (coffres, tonneaux, caisses…)', st.tiles, (v) => (st.tiles = v), 'Chaque objet marqué « séparé » devient une tuile Foundry indépendante (déplaçable, masquable). Sinon il est dessiné dans le fond.'),
        checkbox('Numéros et textes MJ → dessins cachés', st.gmDrawings, (v) => (st.gmDrawings = v)),
        checkbox('Afficher aussi la grille Foundry', st.foundryGrid, (v) => (st.foundryGrid = v)),
      );
    if (t === 'foundry-json') {
      const dir = h('input', { type: 'text', value: st.imageDir, class: 'grow' });
      dir.addEventListener('input', () => (st.imageDir = dir.value.replace(/^\/+|\/+$/g, '')));
      optsEl.append(field('Dossier dans Data', dir), h('p', { class: 'help' }, 'Décompressez l’archive dans ce dossier de Data, puis importez chaque fichier fvtt-Scene-….json sur une scène vide.'));
    }
    if (t === 'foundry')
      optsEl.append(
        h(
          'p',
          { class: 'help' },
          'Module « Eugéa Importer » : installez-le depuis la page GitHub du projet (lien manifeste) ou copiez le dossier ',
          h('code', {}, 'foundry-module/eugea-importer'),
          ' dans ',
          h('code', {}, 'Data/modules'),
          '. Puis onglet Scènes → « Importer une carte Eugéa ». ' +
            (nLevels > 1 ? 'Foundry V14 : les étages deviennent des niveaux natifs d’une même scène ; V11–V13 : une scène par étage, regroupées dans un dossier.' : ''),
        ),
      );
    if (t === 'uvtt') optsEl.append(h('p', { class: 'help' }, 'Image en PNG (exigé par le format). Les objets sont dessinés dans l’image ; fenêtres et herses ne sont pas gérées par ce format.'));
    updateInfo();
  };

  const status = (s: string) => (go.textContent = s);

  const run = async () => {
    localStorage.setItem(STORE, JSON.stringify(st));
    go.disabled = true;
    const tick = () => new Promise((r) => setTimeout(r, 20));
    try {
      const map = app.map;
      const name = map.name || 'Carte';
      const slug = slugify(name);
      const crop = computeCrop(map, st.crop, st.margin);
      const isFoundry = st.target === 'foundry' || st.target === 'foundry-json';
      const format: ImageFormat = st.target === 'uvtt' ? 'png' : st.format;
      const ext = extOf(format);
      const tileFormat: ImageFormat = format === 'jpeg' ? 'png' : format;
      const levelSlug = (i: number) => (nLevels > 1 ? `${slug}-${slugify(map.levels[i].name)}` : slug);
      const renderLevel = async (i: number) => {
        status(nLevels > 1 ? `Niveau ${i + 1}/${nLevels}…` : 'Rendu de l’image…');
        await tick();
        const canvas = renderLevelImage(map, i, crop, {
          ppg: st.ppg,
          mode: isFoundry || !st.gmView ? 'player' : 'gm',
          grid: st.grid,
          lighting: st.lighting,
          separateTiles: isFoundry && st.tiles,
        });
        return canvasToBlob(canvas, format);
      };
      // Tuiles (Foundry) : une image par objet distinct
      const tileImages = async (): Promise<Map<string, Blob>> => {
        const props = new Map<string, Prop>();
        for (let i = 0; i < nLevels; i++)
          for (const p of tileProps(map.levelView(i))) if (st.tiles || p.gmOnly) props.set(propImageKey(p), p);
        const out = new Map<string, Blob>();
        let k = 0;
        for (const [key, p] of props) {
          if (k++ % 10 === 0) {
            status(`Objets ${k}/${props.size}…`);
            await tick();
          }
          out.set(key, await canvasToBlob(renderPropImage(map, p, st.ppg), tileFormat));
        }
        return out;
      };
      const levelsData = () =>
        map.levels.map((_, i) => {
          const lv = foundryLevel(map, i, crop, st.ppg, `level-${i}`, st.gmDrawings);
          if (!st.tiles) lv.tiles = lv.tiles.filter((t) => t.hidden);
          return lv;
        });

      if (st.target === 'image') {
        const files: ZipEntry[] = [];
        for (let i = 0; i < nLevels; i++) files.push({ name: `${levelSlug(i)}${st.gmView ? '-mj' : ''}.${ext}`, data: await renderLevel(i) });
        if (files.length === 1) downloadBlob(files[0].data as Blob, files[0].name);
        else downloadBlob(await makeZip(files), `${slug}-images.zip`);
      } else if (st.target === 'uvtt') {
        const files: ZipEntry[] = [];
        for (let i = 0; i < nLevels; i++) {
          const b64 = await blobToBase64(await renderLevel(i));
          files.push({ name: `${levelSlug(i)}.dd2vtt`, data: JSON.stringify(universalVTT(map.levelView(i), crop, st.ppg, b64, st.lighting)) });
        }
        if (files.length === 1) downloadBlob(new Blob([files[0].data]), files[0].name);
        else downloadBlob(await makeZip(files), `${slug}-dd2vtt.zip`);
      } else if (st.target === 'foundry') {
        const images: Record<string, { name: string; mime: string; data: string }> = {};
        for (let i = 0; i < nLevels; i++) images[`level-${i}`] = { name: `${levelSlug(i)}.${ext}`, mime: mimeOf(format), data: await blobToBase64(await renderLevel(i)) };
        for (const [key, blob] of await tileImages()) images[key] = { name: `${key}.${extOf(tileFormat)}`, mime: mimeOf(tileFormat), data: await blobToBase64(blob) };
        status('Assemblage…');
        await tick();
        const pack = {
          format: 'eugea-scene',
          version: 2,
          name,
          slug,
          scene: foundryBaseScene(map, crop, st.ppg, st.foundryGrid),
          levels: levelsData(),
          images,
        };
        downloadBlob(new Blob([JSON.stringify(pack)], { type: 'application/json' }), `${slug}.foundry.json`);
      } else {
        const base = `${st.imageDir ? st.imageDir + '/' : ''}${slug}`;
        const files: ZipEntry[] = [];
        const tiles = await tileImages();
        for (const [key, blob] of tiles) files.push({ name: `${slug}/tiles/${key}.${extOf(tileFormat)}`, data: blob });
        const levels = levelsData();
        for (let i = 0; i < nLevels; i++) {
          const img = `${levelSlug(i)}.${ext}`;
          files.push({ name: `${slug}/${img}`, data: await renderLevel(i) });
          const lv = levels[i];
          const scene = {
            ...foundryBaseScene(map, crop, st.ppg, st.foundryGrid),
            name: nLevels > 1 ? `${name} — ${lv.name}` : name,
            background: { src: `${base}/${img}` },
            walls: lv.walls,
            lights: lv.lights,
            drawings: lv.drawings,
            tiles: lv.tiles.map(({ image, ...t }) => ({ ...t, texture: { src: `${base}/tiles/${image}.${extOf(tileFormat)}` } })),
            notes: [],
            tokens: [],
            sounds: [],
            templates: [],
          };
          files.push({ name: `${slug}/fvtt-Scene-${levelSlug(i)}.json`, data: JSON.stringify(scene, null, 1) });
        }
        status('Archive…');
        downloadBlob(await makeZip(files), `${slug}-foundry.zip`);
      }
      toast('Export terminé.', 'ok');
      md.close();
    } catch (err) {
      console.error(err);
      toast('Échec de l’export : ' + (err as Error).message, 'error');
      go.disabled = false;
      go.textContent = 'Exporter';
    }
  };

  body.append(h('div', { class: 'export-left' }, targetsEl), h('div', { class: 'export-right' }, optsEl, infoEl, h('div', { class: 'modal-foot' }, go)));
  renderTargets();
  renderOpts();
  const md = modal('Exporter', body, { wide: true });
}
