// Onglet « Mes images » de l'outil Objets : dossier connecté, vignettes, habillage des objets intégrés.

import type { App } from './app';
import { Asset, LibEntry, assetImage, library } from './assets';
import { PROPS, PROP_BY_KIND } from './props';
import { button, field, h, modal, numberInput, select, toast } from './ui';

const PAGE = 120;
let shown = PAGE;
let observer: IntersectionObserver | null = null;

/** Vignettes chargées seulement quand elles deviennent visibles. */
function lazyThumbs(root: HTMLElement): IntersectionObserver {
  observer?.disconnect();
  observer = new IntersectionObserver(
    (list) => {
      for (const it of list) {
        if (!it.isIntersecting) continue;
        const img = it.target as HTMLImageElement & { entry?: LibEntry };
        observer?.unobserve(img);
        if (img.entry)
          library
            .thumb(img.entry)
            .then((u) => (img.src = u))
            .catch(() => img.classList.add('broken'));
      }
    },
    { root, rootMargin: '200px' },
  );
  return observer;
}

/** Choisit un objet intégré à remplacer par une image. */
export function pickSkinTarget(app: App, a: Asset): void {
  const grid = h('div', { class: 'prop-grid wide' });
  for (const def of PROPS.filter((d) => d.cat)) {
    const cv = h('canvas', { width: 96, height: 96 });
    app.drawThumb(cv, def.kind, false);
    const b = h('button', { class: 'prop-btn', type: 'button', title: def.name }, cv, h('span', {}, def.name));
    b.addEventListener('click', () => {
      app.edit();
      const skins = app.map.settings.skins;
      const list = (skins[def.kind] ??= []);
      if (!list.includes(a.id)) list.push(a.id);
      app.changed(false);
      md.close();
      app.renderPanel();
      toast(`« ${a.name} » remplace désormais « ${def.name} » sur cette carte${list.length > 1 ? ` (${list.length} variantes au hasard)` : ''}.`, 'ok');
    });
    grid.append(b);
  }
  const body = h(
    'div',
    { class: 'form' },
    h('p', { class: 'help' }, `Tous les « objets » de ce type, déjà posés ou générés plus tard, seront dessinés avec « ${a.name} ». Plusieurs images pour le même objet : une variante au hasard pour chacun.`),
    grid,
  );
  const md = modal('Remplacer un objet intégré par cette image', body, { wide: true });
}

function skinsList(app: App): HTMLElement | null {
  const skins = app.map.settings.skins;
  const kinds = Object.keys(skins).filter((k) => skins[k]?.length && PROP_BY_KIND[k]);
  if (!kinds.length) return null;
  const wrap = h('div', { class: 'skins' });
  for (const k of kinds) {
    const row = h('div', { class: 'skin-row' }, h('span', { class: 'skin-name' }, PROP_BY_KIND[k].name));
    for (const id of skins[k]) {
      const a = assetImage(id);
      const chip = h('button', { class: 'skin-chip', type: 'button', title: `${a?.name ?? 'Image'} — cliquer pour retirer` });
      if (a) chip.append(h('img', { src: a.img.src, alt: '' }));
      else chip.textContent = '?';
      chip.addEventListener('click', () => {
        app.edit();
        skins[k] = skins[k].filter((x) => x !== id);
        if (!skins[k].length) delete skins[k];
        app.changed(false);
        app.renderPanel();
      });
      row.append(chip);
    }
    wrap.append(row);
  }
  return h('div', {}, h('div', { class: 'sub-title' }, 'Objets habillés sur cette carte'), wrap, h('p', { class: 'help' }, 'Cliquer sur une image pour la retirer.'));
}

/**
 * Contenu de l'onglet. `selected` : chemin de l'image choisie ; `onPick` : image prête à poser.
 */
