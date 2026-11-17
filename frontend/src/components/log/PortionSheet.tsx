import { useState, type ReactNode } from "react";
import { MEALS, MEAL_NAMES } from "../../meals";
import { FRACTIONS, UNIT_LABEL, amountFactor, scaleNutrients, unitChoices } from "../../nutrition";
import type { Meal, Nutrients, Portion, Serving, Unit } from "../../types";
import { fmt } from "../../units";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label as labelClass, primaryButton } from "../ui/styles";

export type PortionFood = { name: string; icon: string; servings: Serving[]; nutrients: Nutrients /* per servings[0] */ };

// A sensible first portion: the food's own serving (e.g. "1 bar") rather than "100 g"
export const defaultPortion = (servings: Serving[]): Portion => ({ servingIndex: servings.length > 1 ? 1 : 0, unit: "serving", quantity: 1, fraction: 1 });

// The base serving's size in another unit (switching to g starts at the serving's grams)
function sizeIn(servings: Serving[], unit: Unit) {
  try {
    return Math.round((1 / amountFactor(servings, 0, unit, 1)) * 10) / 10;
  } catch {
    return 1;
  }
}

const preview = (n: Nutrients) =>
  [
    `${fmt(n.calories ?? 0)} cal`,
    n.protein_g === undefined ? "protein unknown" : `${n.protein_g} g protein`,
    n.fiber_g === undefined ? "fiber unknown" : `${n.fiber_g} g fiber`,
  ].join(" · ");

// Serving picker, quantity, fraction chips ¼ ⅓ ½ ¾ Full, a live preview, and (when logging) the meal
export default function PortionSheet({
  food,
  initial,
  meal: initialMeal,
  submitLabel,
  onSubmit,
  children,
}: {
  food: PortionFood;
  initial: Portion;
  meal?: Meal; // shown as a meal picker when given
  submitLabel: string;
  onSubmit: (p: Portion, meal: Meal) => Promise<void>;
  children?: ReactNode; // extra actions (Move, Copy, Delete)
}) {
  const [portion, setPortion] = useState<Portion>(initial);
  const [qty, setQty] = useState(String(initial.quantity));
  const [meal, setMeal] = useState<Meal>(initialMeal ?? "snacks");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const units = unitChoices(food.servings);
  const editable = food.servings.length > 0;

  let shown: string;
  try {
    const q = Number(qty);
    if (!(q > 0)) throw new Error("Enter an amount");
    shown = preview(scaleNutrients(food.nutrients, amountFactor(food.servings, portion.servingIndex, portion.unit, q) * portion.fraction));
  } catch (e) {
    shown = (e as Error).message;
  }

  const pick = (v: string) => {
    if (v.startsWith("s:")) {
      setPortion((p) => ({ ...p, servingIndex: Number(v.slice(2)), unit: "serving" }));
      setQty("1");
    } else {
      const unit = v as Unit;
      setPortion((p) => ({ ...p, servingIndex: 0, unit, fraction: 1 }));
      setQty(String(sizeIn(food.servings, unit)));
    }
  };

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await onSubmit({ ...portion, quantity: Number(qty) }, meal);
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-lg font-semibold">
        <span aria-hidden="true">{food.icon}</span>
        {food.name}
      </p>
      {editable ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Serving
              <select aria-label="Serving" value={portion.unit === "serving" ? `s:${portion.servingIndex}` : portion.unit} onChange={(e) => pick(e.target.value)} className={field}>
                {food.servings.map((s, i) => (
                  <option key={`s${i}`} value={`s:${i}`}>
                    {s.label}
                  </option>
                ))}
                {units.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABEL[u]}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Quantity
              <input aria-label="Quantity" type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={field} />
            </label>
          </div>
          <div role="radiogroup" aria-label="Fraction" className="flex gap-2">
            {FRACTIONS.map((f) => (
              <button
                key={f.label}
                type="button"
                role="radio"
                aria-checked={Math.abs(portion.fraction - f.value) < 0.001}
                onClick={() => setPortion((p) => ({ ...p, fraction: f.value }))}
                className={`flex-1 rounded-full py-1.5 text-sm font-bold ${Math.abs(portion.fraction - f.value) < 0.001 ? "bg-primary text-on-primary" : "bg-pressed text-ink hover:bg-strong"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <p data-testid="portion-preview" className="rounded-xl bg-page px-3 py-2 text-center font-semibold tabular">
            {shown}
          </p>
        </>
      ) : (
        <p className="text-subtle">This entry's amount can't be changed here.</p>
      )}
      {initialMeal && (
        <label className={labelClass}>
          Meal
          <select aria-label="Meal" value={meal} onChange={(e) => setMeal(e.target.value as Meal)} className={field}>
            {MEALS.map((m) => (
              <option key={m} value={m}>
                {MEAL_NAMES[m]}
              </option>
            ))}
          </select>
        </label>
      )}
      <Notice msg={msg} />
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <button type="button" disabled={busy} onClick={submit} className={primaryButton}>
            {submitLabel}
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
