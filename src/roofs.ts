import { DungeonMap } from './model';
import { isRoof } from './props';
import { uid } from './util';

/**
 * Pose un toit sur chaque groupe de salles séparé du niveau courant (sauf s'il en a déjà un).
 * Renvoie le nombre de toits ajoutés.
 */
export function autoRoofs(map: DungeonMap, kind: string, overhang = 0.15): number {
  const { cols, rows } = map;
  const seen = new Uint8Array(cols * rows);
  const roofs = map.props.filter(isRoof);
  let n = 0;
  const stack: number[] = [];
  for (let i = 0; i < cols * rows; i++) {
    if (seen[i] || !map.cells[i]) continue;
    let x0 = cols,
      y0 = rows,
      x1 = 0,
      y1 = 0,
      count = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % cols,
        y = (j - x) / cols;
      count++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const k = ny * cols + nx;
        if (!seen[k] && map.cells[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    if (count < 4) continue;
    const cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2;
    if (roofs.some((r) => Math.abs(r.x - cx) < (x1 - x0) / 2 && Math.abs(r.y - cy) < (y1 - y0) / 2)) continue;
    map.props.push({ id: uid(), kind, x: cx, y: cy, w: x1 - x0 + 2 * overhang, h: y1 - y0 + 2 * overhang, rot: 0, gmOnly: false });
    n++;
  }
  return n;
}