export function libraryView(app: App, selected: string, onPick: (a: Asset, e: LibEntry) => void): HTMLElement {
  const root = h('div', { class: 'library' });
  const add = (...xs: (Node | string | null)[]): void => xs.forEach((x) => x !== null && root.append(x));
  const st = library.status;
  if (st === 'none') {
    add(
      h('p', { class: 'help' }, 'Connectez un dossier d’images (PNG, WebP, SVG…) : arbres, coffres, tapis, packs d’assets… Elles se posent comme les objets intégrés, peuvent remplacer leur dessin, et partent dans Foundry en tuiles.'),
      button('Connecter un dossier…', () => void library.connect(), 'primary'),
      library.persistent ? null : h('p', { class: 'help' }, 'Ce navigateur ne mémorise pas le dossier : il faudra le reconnecter à chaque session (les images déjà posées restent enregistrées).'),
      skinsList(app),
    );
    return root;
  }
  if (st === 'permission') {
    add(
      h('p', { class: 'help' }, `Dossier « ${library.name} » : le navigateur demande de confirmer l’accès.`),
      h('div', { class: 'row-actions' }, button('Autoriser l’accès', () => void library.reconnect(), 'primary'), button('Autre dossier…', () => void library.connect(), 'small')),
      skinsList(app),
    );
    return root;
  }
  if (st === 'scanning') {
    add(h('p', { class: 'help' }, `Lecture de « ${library.name} »…`));
    return root;
  }

  const prefs = library.prefs;
  const head = h(
    'div',
    { class: 'lib-head' },
    h('span', { class: 'lib-name', title: library.name }, library.name),
    h('span', { class: 'muted' }, `${library.entries.length} images`),
    library.persistent ? button('↻', () => void library.rescan(), 'icon', 'Relire le dossier') : null,
    button('Changer…', () => void library.connect(), 'small'),
    button('✕', () => library.disconnect(), 'icon', 'Déconnecter'),
  );
  const folderOpts: [string, string][] = [['', 'Tous les dossiers'], ...library.folders.map((f) => [f, '  '.repeat(f.split('/').length - 1) + f.split('/').pop()] as [string, string])];
  const folderSel = select(folderOpts, prefs.folder, (v) => {
    prefs.folder = v;
    library.savePrefs();
    shown = PAGE;
    fillGrid();
  });
  const search = h('input', { type: 'search', class: 'grow', placeholder: 'Rechercher (arbre, chest…)', value: prefs.query });
  let timer = 0;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      prefs.query = search.value;
      library.savePrefs();
      shown = PAGE;
      fillGrid();
    }, 200);
  });
  const grid = h('div', { class: 'prop-grid lib-grid' });
  const more = h('div', {});
  const fillGrid = () => {
    grid.innerHTML = '';
    more.innerHTML = '';
    const obs = lazyThumbs(app.panelElement);
    const list = library.visible();
    for (const e of list.slice(0, shown)) {
      const img = h('img', { alt: '', draggable: false }) as HTMLImageElement & { entry?: LibEntry };
      img.entry = e;
      const b = h('button', { class: 'prop-btn' + (e.path === selected ? ' on' : ''), type: 'button', title: `${e.path}\nClic : poser · Clic droit : remplacer un objet intégré` }, img, h('span', {}, e.name));
      b.addEventListener('click', async () => {
        try {
          const a = await library.use(e);
          grid.querySelectorAll('.prop-btn').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          selected = e.path;
          onPick(a, e);
        } catch (err) {
          toast('Image illisible : ' + (err as Error).message, 'error');
        }
      });
      b.addEventListener('contextmenu', async (ev) => {
        ev.preventDefault();
        try {
          pickSkinTarget(app, await library.use(e));
        } catch (err) {
          toast('Image illisible : ' + (err as Error).message, 'error');
        }
      });
      grid.append(b);
      obs.observe(img);
    }
    if (!list.length) grid.append(h('p', { class: 'help' }, 'Aucune image ici.'));
    if (list.length > shown)
      more.append(
        button(`Afficher plus (${list.length - shown} restantes)`, () => {
          shown += PAGE * 2;
          fillGrid();
        }, 'small'),
      );
  };
  fillGrid();
  add(
    head,
    library.folders.length ? field('Dossier', folderSel) : null,
    search,
    grid,
    more,
    field(
      'Échelle',
      numberInput(prefs.ppc, {
        min: 10,
        max: 2000,
        step: 10,
        onChange: (v) => {
          prefs.ppc = v;
          library.savePrefs();
        },
      }),
      h('span', { class: 'muted' }, 'px = 1 case'),
    ),
    h('p', { class: 'help' }, 'Clic droit sur une image : l’utiliser à la place d’un objet intégré (arbres, coffres…), y compris dans les cartes générées.'),
    skinsList(app),
  );
  return root;
}
