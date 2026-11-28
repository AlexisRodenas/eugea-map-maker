// Images personnelles.
//  - La bibliothèque : un dossier de l'ordinateur (arbres, coffres, tapis… en PNG / WebP / SVG),
//    parcouru à la demande, jamais copié en entier.
//  - Le magasin : les images réellement utilisées sur une carte, copiées dans le navigateur
//    (IndexedDB) pour survivre à un rechargement, et intégrées au fichier .eugea.json.

import type { SavedAsset } from './model';
import { base64ToBytes, bytesToBase64 } from './util';
import { crc32 } from './zip';

export interface Asset {
  id: string;
  name: string;
  mime: string;
  blob: Blob;
  img: HTMLImageElement;
  w: number; // taille naturelle (px)
  h: number;
  /** Chemin du fichier dans les données de Foundry (dossier connecté déclaré comme tel). */
  src?: string;
}

const IMAGE_EXT: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

export function extOfName(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function isImageName(name: string): boolean {
  return extOfName(name) in IMAGE_EXT;
}

export function mimeOfName(name: string): string {
  return IMAGE_EXT[extOfName(name)] ?? 'image/png';
}

export function extOfMime(mime: string, fallback = 'png'): string {
  for (const [ext, m] of Object.entries(IMAGE_EXT)) if (m === mime) return ext === 'jpeg' ? 'jpg' : ext;
  return fallback;
}

// ---------- IndexedDB ----------

const DB_NAME = 'eugea';
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  return dbPromise;
}

async function idb<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

interface StoredAsset {
  id: string;
  name: string;
  mime: string;
  blob: Blob;
  src?: string;
}

// ---------- Magasin ----------

const assets = new Map<string, Asset>();
const pending = new Map<string, Promise<Asset | null>>();
const missing = new Set<string>();
const listeners = new Set<() => void>();
let notifyQueued = false;

/** Prévenu quand une image devient disponible (pour redessiner). */
export function onAssetsChanged(cb: () => void): void {
  listeners.add(cb);
}

function notify(): void {
  if (notifyQueued) return;
  notifyQueued = true;
  setTimeout(() => {
    notifyQueued = false;
    listeners.forEach((cb) => cb());
  }, 30);
}

function decode(blob: Blob): Promise<{ img: HTMLImageElement; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, w: img.naturalWidth || 256, h: img.naturalHeight || 256 });
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = URL.createObjectURL(blob);
  });
}

async function register(s: StoredAsset): Promise<Asset> {
  const { img, w, h } = await decode(s.blob);
  const a: Asset = { ...s, img, w, h };
  assets.set(s.id, a);
  missing.delete(s.id);
  notify();
  return a;
}

/** Image prête à dessiner, ou null (le chargement est alors lancé en arrière-plan). */
export function assetImage(id: string): Asset | null {
  const a = assets.get(id);
  if (a) return a;
  if (!missing.has(id)) void loadAsset(id);
  return null;
}

export function loadAsset(id: string): Promise<Asset | null> {
  const a = assets.get(id);
  if (a) return Promise.resolve(a);
  let p = pending.get(id);
  if (!p) {
    p = idb<StoredAsset | undefined>('assets', 'readonly', (s) => s.get(id))
      .then((s) => (s ? register(s) : null))
      .catch(() => null)
      .then((r) => {
        pending.delete(id);
        if (!r) missing.add(id);
        return r;
      });
    pending.set(id, p);
  }
  return p;
}

/** Charge toutes les images demandées ; renvoie celles qui sont introuvables. */
export async function ensureAssets(ids: string[]): Promise<string[]> {
  const res = await Promise.all(ids.map((id) => loadAsset(id)));
  return ids.filter((_, i) => !res[i]);
}

/** Ajoute une image au magasin (identifiant tiré de son contenu : pas de doublon). */
export async function addAsset(blob: Blob, name: string, src?: string): Promise<Asset> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const id = `img-${crc32(bytes).toString(16).padStart(8, '0')}-${bytes.length.toString(36)}`;
  const known = assets.get(id) ?? (await loadAsset(id));
  if (known) {
    // même image, désormais connue dans Foundry : on retient son chemin
    if (src && known.src !== src) {
      known.src = src;
      try {
        await idb('assets', 'readwrite', (st) => st.put({ id, name: known.name, mime: known.mime, blob: known.blob, src } as StoredAsset));
      } catch {
        /* sans gravité */
      }
    }
    return known;
  }
  const mime = blob.type || mimeOfName(name);
  const s: StoredAsset = { id, name, mime, blob: new Blob([bytes], { type: mime }), src };
  try {
    await idb('assets', 'readwrite', (st) => st.put(s));
  } catch (e) {
    console.warn('Eugéa | stockage de l’image impossible', e);
  }
  return register(s);
}

