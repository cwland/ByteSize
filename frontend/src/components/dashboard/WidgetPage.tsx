import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical, Pencil, Plus, X } from "lucide-react";
import { api } from "../../api";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { primaryButton, secondaryButton } from "../ui/styles";
import { LAYOUT_VERSION, addWidget, defaultLayout, dropIndex, fromSaved, moveSideways, moveTo, moveVertical, readingOrder, removeWidget, type Columns, type LayoutPage, type SavedLayout } from "./layout";
import { registryFor, widgetById, type WidgetProps } from "./widgets";

// What every widget page (§28, §40a: the Dashboard, Goals) shares: its saved layout (GET/PUT /api/layouts/:page,
// the default until loaded), the columns of widgets, the edit button and edit mode (drag, move buttons, remove,
// Add widget, Save / Cancel / Reset to default). Each page has its own registry entries, default and saved layout.

const PAGE_COPY: Record<LayoutPage, { edit: string; allPlaced: string }> = {
  dashboard: { edit: "Edit dashboard", allPlaced: "Every widget is on your dashboard" },
  goals: { edit: "Edit page", allPlaced: "Every widget is on this page" },
};

// The page's layout: the default until the saved one has loaded (or failed to: the default stays). Editing waits for
// it, so Save can never write an edit of the default over the saved layout.
export function useWidgetLayout(page: LayoutPage) {
  const [cols, setCols] = useState<Columns>(() => defaultLayout(registryFor(page)));
  const [editing, setEditing] = useState<Columns | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ layout: SavedLayout | null }>("GET", `/api/layouts/${page}`)
      .then((r) => live && setCols(fromSaved(r.layout, registryFor(page))))
      .catch(() => {}) // the default layout stays
      .finally(() => live && setLoaded(true));
    return () => void (live = false);
  }, [page]);
  return {
    page,
    cols,
    editing,
    setEditing,
    loaded,
    startEditing: () => setEditing(cols),
    saved: (c: Columns) => {
      setCols(c);
      setEditing(null);
    },
  };
}
export type WidgetLayout = ReturnType<typeof useWidgetLayout>;

// "Edit dashboard" / "Edit page" (pencil); hidden while editing
export function EditLayoutButton({ layout }: { layout: WidgetLayout }) {
  if (layout.editing) return null;
  return (
    <button type="button" disabled={!layout.loaded} onClick={layout.startEditing} className="disabled:opacity-50 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-link hover:bg-pressed">
      <Pencil aria-hidden="true" className="size-4" /> {PAGE_COPY[layout.page].edit}
    </button>
  );
}

const autoFit = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,19rem),1fr))] items-start gap-5";

// The widgets (or, while editing, edit mode). One tree for every width (crossing 1024 px keeps a widget's open sheet):
// the columns side by side on wide screens, stacked on phones — which is the reading order. An empty column takes no
// room. wideGrid: the page's grid for a number of non-empty columns (default: as many equal columns as fit).
export function WidgetColumns({ layout, props, wideGrid }: { layout: WidgetLayout; props: WidgetProps; wideGrid?: (shown: number) => string | undefined }) {
  const { page, cols, editing, setEditing, saved } = layout;
  const wide = props.wide;
  if (editing) return <EditLayout page={page} cols={editing} wide={wide} onChange={setEditing} onCancel={() => setEditing(null)} onSaved={saved} />;
  const widget = (id: string) => {
    const w = widgetById(id);
    return w ? <w.Component key={id} {...props} /> : null;
  };
  const shown = cols.filter((c) => c.length).length;
  return (
    <div data-testid={`${page}-columns`} className={wide ? (wideGrid?.(shown) ?? autoFit) : "flex flex-col gap-3"}>
      {cols.map((c, i) => (
        <div key={i} data-testid={c.length ? "widget-column" : undefined} hidden={!c.length} className={wide ? "flex min-w-0 flex-col gap-4" : "flex flex-col gap-3"}>
          {c.map(widget)}
        </div>
      ))}
    </div>
  );
}

type Drag = { id: string; target: { col: number; index: number } | null };
type Dir = "up" | "down" | "left" | "right";
const DIRS: Dir[] = ["up", "down", "left", "right"];
const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };

// Edit mode (any widget page). Widgets are cards (their title and one line; they don't load or work here). Wide screens: three
// columns (empty ones stay as drop targets), a drag handle (mouse and touch) and Move up/down/left/right on each.
// Phones: one column in reading order with Move up/down. Every move can be made without dragging.
export function EditLayout({ page, cols, wide, onChange, onCancel, onSaved }: { page: LayoutPage; cols: Columns; wide: boolean; onChange: (c: Columns) => void; onCancel: () => void; onSaved: (c: Columns) => void }) {
  const registry = registryFor(page);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const columnEls = useRef<(HTMLDivElement | null)[]>([]);
  // After a move with a button, keyboard focus follows the widget: a move across columns draws its card anew
  // in the other column, and a button that turns disabled (the end of a column) can't keep focus. The same
  // button if it can still be used, else the opposite move, else any move, else the drag handle.
  const area = useRef<HTMLDivElement>(null);
  const refocus = useRef<{ id: string; dir: Dir } | null>(null);
  useLayoutEffect(() => {
    const r = refocus.current;
    refocus.current = null;
    if (!r) return;
    const w = widgetById(r.id);
    const cardEl = area.current?.querySelector<HTMLElement>(`[data-widget="${r.id}"]`);
    if (!w || !cardEl) return;
    const prefer: string[] = [`Move ${w.title} ${r.dir}`, `Move ${w.title} ${OPPOSITE[r.dir]}`, ...DIRS.map((d) => `Move ${w.title} ${d}`), `Drag ${w.title}`];
    const buttons = [...cardEl.querySelectorAll<HTMLButtonElement>("button")];
    for (const label of prefer) {
      const b = buttons.find((x) => x.getAttribute("aria-label") === label && !x.disabled);
      if (b) return void b.focus();
    }
  }, [cols]);
  const moveWith = (id: string, dir: Dir, next: Columns) => {
    refocus.current = { id, dir };
    onChange(next);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api("PUT", `/api/layouts/${page}`, { version: LAYOUT_VERSION, columns: cols });
      onSaved(cols);
    } catch (e) {
      setMsg(errorMsg(e));
    }
    setBusy(false);
  };

  // Dragging: the column under the pointer (or the nearest), and the place in it by the cards' middles
  const targetAt = (x: number, y: number) => {
    const rects = columnEls.current.map((el) => el?.getBoundingClientRect());
    let col = -1;
    let best = Infinity;
    rects.forEach((r, i) => {
      if (!r) return;
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (d < best) [best, col] = [d, i];
    });
    if (col < 0) return null;
    const cards = [...(columnEls.current[col]?.querySelectorAll<HTMLElement>("[data-widget]") ?? [])].map((c) => c.getBoundingClientRect());
    return { col, index: dropIndex(cards, y) };
  };
  const startDrag = (id: string) => {
    setDrag({ id, target: null });
    const move = (e: PointerEvent) => setDrag({ id, target: targetAt(e.clientX, e.clientY) });
    const end = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const t = e.type === "pointerup" ? targetAt(e.clientX, e.clientY) : null;
      setDrag(null);
      if (t) onChange(moveTo(cols, id, t.col, t.index));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const order = readingOrder(cols);
  const card = (id: string) => {
    const w = widgetById(id);
    if (!w) return null;
    const col = cols.findIndex((c) => c.includes(id));
    const i = order.indexOf(id);
    const iconButton = (label: string, icon: JSX.Element, onClick: () => void, disabled = false) => (
      <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex size-11 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-ink disabled:opacity-30">
        {icon}
      </button>
    );
    return (
      <div key={id} role="group" aria-label={w.title} data-widget={id} className={`rounded-2xl border-2 border-dashed border-strong bg-container p-3 ${drag?.id === id ? "opacity-50" : ""}`}>
        <div className="flex items-start gap-1">
          {wide && (
            <button
              type="button"
              aria-label={`Drag ${w.title}`}
              title="Drag to move"
              onPointerDown={(e) => {
                e.preventDefault();
                startDrag(id);
              }}
              className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-subtle hover:bg-pressed active:cursor-grabbing"
            >
              <GripVertical aria-hidden="true" className="size-5" />
            </button>
          )}
          <div className="min-w-0 flex-1 py-1.5">
            <h2 className="font-bold">{w.title}</h2>
            <p className="text-sm text-subtle">{w.description}</p>
            {w.onlyWhen && <p className="text-xs text-muted">{w.onlyWhen}</p>}
          </div>
          {iconButton(`Remove ${w.title}`, <X aria-hidden="true" className="size-5" />, () => onChange(removeWidget(cols, id)))}
        </div>
        <div className="mt-1 flex flex-wrap justify-end">
          {iconButton(`Move ${w.title} up`, <ArrowUp aria-hidden="true" className="size-5" />, () => moveWith(id, "up", moveVertical(cols, id, -1)), i === 0)}
          {iconButton(`Move ${w.title} down`, <ArrowDown aria-hidden="true" className="size-5" />, () => moveWith(id, "down", moveVertical(cols, id, 1)), i === order.length - 1)}
          {wide && iconButton(`Move ${w.title} left`, <ArrowLeft aria-hidden="true" className="size-5" />, () => moveWith(id, "left", moveSideways(cols, id, -1)), col === 0)}
          {wide && iconButton(`Move ${w.title} right`, <ArrowRight aria-hidden="true" className="size-5" />, () => moveWith(id, "right", moveSideways(cols, id, 1)), col === cols.length - 1)}
        </div>
      </div>
    );
  };
  const dropLine = <div key="drop-line" data-testid="drop-line" aria-hidden="true" className="h-1 rounded-full bg-action" />;
  const missing = registry.filter((w) => !order.includes(w.id));

  return (
    <div ref={area} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-subtle">{wide ? "Drag widgets by their handle, or use the arrows." : "Use the arrows to change the order."}</p>
        <button type="button" onClick={() => setAdding(true)} className={`${secondaryButton} inline-flex items-center gap-1.5 px-4 py-1.5 text-sm`}>
          <Plus aria-hidden="true" className="size-4" /> Add widget
        </button>
        <button type="button" onClick={() => onChange(defaultLayout(registry))} className="rounded-full px-3 py-1.5 text-sm font-semibold text-link hover:bg-pressed">
          Reset to default
        </button>
        <button type="button" onClick={onCancel} className={`${secondaryButton} px-4 py-1.5 text-sm`}>
          Cancel
        </button>
        <button type="button" disabled={busy} onClick={save} className={`${primaryButton} px-4 py-1.5 text-sm`}>
          Save
        </button>
      </div>
      <Notice msg={msg} />
      {wide ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,19rem),1fr))] items-start gap-5">
          {cols.map((c, ci) => {
            const items: JSX.Element[] = c.map(card).filter((x): x is JSX.Element => x !== null);
            if (drag?.target?.col === ci) items.splice(drag.target.index, 0, dropLine);
            return (
              <div
                key={ci}
                ref={(el) => void (columnEls.current[ci] = el)}
                data-testid="widget-column"
                aria-label={`Column ${ci + 1}`}
                className="flex min-h-32 min-w-0 flex-col gap-4 rounded-2xl bg-pressed/40 p-2"
              >
                {items}
                {!c.length && !items.length && <p className="py-10 text-center text-sm text-muted">Drop a widget here</p>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">{order.map(card)}</div>
      )}
      {adding && (
        <Sheet label="Add widget" onClose={() => setAdding(false)}>
          {missing.length ? (
            <ul className="flex flex-col gap-2">
              {missing.map((w) => (
                <li key={w.id} className="flex items-center gap-3 rounded-2xl bg-pressed/40 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{w.title}</p>
                    <p className="text-sm text-subtle">{w.description}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Add ${w.title}`}
                    onClick={() => {
                      onChange(addWidget(cols, w.id));
                      setAdding(false);
                    }}
                    className={`${primaryButton} px-4 py-1.5 text-sm`}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-subtle">{PAGE_COPY[page].allPlaced}</p>
          )}
        </Sheet>
      )}
    </div>
  );
}
