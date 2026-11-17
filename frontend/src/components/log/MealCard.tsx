import { useRef } from "react";
import { Check, Plus } from "lucide-react";
import { MEAL_NAMES } from "../../meals";
import { portionText } from "../../nutrition";
import type { LogEntry, Meal, MealTotals, Units } from "../../types";
import { fmt } from "../../units";

const g = (n: number) => `${Math.round(n)}g`;

function EntryRow({ entry, units, selecting, selected, onOpen, onLongPress }: { entry: LogEntry; units: Units; selecting: boolean; selected: boolean; onOpen: () => void; onLongPress: () => void }) {
  // Press and hold (half a second) starts selecting
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const held = useRef(false);
  const start = () => {
    held.current = false;
    timer.current = setTimeout(() => {
      held.current = true;
      onLongPress();
    }, 500);
  };
  const stop = () => clearTimeout(timer.current);
  const water = entry.sourceRef === null && entry.nutrients.water_ml !== undefined && entry.nutrients.calories === undefined;
  return (
    <li>
      <button
        type="button"
        {...(selecting ? { role: "checkbox", "aria-checked": selected } : {})}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onClick={() => (held.current ? (held.current = false) : onOpen())}
        className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-pressed ${selected ? "bg-active" : ""}`}
      >
        {selecting && (
          <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-action bg-action text-on-primary" : "border-strong"}`}>
            {selected && <Check className="size-3.5" strokeWidth={3} />}
          </span>
        )}
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center text-2xl">
          {entry.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{entry.name}</span>
          <span className="block truncate text-sm text-subtle">
            <span>{portionText(entry, units)}</span>
            {!water && entry.nutrients.fiber_g === undefined && <span className="text-muted"> · <span>fiber unknown</span></span>}
          </span>
        </span>
        {!water && <span className="font-semibold tabular">{fmt(entry.nutrients.calories ?? 0)}</span>}
      </button>
    </li>
  );
}

// One meal: "Breakfast: 287 cals", its macros, its foods, and Add Food
export default function MealCard(props: {
  meal: Meal;
  entries: LogEntry[];
  totals: MealTotals;
  units: Units;
  selecting: boolean;
  selected: Set<number>;
  onAdd: () => void;
  onOpen: (e: LogEntry) => void;
  onToggle: (e: LogEntry) => void;
  onLongPress: (e: LogEntry) => void;
}) {
  const { meal, entries, totals, units, selecting, selected } = props;
  const name = MEAL_NAMES[meal];
  return (
    <section aria-label={name} className="rounded-2xl bg-container p-4">
      <h2 className="text-lg font-bold">{meal === "supplements" ? name : `${name}: ${fmt(totals.calories)} cals`}</h2>
      {meal !== "supplements" && entries.length > 0 && (
        <p className="text-sm text-subtle tabular">{`${g(totals.protein_g)} protein · ${g(totals.carbs_g)} carbs · ${g(totals.fat_g)} fat · ${g(totals.fiber_g)} fiber`}</p>
      )}
      {entries.length === 0 && totals.suggested !== null && <p className="text-sm text-muted">{fmt(totals.suggested)} calories suggested</p>}
      {entries.length > 0 && (
        <ul className="mt-2 -mx-2">
          {entries.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              units={units}
              selecting={selecting}
              selected={selected.has(e.id)}
              onOpen={() => (selecting ? props.onToggle(e) : props.onOpen(e))}
              onLongPress={() => props.onLongPress(e)}
            />
          ))}
        </ul>
      )}
      <button type="button" onClick={props.onAdd} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:bg-primary-pressed">
        <Plus className="size-4" strokeWidth={3} /> Add Food
      </button>
    </section>
  );
}