/** Images à intégrer dans un fichier .eugea.json. */
export async function exportAssets(ids: string[]): Promise<Record<string, SavedAsset>> {
  const out: Record<string, SavedAsset> = {};
  for (const id of ids) {
    const a = await loadAsset(id);
    if (a) out[id] = { name: a.name, mime: a.mime, data: bytesToBase64(new Uint8Array(await a.blob.arrayBuffer())), ...(a.src ? { src: a.src } : {}) };
  }
  return out;
}

/** Images lues dans un fichier .eugea.json (conservent leur identifiant). */
export async function importAssets(rec: Record<string, SavedAsset> | undefined): Promise<void> {
  if (!rec) return;
  for (const [id, sa] of Object.entries(rec)) {
    if (assets.has(id)) continue;
    const s: StoredAsset = { id, name: sa.name, mime: sa.mime, blob: new Blob([base64ToBytes(sa.data)], { type: sa.mime }), src: sa.src };
    try {
      await idb('assets', 'readwrite', (st) => st.put(s));
    } catch {
      /* le fichier reste utilisable pour cette session */
    }
    try {
      await register(s);
    } catch (e) {
      console.warn('Eugéa | image intégrée illisible', id, e);
    }
  }
}

// ---------- Bibliothèque (dossier connecté) ----------

export interface LibEntry {
  path: string; // chemin relatif dans le dossier
  name: string; // nom sans extension
  folder: string; // sous-dossier ('' = racine)
  getFile(): Promise<File>;
}

export type LibStatus = 'none' | 'permission' | 'scanning' | 'ready';

interface LibPrefs {
  ppc: number; // pixels de l'image pour une case
  /** Si le dossier connecté est dans les données de Foundry : son chemin (ex. assets/Owidyn/Map cuties). */
  foundry?: string;
  folder: string;
  query: string;
}

const PREFS_KEY = 'eugea:library';
const MAX_ENTRIES = 40000;

/* eslint-disable @typescript-eslint/no-explicit-any */
type DirHandle = any;

class Library {
  name = '';
  status: LibStatus = 'none';
  entries: LibEntry[] = [];
  folders: string[] = [];
  prefs: LibPrefs = { ppc: 200, folder: '', query: '' };
  private handle: DirHandle | null = null;
  private thumbs = new Map<string, string>();
  private listeners = new Set<() => void>();

