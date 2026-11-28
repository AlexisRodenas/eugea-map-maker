// Petits utilitaires DOM sans framework.

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function section(title: string, body: (Child | Child[])[], open = true, extra?: HTMLElement): HTMLElement {
  const d = h('details', { class: 'section', open }, h('summary', {}, h('span', {}, title), extra ?? null), h('div', { class: 'section-body' }, ...body));
  return d;
}

export function field(label: string, ...inputs: (Child | Child[])[]): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('span', { class: 'field-input' }, ...inputs));
}

export function numberInput(value: number, opts: { min?: number; max?: number; step?: number; onChange: (v: number) => void; width?: string }): HTMLInputElement {
  const el = h('input', { type: 'number', value: String(value), min: opts.min, max: opts.max, step: opts.step ?? 1, class: 'num', style: { width: opts.width ?? '64px' } });
  el.addEventListener('change', () => {
    let v = parseFloat(el.value);
    if (isNaN(v)) v = value;
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    el.value = String(v);
    opts.onChange(v);
  });
  return el;
}

export function range(value: number, min: number, max: number, step: number, onInput: (v: number) => void, fmt?: (v: number) => string): HTMLElement {
  const out = h('span', { class: 'range-val' }, fmt ? fmt(value) : String(value));
  const el = h('input', { type: 'range', min, max, step, value: String(value) });
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    out.textContent = fmt ? fmt(v) : String(v);
    onInput(v);
  });
  return h('span', { class: 'range' }, el, out);
}

export function select<T extends string>(options: [T, string][], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const el = h('select', {}, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  el.addEventListener('change', () => onChange(el.value as T));
  return el;
}

export function segmented<T extends string | number>(options: [T, string, string?][], value: T, onChange: (v: T) => void): HTMLElement {
  const wrap = h('div', { class: 'segmented' });
  for (const [v, label, title] of options) {
    const b = h('button', { class: v === value ? 'on' : '', title: title ?? label, type: 'button' }, label);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onChange(v);
    });
    wrap.append(b);
  }
  return wrap;
}

export function checkbox(label: string, value: boolean, onChange: (v: boolean) => void, title?: string): HTMLElement {
  const el = h('input', { type: 'checkbox', checked: value });
  el.addEventListener('change', () => onChange(el.checked));
  return h('label', { class: 'check', title }, el, h('span', {}, label));
}

export function colorInput(value: string, onInput: (v: string) => void): HTMLInputElement {
  const el = h('input', { type: 'color', value });
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

export function button(label: string | Node, onClick: () => void, cls = '', title?: string): HTMLButtonElement {
  const b = h('button', { class: cls, type: 'button', title }, label);
  b.addEventListener('click', onClick);
  return b;
}

// ---------- Fenêtres modales ----------

export interface Modal {
  el: HTMLElement;
  close: () => void;
}

export function modal(title: string, body: HTMLElement, opts: { wide?: boolean; onClose?: () => void } = {}): Modal {
  const root = document.getElementById('modal-root')!;
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') }, h('div', { class: 'modal-head' }, h('h2', {}, title), button('✕', close, 'icon ghost', 'Fermer')), body);
  const back = h('div', { class: 'modal-back' }, box);
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) close();
  });
  document.addEventListener('keydown', onKey, true);
  root.append(back);
  return { el: box, close };
}

let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), kind === 'error' ? 6000 : 3000);
}

// ---------- Icônes (SVG, trait) ----------

const I = (d: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const ICONS: Record<string, string> = {
  select: I('<path d="M5 3l13 8-6 1.5L9 19z"/>'),
  room: I('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 9h16M9 5v14" opacity=".35"/>'),
  brush: I('<path d="M14 4l6 6-8 8H6v-6z"/><path d="M11 7l6 6"/>'),
  erase: I('<path d="M8 20h12"/><path d="M4.5 14.5l9-9a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8L13 18H8.5z"/><path d="M9 10l5 5"/>'),
  tree: I('<path d="M12 3l5 7h-3l4 6H6l4-6H7z"/><path d="M12 16v5"/>'),
  layers: I('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  fill: I('<path d="M5 11l7-7 7 7-7 7z"/><path d="M5 11h14"/><path d="M20 15s1.5 2 1.5 3a1.5 1.5 0 01-3 0c0-1 1.5-3 1.5-3z"/>'),
  wall: I('<path d="M3 6h18v12H3z"/><path d="M3 12h18M9 6v6M15 12v6"/>'),
  door: I('<path d="M6 21V4a1 1 0 011-1h10a1 1 0 011 1v17"/><path d="M3 21h18"/><circle cx="14.5" cy="12.5" r="1"/>'),
  prop: I('<path d="M4 9l8-5 8 5v8l-8 4-8-4z"/><path d="M4 9l8 4 8-4M12 13v8"/>'),
  light: I('<path d="M12 3c3 3.5 5 6 5 9a5 5 0 01-10 0c0-1.7.8-3 2-4.5.3 1.5 1 2.5 2 3-.5-2.5 0-5 1-7.5z"/>'),
  text: I('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  pan: I('<path d="M8 13V5.5a1.5 1.5 0 013 0V12M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7a7 7 0 01-7 7h-.5A6.5 6.5 0 014 15.5l-1-3a1.5 1.5 0 012.6-1.3L8 14"/>'),
  new: I('<path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>'),
  open: I('<path d="M3 7a1 1 0 011-1h5l2 2h8a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1z"/>'),
  save: I('<path d="M5 3h11l3 3v14a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
  undo: I('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),
  redo: I('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),
  dice: I('<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 2v20M3 7l9 5 9-5"/>'),
  export: I('<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>'),
  grid: I('<path d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16"/>'),
  roof: I('<path d="M3 12l9-7 9 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>'),
  eye: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  help: I('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01"/>'),
  trash: I('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  copy: I('<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>'),
  rotL: I('<path d="M4 4v6h6"/><path d="M4.5 10A8 8 0 1112 20"/>'),
  rotR: I('<path d="M20 4v6h-6"/><path d="M19.5 10A8 8 0 1012 20"/>'),
  fit: I('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  rampart: I('<path d="M3 20V9h3v2h2V9h3v2h2V9h3v2h2V9h3v11z"/><path d="M10 20v-4a2 2 0 014 0v4"/>'),
  passage: I('<path d="M4 20h4v-4h4v-4h4V8h4"/><path d="M15 4h5v5"/><path d="M20 4l-6 6"/>'),
  scatter: I('<circle cx="7" cy="8" r="2.5"/><circle cx="16" cy="6" r="2"/><circle cx="12" cy="14" r="3"/><circle cx="18" cy="17" r="2"/><circle cx="6" cy="18" r="1.5"/>'),
};

export function icon(name: string): HTMLElement {
  return h('span', { class: 'ico', html: ICONS[name] ?? '' });
}
