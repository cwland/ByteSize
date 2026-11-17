import { useState, type ReactNode } from "react";
import FoodPic from "./FoodPic";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatAmount } from "../../amounts";
import { amountFactor, scaleNutrients } from "../../nutrition";
import type { NutrientKey, Nutrients, Portion, Serving } from "../../types";
import { fmt } from "../../units";
import AmountPicker from "./AmountPicker";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { linkButton, primaryButton } from "../ui/styles";

export type DetailFood = { name: string; brand?: string | null; icon: string; imageUrl?: string | null; servings: Serving[]; nutrients: Nutrients /* per servings[0] */ };

// A sensible first portion: the food's own serving (e.g. "1 bar") rather than "100 g"
const ML_PER_FL_OZ = 29.5735;
const GRAMS_ONLY = /^\s*[\d.]+\s*(g|grams?)\s*$/i; // "240 g": a serving that names no volume

// Where a food starts: its own serving; a drink measured in grams starts in fl oz (or ml), same amount,
// or a cup's worth when it's only known per 100 g
export function defaultPortion(servings: Serving[], units: "imperial" | "metric" = "imperial"): Portion {
  const base = servings[0];
  const own = servings.length > 1 ? servings[1] : null;
  if (base?.ml && (!own || GRAMS_ONLY.test(own.label))) {
    const mlPerGram = base.grams ? base.ml / base.grams : 1;
    const ml = own ? (own.ml ?? (own.grams ?? 0) * mlPerGram) || 240 : 240;
    return units === "metric"
      ? { servingIndex: 0, unit: "ml", quantity: Math.round(ml), fraction: 1 }
      : { servingIndex: 0, unit: "fl_oz", quantity: Math.max(0.5, Math.round((ml / ML_PER_FL_OZ) * 2) / 2), fraction: 1 };
  }
  return { servingIndex: own ? 1 : 0, unit: "serving", quantity: 1, fraction: 1 };
}

// Nutrients for an amount ({} = unknown when the amount can't be measured)
export function nutrientsFor(food: { servings: Serving[]; nutrients: Nutrients }, p: Portion): Nutrients {
  try {
    return scaleNutrients(food.nutrients, amountFactor(food.servings, p.servingIndex, p.unit, p.quantity) * p.fraction);
  } catch {
    return {};
  }
}

const one = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");

export function insights(n: Nutrients): string[] {
  const out: string[] = [];
  const p = n.protein_g;
  if (p !== undefined && p >= 15 && (n.calories === undefined || n.calories === 0 || (p * 4) / n.calories >= 0.25)) out.push("High in protein");
  if (n.fiber_g !== undefined && n.fiber_g >= 5) out.push("High in fiber");
  else if (n.fiber_g !== undefined && n.fiber_g >= 3) out.push("Good source of fiber");
  if (n.sodium_mg !== undefined && n.sodium_mg >= 600) out.push("High in sodium");
  if (n.added_sugar_g !== undefined && n.added_sugar_g >= 10) out.push("High in added sugar");
  return out;
}

const FACTS: { key: NutrientKey; label: string; unit: string; sub?: boolean }[] = [
  { key: "calories", label: "Calories", unit: "" },
  { key: "fat_g", label: "Fat", unit: "g" },
  { key: "saturated_fat_g", label: "Saturated fat", unit: "g", sub: true },
  { key: "sodium_mg", label: "Sodium", unit: "mg" },
  { key: "carbs_g", label: "Carbohydrates", unit: "g" },
  { key: "fiber_g", label: "Fiber", unit: "g", sub: true },
  { key: "sugar_g", label: "Sugars", unit: "g", sub: true },
  { key: "added_sugar_g", label: "Added sugars", unit: "g", sub: true },
  { key: "protein_g", label: "Protein", unit: "g" },
  { key: "potassium_mg", label: "Potassium", unit: "mg" },
  { key: "magnesium_mg", label: "Magnesium", unit: "mg" },
];

