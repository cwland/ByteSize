import { useState } from "react";
import { api } from "../../api";
import { notifyDayChanged, useDay } from "../../day";
import { MEALS } from "../../meals";
import { amountFactor } from "../../nutrition";
import { myFoodsHref } from "../../routes";
import { useSelectedDay } from "../../selectedDay";
import { useSession } from "../../session";
import type { LogEntry, Meal, Nutrients } from "../../types";
import AddFoodSheet from "./AddFoodSheet";
import MealCard, { SaveAsMealSheet } from "./MealCard";
import MoveSheet from "./MoveSheet";
import FoodDetail from "./FoodDetail";
import { Confirm } from "../ui/Confirm";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { secondaryButton } from "../ui/styles";
import DayTotals from "./DayTotals";
import { DayHeader } from "../PageHeader";
import { useWide } from "../../wide";

// What one base serving of a logged food has (entries keep the scaled numbers; the preview needs per-serving)
function perServing(e: LogEntry): Nutrients {
  try {
    const f = amountFactor(e.servings, e.servingIndex, e.unit, e.quantity) * e.fraction;
    if (!(f > 0)) return e.nutrients;
    return Object.fromEntries(Object.entries(e.nutrients).map(([k, v]) => [k, (v as number) / f]));
  } catch {
    return e.nutrients;
  }
}

type Moving = { ids: number[]; copy: boolean; meal: Meal };

// The day's food by meal: tap a food to change its portion, move, copy or delete it; Select for several.
// Wide screens: a header (title, the day, week strip, My foods), the meal cards in a grid (two across when
// there is room; supplements & water full width) and Day totals beside them.
export default function LogPage() {
  const { user } = useSession();
  const { day } = useSelectedDay();
  const wide = useWide();
  const { data, error } = useDay(day);
  const [adding, setAdding] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<LogEntry | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [deleting, setDeleting] = useState<LogEntry | null>(null);
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

  const entries = data?.entries ?? [];
  const mealCard = (m: Meal) => (
    <MealCard
      key={m}
      meal={m}
      entries={entries.filter((e) => e.meal === m)}
      totals={data!.meals[m]}
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
    />
  );
  return (
    <div className={`flex flex-col ${wide ? "gap-5" : "gap-3"}`}>
      {wide ? (
        <DayHeader title="Log">
          <a href={myFoodsHref("/log")} className="rounded-full bg-container px-4 py-2 text-sm font-bold text-link hover:bg-pressed">
            My foods
          </a>
        </DayHeader>
      ) : (
        <h1 className="sr-only">Log</h1>
      )}
      {error && <Notice msg={{ ok: false, text: error }} />}
      <Notice msg={msg} />
      <div className="flex items-center justify-end gap-2">
        {!selecting && !wide && (
          <a href={myFoodsHref("/log")} className="mr-auto rounded-full px-3 py-1.5 text-sm font-semibold text-link hover:bg-pressed">
            My Foods
          </a>
        )}
        {entries.length > 0 && selecting && (
          <>
            <span className="mr-auto text-sm text-subtle">{selected.size} selected</span>
            <button type="button" disabled={!selected.size} onClick={() => setMoving({ ids: [...selected], copy: false, meal: "breakfast" })} className={`${secondaryButton} px-4 py-1.5 text-sm`}>
              Move selected
            </button>
            <button type="button" disabled={!selected.size} onClick={() => setMoving({ ids: [...selected], copy: true, meal: "breakfast" })} className={`${secondaryButton} px-4 py-1.5 text-sm`}>
              Copy selected
            </button>
          </>
        )}
        {entries.length > 0 && (
          <button type="button" onClick={() => (selecting ? endSelect() : setSelecting(true))} className="rounded-full px-3 py-1.5 text-sm font-semibold text-link hover:bg-pressed">
            {selecting ? "Done" : "Select"}
          </button>
        )}
      </div>
      {data && !wide && MEALS.map(mealCard)}
      {data && wide && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div data-testid="meal-grid" className="grid items-start gap-4 xl:grid-cols-2">
            {MEALS.map((m) =>
              m === "supplements" ? (
                <div key={m} className="xl:col-span-2">
                  {mealCard(m)}
                </div>
              ) : (
                mealCard(m)
              ),
            )}
          </div>
          <DayTotals day={data} units={user.units} />
        </div>
      )}

      {savingMeal && <SaveAsMealSheet meal={savingMeal} ids={entries.filter((e) => e.meal === savingMeal).map((e) => e.id)} onClose={() => setSavingMeal(null)} />}
      {adding && <AddFoodSheet day={day} meal={adding} onClose={() => setAdding(null)} />}
      {editing && (
        <Sheet label="Edit portion" heading="Edit entry" onClose={() => setEditing(null)}>
          <FoodDetail
            food={{ name: editing.name, brand: editing.brand, icon: editing.icon, imageUrl: editing.imageUrl, servings: editing.servings, nutrients: perServing(editing) }}
            initial={{ servingIndex: editing.servingIndex, unit: editing.unit, quantity: editing.quantity, fraction: editing.fraction }}
            submitLabel="Save"
            onSubmit={async (p) => {
              await api("PATCH", `/api/log/${editing.id}`, p);
              notifyDayChanged();
              setEditing(null);
            }}
          >
            {(["Move", "Copy"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => {
                  setMoving({ ids: [editing.id], copy: a === "Copy", meal: editing.meal });
                  setEditing(null);
                }}
                className={secondaryButton}
              >
                {a}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setDeleting(editing);
                setEditing(null);
              }}
              className={`${secondaryButton} text-error`}
            >
              Delete
            </button>
          </FoodDetail>
        </Sheet>
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
      {deleting && <Confirm title={`Delete ${deleting.name}?`} confirmLabel="Delete" onConfirm={() => remove(deleting)} onCancel={() => setDeleting(null)} />}
    </div>
  );
}
