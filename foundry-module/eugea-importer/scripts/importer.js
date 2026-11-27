// Eugéa Importer — importe les fichiers « .foundry.json » exportés par Eugéa.
// Compatible Foundry VTT v11 à v14. Les cartes à plusieurs étages deviennent des niveaux
// natifs (V14+) ou une scène par étage, regroupées dans un dossier.

const MODULE_ID = 'eugea-importer';
const ROOT_DIR = 'eugea';
const STAIRS_LINK = true;

const t = (key, data) => (data ? game.i18n.format(`EUGEA.${key}`, data) : game.i18n.localize(`EUGEA.${key}`));

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'levelMode', {
    name: 'EUGEA.Settings.LevelMode.Name',
    hint: 'EUGEA.Settings.LevelMode.Hint',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      auto: 'EUGEA.Settings.LevelMode.Auto',
      native: 'EUGEA.Settings.LevelMode.Native',
      scenes: 'EUGEA.Settings.LevelMode.Scenes',
    },
    default: 'auto',
  });
});

// ---------- Fichiers ----------

function filePicker() {
  return foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

function storageSource() {
  // The Forge utilise sa propre source de fichiers
  return typeof ForgeVTT !== 'undefined' && ForgeVTT?.usingTheForge ? 'forgevtt' : 'data';
}

async function ensureDir(FP, source, dir) {
  try {
    await FP.browse(source, dir);
  } catch {
    try {
      await FP.createDirectory(source, dir);
    } catch (e) {
      console.warn(`${MODULE_ID} | dossier ${dir}`, e);
    }
  }
}

function base64ToFile(b64, name, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

async function uploadImages(pack) {
  const FP = filePicker();
  const source = storageSource();
  const slug = (pack.slug || 'carte').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const dir = `${ROOT_DIR}/${slug}-${Date.now().toString(36)}`;
  await ensureDir(FP, source, ROOT_DIR);
  await ensureDir(FP, source, dir);
  const paths = {};
  for (const [key, img] of Object.entries(pack.images)) {
    const file = base64ToFile(img.data, img.name, img.mime || 'image/webp');
    const res = await FP.upload(source, dir, file, {}, { notify: false });
    paths[key] = res?.path ?? `${dir}/${img.name}`;
  }
  return paths;
}

// ---------- Construction des scènes ----------

function baseScene(pack, gen) {
  const data = foundry.utils.deepClone(pack.scene);
  if (gen >= 12) {
    // remplacés par scene.environment / scene.fog depuis la v12
    delete data.darkness;
    delete data.globalLight;
    delete data.fogExploration;
  } else {
    delete data.environment;
    delete data.fog;
  }
  return data;
}

function tilesOf(level, paths, extra = {}) {
  return (level.tiles ?? []).map(({ image, ...tile }) => ({ ...tile, ...extra, texture: { src: paths[image] } }));
}

function placeables(level, paths, extra = {}) {
  return {
    walls: (level.walls ?? []).map((w) => ({ ...w, ...extra.walls })),
    lights: (level.lights ?? []).map((l) => ({ ...l, ...extra.lights })),
    drawings: (level.drawings ?? []).map((d) => ({ ...d, ...extra.drawings })),
    tiles: tilesOf(level, paths, extra.tiles),
  };
}

async function thumbnail(scene) {
  try {
    const th = await scene.createThumbnail();
    if (th?.thumb) await scene.update({ thumb: th.thumb });
  } catch (e) {
    console.warn(`${MODULE_ID} | miniature`, e);
  }
}

async function createSingle(pack, base, paths) {
  const level = pack.levels[0];
  const SceneCls = CONFIG.Scene.documentClass;
  const scene = await SceneCls.create({ ...base, name: pack.name, background: { src: paths[level.image] }, ...placeables(level, paths) });
  await thumbnail(scene);
  return scene;
}

/** V11–V13 (ou au choix) : une scène par étage, dans un dossier, avec la barre de navigation. */
async function createPerLevel(pack, base, paths) {
  const SceneCls = CONFIG.Scene.documentClass;
  const folder = await Folder.create({ name: pack.name, type: 'Scene' });
  const levels = [...pack.levels].sort((a, b) => a.z - b.z);
  let main = null;
  for (let k = 0; k < levels.length; k++) {
    const level = levels[k];
    const scene = await SceneCls.create({
      ...base,
      name: `${pack.name} — ${level.name}`,
      folder: folder.id,
      navigation: true,
      navName: level.name,
      navOrder: k,
      background: { src: paths[level.image] },
      ...placeables(level, paths),
      flags: { ...(base.flags ?? {}), eugea: { ...(base.flags?.eugea ?? {}), level: level.z } },
    });
    await thumbnail(scene);
    if (level.z === 0 || !main) main = scene;
  }
  return main;
}

/** Foundry V14+ : une seule scène avec des niveaux natifs. */
async function createNative(pack, base, paths) {
  const SceneCls = CONFIG.Scene.documentClass;
  const levels = [...pack.levels].sort((a, b) => a.z - b.z);
  const ids = levels.map(() => foundry.utils.randomID());
  const data = { ...base, name: pack.name, walls: [], lights: [], drawings: [], tiles: [] };
  data.levels = levels.map((l, k) => ({
    _id: ids[k],
    name: l.name,
    sort: k,
    elevation: { bottom: l.bottom, top: l.top },
    background: { src: paths[l.image] },
  }));
  const ground = levels.find((l) => l.z === 0) ?? levels[0];
  data.initialLevel = ids[levels.indexOf(ground)];
  levels.forEach((l, k) => {
    const lv = [ids[k]];
    const p = placeables(l, paths, {
      walls: { levels: lv },
      lights: { levels: lv, elevation: l.bottom },
      drawings: { levels: lv, elevation: l.bottom },
      tiles: { levels: lv, elevation: l.bottom },
    });
    data.walls.push(...p.walls);
    data.lights.push(...p.lights);
    data.drawings.push(...p.drawings);
    data.tiles.push(...p.tiles);
  });
  const scene = await SceneCls.create(data);
  if (STAIRS_LINK) await linkStairs(scene, levels, ids);
  await thumbnail(scene);
  return scene;
}

/** Zones « Changer de niveau » sur les escaliers (reliés au niveau du dessus, sinon du dessous). */
async function linkStairs(scene, levels, ids) {
  const regions = [];
  const seen = [];
  levels.forEach((l, k) => {
    const other = k + 1 < levels.length ? k + 1 : k - 1;
    if (other < 0) return;
    for (const s of l.stairs ?? []) {
      const pair = [Math.min(k, other), Math.max(k, other)];
      const dup = seen.some((o) => o.pair[0] === pair[0] && o.pair[1] === pair[1] && Math.abs(o.x - s.x) < s.width && Math.abs(o.y - s.y) < s.height);
      if (dup) continue;
      seen.push({ pair, x: s.x, y: s.y });
      const lo = levels[pair[0]],
        hi = levels[pair[1]];
      regions.push({
        name: t('StairsRegion'),
        shapes: [{ type: 'rectangle', x: s.x, y: s.y, width: s.width, height: s.height, rotation: 0, hole: false }],
        levels: [ids[pair[0]], ids[pair[1]]],
        elevation: { bottom: lo.bottom, top: hi.top },
        behaviors: [{ name: t('ChangeLevel'), type: 'changeLevel', system: {} }],
      });
    }
  });
  if (!regions.length) return;
  try {
    await scene.createEmbeddedDocuments('Region', regions);
  } catch (e) {
    console.warn(`${MODULE_ID} | escaliers`, e);
    ui.notifications.warn(t('StairsFailed'));
  }
}

// ---------- Import ----------

async function importPack(pack) {
  if (pack?.format !== 'eugea-scene' || !Array.isArray(pack.levels) || !pack.levels.length || !pack.images) {
    throw new Error(t('Errors.NotEugea'));
  }
  const gen = game.release?.generation ?? 11;
  const paths = await uploadImages(pack);
  const base = baseScene(pack, gen);
  let scene;
  if (pack.levels.length === 1) scene = await createSingle(pack, base, paths);
  else {
    const mode = game.settings.get(MODULE_ID, 'levelMode');
    const native = mode === 'native' || (mode === 'auto' && gen >= 14);
    if (native) {
      try {
        scene = await createNative(pack, base, paths);
      } catch (e) {
        console.warn(`${MODULE_ID} | niveaux natifs`, e);
        ui.notifications.warn(t('NativeFallback', { error: e.message ?? e }));
        scene = await createPerLevel(pack, base, paths);
      }
    } else scene = await createPerLevel(pack, base, paths);
  }
  const count = (k) => pack.levels.reduce((n, l) => n + (l[k]?.length ?? 0), 0);
  ui.notifications.info(t('Done', { name: pack.name, levels: pack.levels.length, walls: count('walls'), lights: count('lights'), tiles: count('tiles') }));
  await scene?.view();
  return scene;
}

function pickAndImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      ui.notifications.info(t('Importing'));
      await importPack(JSON.parse(await f.text()));
    } catch (e) {
      console.error(MODULE_ID, e);
      ui.notifications.error(t('Errors.Failed', { error: e.message ?? e }));
    }
  });
  input.click();
}

Hooks.on('renderSceneDirectory', (_app, html) => {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector('.eugea-import')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'eugea-import';
  btn.innerHTML = `<i class="fas fa-dungeon"></i> ${t('Button')}`;
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    pickAndImport();
  });
  const header = root.querySelector('.header-actions') ?? root.querySelector('.directory-header') ?? root;
  header.append(btn);
});

// Accessible depuis une macro : game.modules.get('eugea-importer').api.pick()
Hooks.once('ready', () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { pick: pickAndImport, importPack };
});