const boxed = "rounded-2xl border border-line";

// "Track food": summary, the amount (whole + fraction + unit), insights, nutrition facts, and Track.
// The same sheet edits a logged entry (submitLabel "Save", with Move/Copy/Delete as children).
export default function FoodDetail({
  food,
  initial,
  submitLabel,
  onSubmit,
  onEditFood,
  children,
}: {
  food: DetailFood;
  initial: Portion;
  submitLabel: string;
  onSubmit: (p: Portion) => Promise<void>;
  onEditFood?: () => void;
  children?: ReactNode;
}) {
  const [portion, setPortion] = useState<Portion>(initial);
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const editable = food.servings.length > 0;
  const empty = !(portion.quantity * portion.fraction > 0);
  const n = nutrientsFor(food, portion);
  const chips = insights(n);
  const amount = formatAmount(food.servings, portion.servingIndex, portion.unit, portion.quantity, portion.fraction);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await onSubmit(portion);
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };

  const summary: [string, number | undefined, string][] = [
    ["Calories", n.calories, ""],
    ["Protein", n.protein_g, " g"],
    ["Fiber", n.fiber_g, " g"],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <FoodPic icon={food.icon} imageUrl={food.imageUrl} size="size-12" />
        <div className="min-w-0">
          <h3 className="text-xl font-bold">{food.name}</h3>
          {food.brand && <p className="text-sm text-subtle">{food.brand}</p>}
          {onEditFood && (
            <button type="button" onClick={onEditFood} className={`${linkButton} text-sm`}>
              Edit food
            </button>
          )}
        </div>
      </div>

      <section aria-label="Summary" className={`${boxed} divide-y divide-line px-4`}>
        {summary.map(([label, v, unit]) => (
          <p key={label} className="flex items-center justify-between py-3">
            <span>{label}</span>
            <span className="font-semibold tabular">{v === undefined ? "?" : `${fmt(v)}${unit}`}</span>
          </p>
        ))}
      </section>

      {editable ? (
        <div className={boxed}>
          <button type="button" aria-expanded={picking} onClick={() => setPicking((p) => !p)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
            <span>Serving</span>
            <span className="flex items-center gap-1 font-semibold">
              {empty ? "Choose an amount" : amount}
              {picking ? <ChevronUp aria-hidden="true" className="size-4" /> : <ChevronDown aria-hidden="true" className="size-4" />}
            </span>
          </button>
          {picking && (
            <div className="px-3 pb-3">
              <AmountPicker servings={food.servings} portion={portion} onChange={setPortion} />
            </div>
          )}
        </div>
      ) : (
        <p className="text-subtle">This entry's amount can't be changed here.</p>
      )}

      <section aria-label="Nutritional insights" className={`${boxed} px-4 py-3`}>
        <h4 className="font-bold">Nutritional insights</h4>
        {chips.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <li key={c} className="rounded-full bg-pressed px-2.5 py-1 text-xs font-semibold">
                {c}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-subtle">Nothing stands out for this amount.</p>
        )}
      </section>

      <section aria-label="Nutrition facts" className={`${boxed} px-4 py-3`}>
        <h4 className="font-bold">Nutrition facts</h4>
        <div className="mt-1 divide-y divide-line">
          {FACTS.map((f) => {
            const v = n[f.key];
            return (
              <p key={f.key} className={`flex items-center justify-between py-2 text-sm ${f.sub ? "pl-4 text-subtle" : ""}`}>
                <span>{f.label}</span>
                <span className="tabular">{v === undefined ? "—" : f.key === "calories" ? fmt(v) : `${one(v)} ${f.unit}`}</span>
              </p>
            );
          })}
        </div>
      </section>

      <Notice msg={msg} />
      {editable && (
        <button type="button" disabled={busy || empty} onClick={submit} className={`${primaryButton} w-full py-3.5 text-lg`}>
          {submitLabel}
        </button>
      )}
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