  /** Prévenu quand le dossier change (connexion, lecture terminée...). */
  onChange(cb: () => void): void {
    this.listeners.add(cb);
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb());
  }

  constructor() {
    try {
      Object.assign(this.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));
    } catch {
      /* défauts */
    }
  }

  savePrefs(): void {
    localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
  }

  /** Le navigateur peut-il mémoriser le dossier d'une session à l'autre ? */
  get persistent(): boolean {
    return typeof (window as any).showDirectoryPicker === 'function';
  }

  /** Au démarrage : retrouve le dossier connecté la dernière fois. */
  async restore(): Promise<void> {
    if (!this.persistent) return;
    try {
      const h = await idb<DirHandle | undefined>('kv', 'readonly', (s) => s.get('library'));
      if (!h) return;
      this.handle = h;
      this.name = h.name;
      const perm = await h.queryPermission?.({ mode: 'read' });
      if (perm === 'granted') await this.scan();
      else {
        this.status = 'permission';
        this.emit();
      }
    } catch (e) {
      console.warn('Eugéa | bibliothèque', e);
    }
  }

  /** Redonne l'accès au dossier mémorisé (doit suivre un clic). */
  async reconnect(): Promise<void> {
    if (!this.handle) return this.connect();
    const perm = await this.handle.requestPermission?.({ mode: 'read' });
    if (perm === 'granted') await this.scan();
  }

  async connect(): Promise<void> {
    if (this.persistent) {
      let h: DirHandle;
      try {
        h = await (window as any).showDirectoryPicker({ id: 'eugea-images', mode: 'read' });
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        return this.connectWithInput();
      }
      this.handle = h;
      this.name = h.name;
      this.prefs.folder = '';
      this.savePrefs();
      try {
        await idb('kv', 'readwrite', (s) => s.put(h, 'library'));
      } catch {
        /* non mémorisé : il faudra le reconnecter */
      }
      await this.scan();
      return;
    }
    return this.connectWithInput();
  }

  /** Navigateurs sans accès aux dossiers (Firefox…) : sélection classique, valable pour la session. */
  private connectWithInput(): Promise<void> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      (input as any).webkitdirectory = true;
      input.addEventListener('change', () => {
        const files = [...(input.files ?? [])].filter((f) => isImageName(f.name));
        const first = (files[0] as any)?.webkitRelativePath as string | undefined;
        this.handle = null;
        this.name = first ? first.split('/')[0] : 'Images';
        this.prefs.folder = '';
        this.setEntries(
          files.slice(0, MAX_ENTRIES).map((f) => {
            const rel = ((f as any).webkitRelativePath as string) || f.name;
            return this.entry(rel.split('/').slice(1).join('/') || f.name, () => Promise.resolve(f));
          }),
        );
        resolve();
      });
      input.click();
    });
  }

  disconnect(): void {
    this.handle = null;
    this.name = '';
    this.status = 'none';
    this.entries = [];
    this.folders = [];
    for (const u of this.thumbs.values()) URL.revokeObjectURL(u);
    this.thumbs.clear();
    void idb('kv', 'readwrite', (s) => s.delete('library')).catch(() => undefined);
    this.emit();
  }

  async rescan(): Promise<void> {
    if (this.handle) await this.scan();
  }

  private entry(path: string, getFile: () => Promise<File>): LibEntry {
    const parts = path.split('/');
    const file = parts.pop()!;
    return { path, name: file.replace(/\.[^.]+$/, ''), folder: parts.join('/'), getFile };
  }

  private setEntries(list: LibEntry[]): void {
    list.sort((a, b) => a.path.localeCompare(b.path, 'fr', { numeric: true }));
    this.entries = list;
    const folders = new Set<string>();
    for (const e of list) {
      const parts = e.folder ? e.folder.split('/') : [];
      for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
    }
    this.folders = [...folders].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
    if (this.prefs.folder && !folders.has(this.prefs.folder)) this.prefs.folder = '';
    this.status = 'ready';
    this.emit();
  }

  private async scan(): Promise<void> {
    const root = this.handle;
    if (!root) return;
    this.status = 'scanning';
    this.emit();
    const out: LibEntry[] = [];
    const walk = async (dir: DirHandle, prefix: string): Promise<void> => {
      for await (const h of dir.values()) {
        if (out.length >= MAX_ENTRIES) return;
        if (h.name.startsWith('.') || h.name === '__MACOSX') continue;
        const path = prefix ? `${prefix}/${h.name}` : h.name;
        if (h.kind === 'directory') await walk(h, path);
        else if (isImageName(h.name)) out.push(this.entry(path, () => h.getFile()));
      }
    };
    try {
      await walk(root, '');
    } catch (e) {
      console.warn('Eugéa | lecture du dossier', e);
    }
    this.setEntries(out);
  }

  /** Entrées du sous-dossier choisi (et de ses sous-dossiers), filtrées par la recherche. */
  visible(): LibEntry[] {
    const f = this.prefs.folder;
    const q = this.prefs.query
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
    return this.entries.filter((e) => {
      if (f && e.folder !== f && !e.folder.startsWith(f + '/')) return false;
      if (!q) return true;
      return e.path
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .includes(q);
    });
  }

  async thumb(e: LibEntry): Promise<string> {
    let u = this.thumbs.get(e.path);
    if (!u) {
      u = URL.createObjectURL(await e.getFile());
      this.thumbs.set(e.path, u);
    }
    return u;
  }

  /** Copie l'image dans le magasin pour l'utiliser sur la carte. */
  async use(e: LibEntry): Promise<Asset> {
    const f = await e.getFile();
    const root = (this.prefs.foundry ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return addAsset(f, e.name, root ? `${root}/${e.path}` : undefined);
  }

  /** Taille par défaut sur la carte (en cases) selon la résolution de la bibliothèque. */
  sizeOf(a: Asset): { w: number; h: number } {
    const ppc = Math.max(10, this.prefs.ppc || 200);
    const r = (v: number) => Math.max(0.25, Math.min(40, Math.round((v / ppc) * 20) / 20));
    return { w: r(a.w), h: r(a.h) };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const library = new Library();
