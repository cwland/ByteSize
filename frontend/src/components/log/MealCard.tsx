import { useRef, useState } from "react";
import FoodPic from "./FoodPic";
import { BookmarkPlus, Check, Plus } from "lucide-react";
import { api } from "../../api";
import { MEAL_NAMES } from "../../meals";
import { formatAmount } from "../../amounts";
import type { LogEntry, Meal, MealTotals, Units } from "../../types";
import { fmt } from "../../units";
import Pills from "./Pills";
import { BrandText, Tag } from "./FoodRow";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { primaryButton, secondaryButton } from "../ui/styles";

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
        <FoodPic icon={entry.icon} imageUrl={entry.imageUrl} size="size-9" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold">{entry.name}</span>
            {entry.treat && <Tag text="Treat" />}
          </span>
          <span className="block truncate text-sm text-subtle">
            {formatAmount(entry.servings, entry.servingIndex, entry.unit, entry.quantity, entry.fraction, units)}
            {entry.brand && <BrandText brand={entry.brand} restaurant={entry.restaurant} />}
          </span>
          {!water && (
            <span className="mt-1 block">
              <Pills n={entry.nutrients} />
            </span>
          )}
        </span>
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
  onSaveAsMeal?: () => void;
  /** Inside another card (the Food widget, §41): a section divided by a line (no card of its own; hover colours still show), with a heading under the card's own */
  inset?: boolean;
}) {
  const { meal, entries, totals, units, selecting, selected, inset } = props;
  const name = MEAL_NAMES[meal];
  const Heading = inset ? "h3" : "h2";
  return (
    <section aria-label={name} className={inset ? "border-t border-line pt-4" : "rounded-2xl bg-container p-4"}>
      <Heading className="text-lg font-bold">{meal === "supplements" ? name : `${name}: ${fmt(totals.calories)} cals`}</Heading>
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={props.onAdd} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:bg-primary-pressed">
          <Plus className="size-4" strokeWidth={3} /> Add Food
        </button>
        {props.onSaveAsMeal && entries.length > 0 && !selecting && (
          <button type="button" onClick={props.onSaveAsMeal} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-link hover:bg-pressed">
            <BookmarkPlus aria-hidden="true" className="size-4" /> Save as a meal
          </button>
        )}
      </div>
    </section>
  );
}

// "Save as a meal": this meal's entries and portions become a quick meal in My Foods. Water and foods
// that can't be found are left out, and listed.
export function SaveAsMealSheet({ meal, ids, onClose }: { meal: Meal; ids: number[]; onClose: () => void }) {
  const [name, setName] = useState<string>(MEAL_NAMES[meal]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [leftOut, setLeftOut] = useState<string[] | null>(null);

  const save = async () => {
    if (!name.trim()) return setMsg({ ok: false, text: "Give the meal a name" });
    setBusy(true);
    setMsg(null);
    try {
      const out = await api<{ food: { name: string }; leftOut: string[] }>("POST", "/api/my-foods/meals/from-entries", { name: name.trim(), ids });
      setMsg({ ok: true, text: `Saved ${out.food.name} to My Foods` });
      setLeftOut(out.leftOut);
    } catch (e) {
      setMsg(errorMsg(e));
    }
    setBusy(false);
  };

  return (
    <Sheet label="Save as a meal" onClose={onClose}>
      {leftOut === null ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm text-subtle">Saves these foods and portions as a quick meal you can log in one tap.</p>
          <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Notice msg={msg} />
          <button type="submit" disabled={busy} className={`${primaryButton} self-start`}>
            Save
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <Notice msg={msg} />
          {leftOut.length > 0 && <p className="text-sm text-subtle">{`Left out: ${leftOut.join(", ")}`}</p>}
          <button type="button" onClick={onClose} className={`${secondaryButton} self-start`}>
            Done
          </button>
        </div>
      )}
    </Sheet>
  );
}
