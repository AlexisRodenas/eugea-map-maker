import type { App } from '../app';
import {
  AMBIANCES,
  Ambiance,
  ImageFormat,
  MAX_SIDE,
  TileMode,
  ambianceOf,
  isPlanMap,
  blobToBase64,
  canvasToBlob,
  computeCrop,
  extOf,
  foundryBaseScene,
  foundryLevel,
  foundryLinks,
  mimeOf,
  propImageKey,
  renderLevelImage,
  renderPropImage,
  roofElevation,
  staticTile,
  tileParts,
  tileProps,
  universalVTT,
} from '../export';
import { assetImage, ensureAssets, extOfMime } from '../assets';
import { MODULE_URL } from '../links';
import { Prop } from '../model';
import type { TilePart } from '../export';
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
  tileMode: TileMode;
  /** Lumière de la scène Foundry : jour, crépuscule, nuit, ou d'après l'obscurité de la carte. */
  ambiance: Ambiance | 'map';
  roofs: boolean;
  imageDir: string;
  /** Archive sans module : version de Foundry visée (la position des tuiles a changé en V14). */
  zipGen: 'v14' | 'v12';
}

const TARGETS: { id: Target; title: string; desc: string; badge?: string }[] = [
  {
    id: 'foundry',
    title: 'Foundry VTT',
    badge: 'Recommandé',
    desc: 'Un seul fichier, tout est posé à l’import : images des niveaux, murs, portes (verrouillées, secrètes), fenêtres, remparts, lumières, objets séparés et toits en tuiles, étages, escaliers et passages (téléportation), notes MJ cachées. À importer avec le module « Eugéa Importer ».',
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
    desc: 'Sans module : une archive à décompresser dans Data, puis clic droit sur une scène → « Importer des données ». Escaliers et passages ne sont pas reliés (il faut le module).',
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
    tileMode: 'all',
    ambiance: 'map',
    roofs: false,
    imageDir: 'maps',
    zipGen: 'v14',
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
    if (t === 'image')
      optsEl.append(
        checkbox('Version MJ (portes secrètes, pièges, numéros visibles)', st.gmView, (v) => (st.gmView = v)),
        checkbox('Toits dessinés (vue de l’extérieur)', st.roofs, (v) => (st.roofs = v), 'Sinon l’intérieur des bâtiments reste visible.'),
      );
    optsEl.append(
      checkbox('Grille dessinée dans l’image', st.grid, (v) => (st.grid = v)),
      checkbox('Éclairage intégré à l’image (ambiance)', st.lighting, (v) => (st.lighting = v), 'Assombrit la carte et dessine la lumière des torches. Inutile dans Foundry, qui gère l’éclairage dynamique.'),
      checkbox('Recadrer sur le contenu', st.crop, (v) => {
        st.crop = v;
        updateInfo();
      }),
    );
    if (isFoundry) {
      const auto = ambianceOf(app.map.settings.darkness);
      optsEl.append(
        field(
          'Lumière',
          segmented<Ambiance | 'map'>(
            [['map', `Selon la carte (${AMBIANCES.find((a) => a[0] === auto)![1].toLowerCase()})`] as [Ambiance | 'map', string], ...AMBIANCES.map(([id, label]) => [id, label] as [Ambiance | 'map', string])],
            st.ambiance,
            (v) => (st.ambiance = v),
          ),
        ),
        field(
          'Objets',
          select<TileMode>(
            [
              ['all', 'Tous en tuiles (recommandé)'],
              ['separate', 'Seulement les objets « séparés »'],
              ['none', 'Dessinés dans le fond'],
            ],
            st.tileMode,
            (v) => (st.tileMode = v),
          ),
        ),
        h(
          'p',
          { class: 'help' },
          isPlanMap(app.map)
            ? 'Plan de ville ou carte du monde : tout est dessiné dans l’image (toits compris), sans tuiles.'
            : 'En tuiles, chaque meuble, arbre ou objet se déplace, se cache ou se supprime dans Foundry ; le fond ne garde que les sols, murs, portes et terrains. Les arbres donnent deux tuiles : le tronc au sol et le feuillage, qui s’efface quand un jeton passe dessous. Les toits sont toujours des tuiles.',
        ),
        checkbox('Numéros et textes MJ → dessins cachés', st.gmDrawings, (v) => (st.gmDrawings = v)),
        checkbox('Afficher aussi la grille Foundry', st.foundryGrid, (v) => (st.foundryGrid = v)),
      );
    }
    if (t === 'foundry-json')
      optsEl.append(
        field(
          'Version de Foundry',
          segmented<'v14' | 'v12'>(
            [
              ['v14', 'V14 et plus'],
              ['v12', 'v11 à v13'],
            ],
            st.zipGen,
            (v) => (st.zipGen = v),
          ),
        ),
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
          'Module ',
          h('a', { href: MODULE_URL, target: '_blank', rel: 'noopener' }, 'Eugéa Importer'),
          ' : dans Foundry, onglet Scènes → « Importer une carte Eugéa ». Murs, portes, lumières, tuiles, toits et étages sont posés automatiquement. ' +
            (nLevels > 1 ? 'Foundry V14 : les étages deviennent des niveaux natifs d’une même scène ; V11–V13 : une scène par étage, regroupées dans un dossier.' : ''),
        ),
      );
    if (t === 'uvtt') optsEl.append(h('p', { class: 'help' }, 'Image en PNG (exigé par le format). Les objets sont dessinés dans l’image, sans les toits ; fenêtres et herses ne sont pas gérées par ce format.'));
    updateInfo();
  };

  const status = (s: string) => (go.textContent = s);

  const run = async () => {
    localStorage.setItem(STORE, JSON.stringify(st));
    go.disabled = true;
    const tick = () => new Promise((r) => setTimeout(r, 20));
    try {
      const map = app.map;
      status('Images personnelles…');
      const lost = await ensureAssets(map.usedAssets());
      if (lost.length) toast(`${lost.length} image(s) personnelle(s) introuvable(s) : rouvrez le fichier .eugea.json qui les contient.`, 'error');
      const name = map.name || 'Carte';
      const slug = slugify(name);
      const crop = computeCrop(map, st.crop, st.margin);
      const isFoundry = st.target === 'foundry' || st.target === 'foundry-json';
      const format: ImageFormat = st.target === 'uvtt' ? 'png' : st.format;
      const ext = extOf(format);
      const tileFormat: ImageFormat = format === 'jpeg' ? 'png' : format;
      const levelSlug = (i: number) => (nLevels > 1 ? `${slug}-${slugify(map.levels[i].name)}` : slug);
      const tileMode: TileMode = !isFoundry ? 'none' : isPlanMap(map) ? 'flat' : st.tileMode;
      const ambiance: Ambiance = st.ambiance === 'map' ? ambianceOf(map.settings.darkness) : st.ambiance;
      const renderLevel = async (i: number, transparent = false) => {
        status(nLevels > 1 ? `Niveau ${i + 1}/${nLevels}…` : 'Rendu de l’image…');
        await tick();
        const canvas = renderLevelImage(map, i, crop, {
          ppg: st.ppg,
          mode: isFoundry || !st.gmView ? 'player' : 'gm',
          grid: st.grid,
          lighting: st.lighting,
          tiles: tileMode,
          roofs: st.target === 'image' && st.roofs,
          transparent,
        });
        // transparence : WebP ou PNG (le JPEG n'a pas de canal alpha)
        return canvasToBlob(canvas, transparent && format === 'jpeg' ? 'webp' : format);
      };
      /** Étage au-dessus du rez-de-chaussée : image transparente hors du sol en plus (niveaux natifs V14). */
      const isUpper = (i: number) => map.levels[i].z > 0;
      // Tuiles (Foundry) : une image par objet distinct
      // (les images personnelles sont reprises telles quelles, sans perte)
      const tileImages = async (): Promise<Map<string, { blob: Blob; ext: string; mime: string; src?: string }>> => {
        const props = new Map<string, [Prop, TilePart]>();
        for (let i = 0; i < nLevels; i++) {
          const view = map.levelView(i);
          for (const p of tileProps(view, tileMode)) for (const part of tileParts(view, p)) props.set(propImageKey(p, view, part), [p, part]);
        }
        const out = new Map<string, { blob: Blob; ext: string; mime: string; src?: string }>();
        let k = 0;
        for (const [key, [p, part]] of props) {
          if (k++ % 10 === 0) {
            status(`Objets ${k}/${props.size}…`);
            await tick();
          }
          const a = key.startsWith('asset-') ? assetImage(key.slice(6)) : null;
          if (a) out.set(key, { blob: a.blob, mime: a.mime, ext: extOfMime(a.mime), src: a.src });
          else out.set(key, { blob: await canvasToBlob(renderPropImage(map, p, st.ppg, part), tileFormat), mime: mimeOf(tileFormat), ext: extOf(tileFormat) });
        }
        return out;
      };
      const levelsData = () => map.levels.map((_, i) => foundryLevel(map, i, crop, st.ppg, `level-${i}`, st.gmDrawings, tileMode, isUpper(i) ? `level-${i}-over` : undefined));

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
        const images: Record<string, { name: string; mime: string; data?: string; foundry?: string }> = {};
        for (let i = 0; i < nLevels; i++) {
          images[`level-${i}`] = { name: `${levelSlug(i)}.${ext}`, mime: mimeOf(format), data: await blobToBase64(await renderLevel(i)) };
          if (isUpper(i)) {
            const fmt: ImageFormat = format === 'jpeg' ? 'webp' : format;
            images[`level-${i}-over`] = { name: `${levelSlug(i)}-transparent.${extOf(fmt)}`, mime: mimeOf(fmt), data: await blobToBase64(await renderLevel(i, true)) };
          }
        }
        // images déjà dans Foundry : seulement leur chemin (le module ne les renvoie pas)
        for (const [key, t] of await tileImages()) images[key] = t.src ? { name: `${key}.${t.ext}`, mime: t.mime, foundry: t.src } : { name: `${key}.${t.ext}`, mime: t.mime, data: await blobToBase64(t.blob) };
        status('Assemblage…');
        await tick();
        const pack = {
          format: 'eugea-scene',
          version: 5,
          name,
          slug,
          scene: foundryBaseScene(map, crop, st.ppg, st.foundryGrid, ambiance),
          levels: levelsData(),
          links: foundryLinks(map, crop, st.ppg),
          images,
        };
        downloadBlob(new Blob([JSON.stringify(pack)], { type: 'application/json' }), `${slug}.foundry.json`);
      } else {
        const base = `${st.imageDir ? st.imageDir + '/' : ''}${slug}`;
        const files: ZipEntry[] = [];
        const tiles = await tileImages();
        for (const [key, t] of tiles) if (!t.src) files.push({ name: `${slug}/tiles/${key}.${t.ext}`, data: t.blob });
        const roofZ = roofElevation(map);
        const levels = levelsData();
        for (let i = 0; i < nLevels; i++) {
          const img = `${levelSlug(i)}.${ext}`;
          files.push({ name: `${slug}/${img}`, data: await renderLevel(i) });
          const lv = levels[i];
          const scene = {
            ...foundryBaseScene(map, crop, st.ppg, st.foundryGrid, ambiance),
            name: nLevels > 1 ? `${name} — ${lv.name}` : name,
            background: { src: `${base}/${img}` },
            walls: lv.walls,
            lights: lv.lights,
            drawings: lv.drawings,
            tiles: lv.tiles.map((t) => {
              const ti = tiles.get(String(t.image));
              return { ...staticTile(t, roofZ, st.zipGen === 'v14'), texture: { src: ti?.src ?? `${base}/tiles/${t.image}.${ti?.ext ?? extOf(tileFormat)}` } };
            }),
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
