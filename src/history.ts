import { DungeonMap, Level, MapSettings } from './model';

interface Snapshot {
  name: string;
  cols: number;
  rows: number;
  cur: number;
  levels: Level[];
  settings: MapSettings;
}

function snap(m: DungeonMap): Snapshot {
  return {
    name: m.name,
    cols: m.cols,
    rows: m.rows,
    cur: m.cur,
    levels: m.levels.map((l) => l.clone()),
    settings: structuredClone(m.settings),
  };
}

function restore(m: DungeonMap, s: Snapshot): void {
  m.name = s.name;
  m.cols = s.cols;
  m.rows = s.rows;
  m.levels = s.levels;
  m.cur = Math.min(s.cur, s.levels.length - 1);
  m.settings = s.settings;
  m.touchAll();
}

/** Annuler / rétablir par instantanés (rapide : quelques Ko par étape et par niveau). */
export class History {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  limit = 150;

  push(m: DungeonMap): void {
    this.undoStack.push(snap(m));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(m: DungeonMap): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push(snap(m));
    restore(m, s);
    return true;
  }

  redo(m: DungeonMap): boolean {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push(snap(m));
    restore(m, s);
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
