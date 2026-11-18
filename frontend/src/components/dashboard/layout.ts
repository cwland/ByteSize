// The Dashboard's layout (§28): three columns of widget ids, top to bottom. Pure helpers that the Dashboard,
// its edit mode and the Add widget list share. Every change returns a new layout.

export type Columns = string[][];
export const COLUMNS = 3;
// What the layout needs of a registry entry: its id, its default column, and (rarely) the layout version in
// which it joined everyone's dashboard ("new default"); without that, a later widget waits in Add widget.
export type LayoutWidget = { id: string; column: number; newDefault?: number };
export type SavedLayout = { version: number; columns: string[][] };
export const LAYOUT_VERSION = 1;

const copy = (cols: Columns): Columns => cols.map((c) => [...c]);
const find = (cols: Columns, id: string) => {
  const col = cols.findIndex((c) => c.includes(id));
  return { col, index: col < 0 ? -1 : cols[col].indexOf(id) };
};

export function defaultLayout(registry: LayoutWidget[]): Columns {
  return Array.from({ length: COLUMNS }, (_, c) => registry.filter((w) => w.column === c).map((w) => w.id));
}

// A saved layout as the app can show it: known ids only, each once, three columns; widgets marked new default
// for a later version than it was saved with join the bottom of their own column. None saved: the default.
export function fromSaved(saved: SavedLayout | null, registry: LayoutWidget[]): Columns {
  if (!saved) return defaultLayout(registry);
  const known = new Set(registry.map((w) => w.id));
  const seen = new Set<string>();
  const cols = Array.from({ length: COLUMNS }, (_, c) =>
    (saved.columns[c] ?? []).filter((id) => {
      if (!known.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  );
  for (const w of registry) if (w.newDefault && w.newDefault > saved.version && !seen.has(w.id)) cols[w.column].push(w.id);
  return cols;
}

// Phones (one column): left column top to bottom, then middle, then right
export const readingOrder = (cols: Columns) => cols.flat();

// Move up (-1) / down (+1): one place in reading order, so phones (one column) see it move by one. Within a
// column it swaps with its neighbour; at a column's top it goes above the last widget of the column before
// (at the bottom, below the first of the column after), past any empty columns
export function moveVertical(cols: Columns, id: string, delta: -1 | 1): Columns {
  const order = readingOrder(cols);
  const i = order.indexOf(id);
  const other = order[i + delta];
  if (i < 0 || other === undefined) return cols;
  const at = find(cols, other);
  return moveTo(cols, id, at.col, at.index + (delta > 0 ? 1 : 0));
}

// Move left (-1) / right (+1): to the column beside it, at the same height (or its end)
export function moveSideways(cols: Columns, id: string, delta: -1 | 1): Columns {
  const { col, index } = find(cols, id);
  const other = col + delta;
  if (col < 0 || other < 0 || other >= cols.length) return cols;
  return moveTo(cols, id, other, Math.min(index, cols[other].length));
}

// Drag and drop: into `column` before the widget now at `index` (index counted with the widget still in place)
export function moveTo(cols: Columns, id: string, column: number, index: number): Columns {
  const from = find(cols, id);
  if (from.col < 0) return cols;
  const next = copy(cols);
  next[from.col].splice(from.index, 1);
  const at = from.col === column && from.index < index ? index - 1 : index;
  next[column].splice(Math.max(0, Math.min(at, next[column].length)), 0, id);
  return next;
}

export const removeWidget = (cols: Columns, id: string): Columns => cols.map((c) => c.filter((x) => x !== id));

// Add widget: to the bottom of the shortest column (the leftmost of equals)
export function addWidget(cols: Columns, id: string): Columns {
  const next = copy(cols);
  const shortest = next.reduce((best, c, i) => (c.length < next[best].length ? i : best), 0);
  next[shortest].push(id);
  return next;
}

// Where a dragged widget lands in a column: after every card whose middle is above the pointer
export const dropIndex = (cards: { top: number; height: number }[], y: number) => cards.filter((c) => c.top + c.height / 2 < y).length;
