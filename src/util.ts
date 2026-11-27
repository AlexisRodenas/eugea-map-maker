// ---------- Aléatoire déterministe ----------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private f: () => number;
  constructor(seed: number) {
    this.f = mulberry32(seed);
  }
  next(): number {
    return this.f();
  }
  float(a: number, b: number): number {
    return a + (b - a) * this.f();
  }
  /** Entier dans [a, b] inclus. */
  int(a: number, b: number): number {
    return a + Math.floor((b - a + 1) * this.f());
  }
  chance(p: number): boolean {
    return this.f() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.f() * arr.length)];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.f() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of items) total += w;
    let r = this.f() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r <= 0) return v;
    }
    return items[items.length - 1][0];
  }
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hash 2D -> [0, 1). Stable : sert aux détails procéduraux (hachures, textures). */
export function hash2(x: number, y: number, k = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(k | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bruit de valeur lissé dans [0, 1]. */
export function valueNoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, octaves: number, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * f, y * f, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// ---------- Couleurs ----------

export type RGBA = [number, number, number, number];

const colorCache = new Map<string, RGBA>();

export function parseColor(c: string): RGBA {
  const cached = colorCache.get(c);
  if (cached) return cached;
  let out: RGBA = [0, 0, 0, 1];
  const s = c.trim();
  if (s[0] === '#') {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((ch) => ch + ch).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    out = [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map((v) => parseFloat(v));
      out = [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? p[3] : 1];
    }
  }
  colorCache.set(c, out);
  return out;
}

function h2(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
}

export function toHex(c: string): string {
  const [r, g, b] = parseColor(c);
  return '#' + h2(r) + h2(g) + h2(b);
}

export function rgba(c: string, alpha?: number): string {
  const [r, g, b, a] = parseColor(c);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha ?? a})`;
}

/** Mélange c1 -> c2 (t = 0 : c1, t = 1 : c2). */
export function mix(c1: string, c2: string, t: number): string {
  const a = parseColor(c1);
  const b = parseColor(c2);
  const r = a[0] + (b[0] - a[0]) * t;
  const g = a[1] + (b[1] - a[1]) * t;
  const bl = a[2] + (b[2] - a[2]) * t;
  const al = a[3] + (b[3] - a[3]) * t;
  return al >= 0.999 ? '#' + h2(r) + h2(g) + h2(bl) : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(bl)},${al.toFixed(3)})`;
}

export function darken(c: string, t: number): string {
  return mix(c, '#000000', t);
}

export function lighten(c: string, t: number): string {
  return mix(c, '#ffffff', t);
}

export function luminance(c: string): number {
  const [r, g, b] = parseColor(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ---------- Divers ----------

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

let uidCounter = 0;
export function uid(): string {
  uidCounter = (uidCounter + 1) % 1e6;
  return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36) + uidCounter.toString(36);
}

export function bytesToBase64(u8: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function slugify(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'carte'
  );
}

export function randomSeed(): string {
  const words = ['ombre', 'braise', 'givre', 'crypte', 'rune', 'dague', 'corbeau', 'abime', 'ronce', 'cendre', 'spectre', 'gobelin', 'wyrm', 'liche', 'mousse', 'fer'];
  return words[Math.floor(Math.random() * words.length)] + '-' + Math.floor(Math.random() * 9000 + 1000);
}
