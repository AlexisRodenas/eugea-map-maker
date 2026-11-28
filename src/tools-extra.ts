// Outils « Rempart » (murailles, palissades) et « Passage » (téléportations entre deux points,
// sur le même niveau ou d'un étage à l'autre).
import type { App } from './app';
import type { PInfo, Tool } from './tools';
import { Passage, PassageEnd, Rampart, RampartStyle } from './model';
import { RAMPART_STYLES, cutGate, hitRampart, nearestVertex, rampartPoints, towerSize } from './ramparts';
import { button, checkbox, field, h, range, section, segmented } from './ui';
import { uid } from './util';

const ACCENT = '#4cc2ff';
const PURPLE = '#b07cff';

export interface RampartOpts {
  rampartStyle: RampartStyle;
  rampartWidth: number;
  rampartTowers: boolean;
}

// ---------- Rempart ----------

export function rampartTool(app: App): Tool {
  const o = app.opts;
  let pts: number[] | null = null; // sommets absolus du tracé en cours
  let lastDown = { t: 0, x: 0, y: 0 };
  let drag: { r: Rampart; i: number; moved: boolean } | null = null;
  const snap = (p: { wx: number; wy: number; alt: boolean }): [number, number] => (p.alt ? [p.wx, p.wy] : [Math.round(p.wx * 2) / 2, Math.round(p.wy * 2) / 2]);

  const finish = (closed: boolean) => {
    if (pts && pts.length >= 4) {
      const x = pts[0],
        y = pts[1];
      const r: Rampart = {
        id: uid(),
        x,
        y,
        pts: pts.map((v, i) => +(v - (i % 2 ? y : x)).toFixed(3)),
        closed: closed && pts.length >= 6,
        width: o.rampartWidth,
        style: o.rampartStyle,
        towers: o.rampartTowers,
      };
      app.edit();
      app.map.ramparts.push(r);
      app.selection.clear();
      app.selection.add(r.id);
      app.changed(true);
      app.renderPanel();
    }
    pts = null;
    app.requestRender();
  };

  /** Muraille fermée autour du contenu du niveau (marge de 2 cases). */
  const surround = () => {
    const b = app.map.contentBounds();
    if (!b) {
      app.toast('Le niveau est vide.');
      return;
    }
    const m = 2;
    const x0 = Math.max(0.5, b.x0 - m + 0.5),
      y0 = Math.max(0.5, b.y0 - m + 0.5);
    const x1 = Math.min(app.map.cols - 0.5, b.x1 + m - 0.5),
      y1 = Math.min(app.map.rows - 0.5, b.y1 + m - 0.5);
    pts = [x0, y0, x1, y0, x1, y1, x0, y1];
    finish(true);
    app.toast('Muraille posée. Pour une porte : coupez-la (sélection → Supprimer un sommet) ou posez une « Porte fortifiée » par-dessus.', 'ok');
  };

  const tool: Tool = {
    id: 'rampart',
    name: 'Rempart',
    key: 'm',
    icon: 'rampart',
    hint: 'Clic : ajouter un sommet · Double-clic, Entrée ou clic droit : terminer · Clic sur le premier sommet : fermer · Maj + clic sur un rempart : percer une porte · Glisser un sommet : le déplacer · Alt : libre',
    down(p: PInfo) {
      const [x, y] = snap(p);
      if (p.button === 2) {
        if (pts) finish(false);
        else {
          const r = [...app.map.ramparts].reverse().find((q) => hitRampart(q, p.wx, p.wy));
          if (r) {
            app.edit();
            app.map.ramparts = app.map.ramparts.filter((q) => q !== r);
            app.selection.delete(r.id);
            app.changed(true);
            app.renderPanel();
          }
        }
        return;
      }
      if (p.shift && !pts) {
        const r = [...app.map.ramparts].reverse().find((q) => hitRampart(q, p.wx, p.wy));
        const cut = r && cutGate(r, p.wx, p.wy);
        if (r && cut) {
          app.edit();
          app.map.ramparts = app.map.ramparts.flatMap((q) => (q === r ? cut.parts : [q]));
          app.map.props.push(cut.gate);
          app.selection.clear();
          app.changed(true);
          app.renderPanel();
        } else app.toast(r ? 'Tronçon trop court pour une porte.' : 'Maj + clic sur un rempart pour y percer une porte.');
        return;
      }
      const now = performance.now();
      const dbl = now - lastDown.t < 350 && Math.hypot(x - lastDown.x, y - lastDown.y) < 0.3;
      lastDown = { t: now, x, y };
      if (pts) {
        if (dbl) {
          finish(false);
          return;
        }
        if (pts.length >= 6 && Math.hypot(x - pts[0], y - pts[1]) < 0.35) {
          finish(true);
          return;
        }
        const n = pts.length;
        if (Math.hypot(x - pts[n - 2], y - pts[n - 1]) > 0.01) pts.push(x, y);
        app.requestRender();
        return;
      }
      const v = nearestVertex(app.map.ramparts, p.wx, p.wy, Math.max(0.3, 8 / app.view.scale));
      if (v) {
        drag = { ...v, moved: false };
        app.selection.clear();
        app.selection.add(v.r.id);
        app.selectionChanged();
        return;
      }
      pts = [x, y];
      app.requestRender();
    },
    move(p, dragging) {
      if (drag && dragging) {
        const [x, y] = snap(p);
        if (!drag.moved) {
          app.edit();
          drag.moved = true;
          // l'objet a été recopié par l'historique : on retrouve le rempart courant
          drag.r = app.map.ramparts.find((q) => q.id === drag!.r.id) ?? drag.r;
        }
        drag.r.pts[drag.i] = +(x - drag.r.x).toFixed(3);
        drag.r.pts[drag.i + 1] = +(y - drag.r.y).toFixed(3);
        app.changed(true);
        return;
      }
      app.requestRender();
    },
    up() {
      drag = null;
    },
    onKey(e) {
      if (e.key === 'Enter' && pts) {
        finish(false);
        return true;
      }
      if (e.key === 'Escape' && pts) {
        pts = null;
        app.requestRender();
        return true;
      }
      if (e.key === 'Backspace' && pts) {
        pts.splice(-2, 2);
        if (!pts.length) pts = null;
        app.requestRender();
        return true;
      }
      return false;
    },
    deactivate() {
      if (pts && pts.length >= 4) finish(false);
      pts = null;
    },
    overlay(ctx, px) {
      // sommets des remparts existants (poignées)
      for (const r of app.map.ramparts) {
        const P = rampartPoints(r);
        for (let i = 0; i < P.length; i += 2) {
          ctx.beginPath();
          ctx.rect(P[i] - px * 4, P[i + 1] - px * 4, px * 8, px * 8);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = px * 1.5;
          ctx.stroke();
        }
      }
      const hv = app.hover ? snap({ wx: app.hover.wx, wy: app.hover.wy, alt: false }) : null;
      if (!pts) {
        if (hv) {
          ctx.beginPath();
          ctx.arc(hv[0], hv[1], Math.max(0.08, px * 4), 0, Math.PI * 2);
          ctx.fillStyle = ACCENT;
          ctx.fill();
        }
        return;
      }
      const P = hv ? [...pts, hv[0], hv[1]] : pts;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(P[0], P[1]);
      for (let i = 2; i < P.length; i += 2) ctx.lineTo(P[i], P[i + 1]);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(76,194,255,0.3)';
      ctx.lineWidth = o.rampartStyle === 'palisade' ? Math.min(0.8, o.rampartWidth) : o.rampartWidth;
      ctx.stroke();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = px * 2;
      ctx.setLineDash([px * 6, px * 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (o.rampartTowers) {
        const R = towerSize({ width: o.rampartWidth, style: o.rampartStyle } as Rampart);
        for (let i = 0; i < pts.length; i += 2) {
          ctx.beginPath();
          ctx.arc(pts[i], pts[i + 1], R, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(76,194,255,0.6)';
          ctx.lineWidth = px * 1.5;
          ctx.stroke();
        }
      }
      // premier sommet : fermer la boucle
      if (pts.length >= 6) {
        const near = hv && Math.hypot(hv[0] - pts[0], hv[1] - pts[1]) < 0.35;
        ctx.beginPath();
        ctx.arc(pts[0], pts[1], px * (near ? 9 : 6), 0, Math.PI * 2);
        ctx.fillStyle = near ? '#fff' : ACCENT;
        ctx.fill();
      }
      ctx.restore();
      if (hv) {
        const n = pts.length;
        const L = Math.hypot(hv[0] - pts[n - 2], hv[1] - pts[n - 1]);
        app.overlayText(`${L.toFixed(1)} cases`, hv[0], hv[1]);
      }
    },
    panel: () =>
      section('Rempart', [
        field(
          'Style',
          segmented<RampartStyle>(RAMPART_STYLES, o.rampartStyle, (v) => {
            o.rampartStyle = v;
            if (v === 'palisade' && o.rampartWidth > 0.8) o.rampartWidth = 0.6;
            if (v === 'stone' && o.rampartWidth < 0.75) o.rampartWidth = 1;
            app.renderPanel();
          }),
        ),
        field('Épaisseur', range(o.rampartWidth, 0.3, 3, 0.05, (v) => (o.rampartWidth = v), (v) => `${v.toFixed(2)} case`)),
        checkbox('Tours aux angles', o.rampartTowers, (v) => (o.rampartTowers = v)),
        h(
          'p',
          { class: 'help' },
          'Cliquez les sommets du tracé ; double-clic ou Entrée pour terminer, clic sur le premier sommet pour fermer l’enceinte. Maj + clic sur un rempart : percer une porte (porte fortifiée ou portail selon le style). Dans Foundry, les remparts deviennent des murs (les deux faces et les tours) et les portes de vraies portes.',
        ),
        button('Entourer le niveau d’une muraille', surround, 'small', 'Enceinte fermée autour de tout le contenu du niveau, avec le style choisi'),
      ]),
  };
  return tool;
}

// ---------- Passage ----------

export function passageTool(app: App): Tool {
  let pending: PassageEnd | null = null;
  let current: string | null = null;
  let drag: { id: string; end: 'a' | 'b'; moved: boolean } | null = null;
  const snap = (p: { wx: number; wy: number; alt: boolean }): [number, number] => (p.alt ? [p.wx, p.wy] : [Math.floor(p.wx) + 0.5, Math.floor(p.wy) + 0.5]);
  const lid = () => app.map.level.id;
  const levelName = (id: string) => app.map.levels.find((l) => l.id === id)?.name ?? '?';

  const hitEnd = (x: number, y: number): { p: Passage; end: 'a' | 'b' } | null => {
    for (let i = app.map.passages.length - 1; i >= 0; i--) {
      const p = app.map.passages[i];
      for (const end of ['a', 'b'] as const) {
        const e = p[end];
        if (e.level === lid() && Math.abs(x - e.x) <= p.size / 2 + 0.05 && Math.abs(y - e.y) <= p.size / 2 + 0.05) return { p, end };
      }
    }
    return null;
  };

  const goTo = (e: PassageEnd) => {
    const i = app.map.levels.findIndex((l) => l.id === e.level);
    if (i >= 0) app.switchLevel(i);
    const v = app.view;
    const c = document.getElementById('stage');
    const w = (c?.clientWidth ?? 800) / v.scale,
      hh = (c?.clientHeight ?? 600) / v.scale;
    v.ox = e.x - w / 2;
    v.oy = e.y - hh / 2;
    app.requestRender();
  };

  const remove = (id: string) => {
    app.edit();
    app.map.passages = app.map.passages.filter((p) => p.id !== id);
    if (current === id) current = null;
    app.changed(false);
    app.renderPanel();
  };

  const tool: Tool = {
    id: 'passage',
    name: 'Passage',
    key: 'j',
    icon: 'passage',
    hint: 'Clic : départ, puis clic : arrivée (changez d’étage entre les deux avec PageUp / PageDown) · Glisser une extrémité : la déplacer · Clic droit : supprimer · Échap : annuler',
    down(p) {
      const hit = hitEnd(p.wx, p.wy);
      if (p.button === 2) {
        if (pending) {
          pending = null;
          app.requestRender();
          app.renderPanel();
        } else if (hit) remove(hit.p.id);
        return;
      }
      if (hit && !pending) {
        current = hit.p.id;
        app.selection.clear();
        app.selection.add(hit.p.id);
        drag = { id: hit.p.id, end: hit.end, moved: false };
        app.requestRender();
        app.renderPanel();
        return;
      }
      const [x, y] = snap(p);
      if (!pending) {
        pending = { level: lid(), x, y };
        app.requestRender();
        app.renderPanel();
        return;
      }
      app.edit();
      const n = app.map.passages.length + 1;
      const ps: Passage = { id: uid(), name: `Passage ${n}`, a: pending, b: { level: lid(), x, y }, size: 1 };
      app.map.passages.push(ps);
      pending = null;
      current = ps.id;
      app.selection.clear();
      app.selection.add(ps.id);
      app.changed(false);
      app.renderPanel();
    },
    move(p, dragging) {
      if (drag && dragging) {
        const ps = app.map.passages.find((q) => q.id === drag!.id);
        if (!ps) return;
        if (!drag.moved) {
          app.edit();
          drag.moved = true;
        }
        const live = app.map.passages.find((q) => q.id === drag!.id)!;
        const [x, y] = snap(p);
        live[drag.end] = { ...live[drag.end], x, y };
        app.changed(false);
        return;
      }
      app.requestRender();
    },
    up() {
      drag = null;
    },
    onKey(e) {
      if (e.key === 'Escape' && pending) {
        pending = null;
        app.requestRender();
        app.renderPanel();
        return true;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && current) {
        remove(current);
        return true;
      }
      return false;
    },
    deactivate() {
      pending = null;
    },
    overlay(ctx, px) {
      if (app.hover) {
        const [x, y] = snap({ wx: app.hover.wx, wy: app.hover.wy, alt: false });
        ctx.strokeStyle = PURPLE;
        ctx.lineWidth = px * 1.5;
        ctx.strokeRect(x - 0.5, y - 0.5, 1, 1);
      }
      if (pending && pending.level === lid()) {
        ctx.save();
        ctx.fillStyle = 'rgba(176,124,255,0.3)';
        ctx.fillRect(pending.x - 0.5, pending.y - 0.5, 1, 1);
        ctx.setLineDash([px * 5, px * 3]);
        ctx.strokeStyle = PURPLE;
        ctx.lineWidth = px * 2;
        ctx.strokeRect(pending.x - 0.5, pending.y - 0.5, 1, 1);
        ctx.restore();
        if (app.hover) app.overlayText('Cliquez l’arrivée (même niveau ou PageUp / PageDown)', app.hover.wx, app.hover.wy);
      } else if (pending && app.hover) app.overlayText(`Départ sur « ${levelName(pending.level)} » : cliquez l’arrivée`, app.hover.wx, app.hover.wy);
    },
    panel: () => {
      const list = h('div', { class: 'passages' });
      app.map.passages.forEach((ps) => {
        const name = h('input', { type: 'text', value: ps.name, class: 'grow' });
        name.addEventListener('change', () => {
          app.edit();
          ps.name = name.value.trim() || ps.name;
          app.changed(false);
        });
        const row = h(
          'div',
          { class: 'passage-row' + (ps.id === current ? ' on' : '') },
          h('div', { class: 'row' }, name, button('✕', () => remove(ps.id), 'icon danger small', 'Supprimer')),
          h(
            'div',
            { class: 'row muted' },
            button(`Départ : ${levelName(ps.a.level)}`, () => goTo(ps.a), 'small link', 'Aller au départ'),
            h('span', {}, ps.oneWay ? '→' : '↔'),
            button(`Arrivée : ${levelName(ps.b.level)}`, () => goTo(ps.b), 'small link', 'Aller à l’arrivée'),
          ),
          h(
            'div',
            { class: 'row' },
            checkbox('Sens unique', !!ps.oneWay, (v) => {
              app.edit();
              ps.oneWay = v;
              app.changed(false);
              app.renderPanel();
            }),
            h('span', { class: 'muted' }, 'Taille'),
            ...([1, 2, 3] as const).map((s) =>
              button(`${s}`, () => {
                app.edit();
                ps.size = s;
                app.changed(false);
                app.renderPanel();
              }, 'small' + (ps.size === s ? ' on' : ''), `${s} × ${s} cases`),
            ),
          ),
        );
        list.append(row);
      });
      return section('Passages', [
        h(
          'p',
          { class: 'help' },
          pending
            ? `Départ posé sur « ${levelName(pending.level)} ». Cliquez l’arrivée : sur ce niveau, ou changez d’étage (PageUp / PageDown, barre des niveaux) puis cliquez. Échap pour annuler.`
            : 'Un passage relie deux points : trappe vers une cave, échelle, portail magique, tunnel… Dans Foundry (v12+), un jeton qui entre dans une zone est téléporté à l’autre bout, même sur un autre étage.',
        ),
        h('p', { class: 'help' }, 'Les escaliers, échelles, trappes et colimaçons sont reliés automatiquement à l’étage voisin, au même endroit : inutile de les doubler ici.'),
        app.map.passages.length ? list : h('p', { class: 'muted' }, 'Aucun passage.'),
      ]);
    },
  };
  return tool;
}
