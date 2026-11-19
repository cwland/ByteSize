import { useState } from "react";
import { api } from "../../api";
import { notifyDayChanged } from "../../day";
import { MEALS } from "../../meals";
import { dayLabel } from "../../selectedDay";
import { useSession } from "../../session";
import type { Day, LogEntry, Meal } from "../../types";
import AddFoodSheet from "../log/AddFoodSheet";
import EditEntrySheet from "../log/EditEntrySheet";
import MealCard, { SaveAsMealSheet } from "../log/MealCard";
import MoveSheet from "../log/MoveSheet";
import { Confirm } from "../ui/Confirm";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { secondaryButton } from "../ui/styles";

type Moving = { ids: number[]; copy: boolean; meal: Meal };

// The Dashboard's Food widget: everything the Log page did (§28). The day's meals as the Log's meal cards
// (entries with photo/icon, amount and pills; "+ Add food" on every meal; Supplements & water), tap a food to
// edit, move, copy or delete it; Select for several (move, copy — e.g. a meal to another day — or delete); Save as a meal.
export default function FoodWidget({ day, data, isToday }: { day: string; data: Day | null; isToday: boolean }) {
  const { user } = useSession();
  const [adding, setAdding] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<LogEntry | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [deleting, setDeleting] = useState<LogEntry | null>(null);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<Msg>(null);
  const [savingMeal, setSavingMeal] = useState<Meal | null>(null);

  const toggle = (e: LogEntry) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(e.id)) next.delete(e.id);
      else next.add(e.id);
      return next;
    });
  const endSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const remove = async (e: LogEntry) => {
    setDeleting(null);
    try {
      await api("DELETE", `/api/log/${e.id}`);
      notifyDayChanged();
    } catch (err) {
      setMsg(errorMsg(err));
    }
  };

  // Delete selected: one at a time, so what was deleted before a failure stays deleted and the rest stay selected
  const removeSelected = async () => {
    setDeletingSelected(false);
    const left = new Set(selected);
    try {
      for (const id of selected) {
        await api("DELETE", `/api/log/${id}`);
        left.delete(id);
      }
      endSelect();
    } catch (err) {
      setSelected(left);
      setMsg(errorMsg(err));
    }
    notifyDayChanged();
  };

  const entries = data?.entries ?? [];
  const title = isToday || !data ? "Today's food" : `Food on ${dayLabel(data.day)}`;
  return (
    // One card, as every widget is (§41): the title and its controls at the top, each meal a section inside, divided by a line
    <section aria-label={title} className="flex flex-col gap-3 rounded-2xl bg-container p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-bold">{title}</h2>
        {selecting && (
          <>
            <span className="text-sm text-subtle">{selected.size} selected</span>
            <button type="button" disabled={!selected.size} onClick={() => setMoving({ ids: [...selected], copy: false, meal: "breakfast" })} className={`${secondaryButton} px-4 py-1.5 text-sm`}>
              Move selected
            </button>
            <button type="button" disabled={!selected.size} onClick={() => setMoving({ ids: [...selected], copy: true, meal: "breakfast" })} className={`${secondaryButton} px-4 py-1.5 text-sm`}>
              Copy selected
            </button>
            <button type="button" disabled={!selected.size} onClick={() => setDeletingSelected(true)} className={`${secondaryButton} px-4 py-1.5 text-sm text-error`}>
              Delete selected
            </button>
          </>
        )}
        {entries.length > 0 && (
          <button type="button" onClick={() => (selecting ? endSelect() : setSelecting(true))} className="rounded-full px-3 py-1.5 text-sm font-semibold text-link hover:bg-pressed">
            {selecting ? "Done" : "Select"}
          </button>
        )}
      </div>
      <Notice msg={msg} />
      {data &&
        MEALS.map((m) => (
          <MealCard
            key={m}
            meal={m}
            entries={entries.filter((e) => e.meal === m)}
            totals={data.meals[m]}
            units={user.units}
            selecting={selecting}
            selected={selected}
            onAdd={() => setAdding(m)}
            onOpen={setEditing}
            onToggle={toggle}
            onLongPress={(e) => {
              setSelecting(true);
              setSelected(new Set([e.id]));
            }}
            onSaveAsMeal={() => setSavingMeal(m)}
            inset
          />
        ))}

      {savingMeal && <SaveAsMealSheet meal={savingMeal} ids={entries.filter((e) => e.meal === savingMeal).map((e) => e.id)} onClose={() => setSavingMeal(null)} />}
      {adding && <AddFoodSheet day={day} meal={adding} onClose={() => setAdding(null)} />}
      {editing && (
        <EditEntrySheet
          entry={editing}
          onClose={() => setEditing(null)}
          onMove={(copy) => {
            setMoving({ ids: [editing.id], copy, meal: editing.meal });
            setEditing(null);
          }}
          onDelete={() => {
            setDeleting(editing);
            setEditing(null);
          }}
        />
      )}
      {moving && (
        <MoveSheet
          ids={moving.ids}
          copy={moving.copy}
          day={day}
          meal={moving.meal}
          onClose={() => {
            setMoving(null);
            endSelect();
          }}
        />
      )}
      {deletingSelected && (
        <Confirm title={`Delete ${selected.size} ${selected.size === 1 ? "food" : "foods"}?`} confirmLabel="Delete" onConfirm={removeSelected} onCancel={() => setDeletingSelected(false)} />
      )}
      {deleting && <Confirm title={`Delete ${deleting.name}?`} confirmLabel="Delete" onConfirm={() => remove(deleting)} onCancel={() => setDeleting(null)} />}
    </section>
  );
}
