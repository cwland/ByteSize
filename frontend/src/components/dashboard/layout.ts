// A widget page's layout (§28, §40a): three columns of widget ids, top to bottom. Pure helpers that every widget
// page (the Dashboard, Goals), its edit mode and the Add widget list share. Every change returns a new layout.

export type Columns = string[][];
export const COLUMNS = 3;
// The pages with widgets (backend/src/lib/widgets.ts has the same list); each has its own saved layout
export const LAYOUT_PAGES = ["dashboard", "goals"] as const;
export type LayoutPage = (typeof LAYOUT_PAGES)[number];
// What the layout needs of a registry entry on one page: its id, its default column there (null: only offered
// in Add widget, not in the default), and (rarely) the layout version in which it joined everyone's page
// ("new default"); without that, a later widget waits in Add widget.
export type LayoutWidget = { id: string; column: number | null; newDefault?: number };
export type SavedLayout = { version: number; columns: string[][] };
export const LAYOUT_VERSION = 1;

// §40c: each active goal is a widget of its own, "goal:<id>", offered on these pages (backend/src/lib/widgets.ts has
// the same). The server keeps only the person's active goals in a layout, and adds a new goal to a saved Goals page.
export const GOAL_WIDGET_PREFIX = "goal:";
export const GOAL_WIDGET_PAGES: readonly LayoutPage[] = ["dashboard", "goals"];
export const goalWidgetId = (id: number) => `${GOAL_WIDGET_PREFIX}${id}`;
export const goalIdOf = (widget: string): number | null => (/^goal:[1-9]\d*$/.test(widget) ? Number(widget.slice(GOAL_WIDGET_PREFIX.length)) : null);
/**
 * The Goals page's default (nothing saved): each active goal not yet placed joins the bottom of the shortest column in
 * use (the leftmost of equals; an empty column stays empty, as the Goals default uses two of three; none in use: the first)
 */
export function placeGoals(cols: Columns, ids: number[]): Columns {
  const next = copy(cols);
  for (const id of ids) {
    const wid = goalWidgetId(id);
    if (next.some((c) => c.includes(wid))) continue;
    const used = next.map((c, i) => i).filter((i) => next[i].length > 0);
    const at = used.length ? used.reduce((best, i) => (next[i].length < next[best].length ? i : best), used[0]) : 0;
    next[at].push(wid);
  }
  return next;
}

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
  for (const w of registry) if (w.column !== null && w.newDefault && w.newDefault > saved.version && !seen.has(w.id)) cols[w.column].push(w.id);
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
