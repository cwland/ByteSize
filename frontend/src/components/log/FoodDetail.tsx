import { useState, type ReactNode } from "react";
import FoodPic from "./FoodPic";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatAmount, isBigAmount } from "../../amounts";
import { amountFactor, scaleNutrients } from "../../nutrition";
import type { NutrientKey, Nutrients, Portion, Serving, Start } from "../../types";
import { fmt } from "../../units";
import AmountPicker from "./AmountPicker";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { linkButton, primaryButton } from "../ui/styles";

export type DetailFood = { name: string; brand?: string | null; icon: string; imageUrl?: string | null; servings: Serving[]; nutrients: Nutrients /* per servings[0] */ };

// A sensible first portion: the food's own serving (e.g. "1 bar") rather than "100 g"
const ML_PER_FL_OZ = 29.5735;
const GRAMS_ONLY = /^\s*[\d.]+\s*(g|grams?)\s*$/i; // "240 g": a serving that names no volume
// "100 g", "100 ml", "8 fl oz", "1 L": an amount in a unit of weight or volume, not an item. Kitchen measures
// ("1 cup", "2 tbsp", "1 tsp") are NOT bare amounts: a drink whose only serving is "1 cup" starts at that serving
// (1 × "1 cup"), like "1 can", not at the cup's-worth fallback (defaultPortion.test.ts pins this).
const BARE_AMOUNT = /^\s*[\d.,/\s]+\s*(g|grams?|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|oz|fl\.?\s*oz)\s*$/i;

// Where a food starts: its own serving; a drink measured in grams starts in fl oz (or ml), same amount,
// or a cup's worth when its only serving is a bare amount ("100 ml"). A single serving that names an item
// ("1 shake", "1 bottle (500 ml)") starts at 1 of it.
export function defaultPortion(servings: Serving[], units: "imperial" | "metric" = "imperial"): Portion {
  const base = servings[0];
  // the food's own second serving ("1 bar" after "100 g"), never a unit the server worked out ("1 prune")
  const own = servings.length > 1 && !servings[1].derived ? servings[1] : null;
  if (base && !own && !BARE_AMOUNT.test(base.label)) return { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 };
  if (base?.ml && (!own || GRAMS_ONLY.test(own.label))) {
    const mlPerGram = base.grams ? base.ml / base.grams : 1;
    const ml = own ? (own.ml ?? (own.grams ?? 0) * mlPerGram) || 240 : 240;
    return units === "metric"
      ? { servingIndex: 0, unit: "ml", quantity: Math.round(ml), fraction: 1 }
      : { servingIndex: 0, unit: "fl_oz", quantity: Math.max(0.5, Math.round((ml / ML_PER_FL_OZ) * 2) / 2), fraction: 1 };
  }
  return { servingIndex: own ? 1 : 0, unit: "serving", quantity: 1, fraction: 1 };
}

// Where a food from search starts: a recipe, quick meal or restaurant item at 1 serving (a recipe's "100 g", a
// restaurant drink's ml must not turn into 8 fl oz), anything else as above
// A food the server sent a start for (0.15+) begins there — its package serving written its own way (2 | tbsp,
// 15 | g, 1 | slice) — unless it's a drink, which keeps its fl oz / ml start.
export const startingPortion = (food: { servings: Serving[]; foodKind?: string; source?: string; start?: Start }, units: "imperial" | "metric" = "imperial"): Portion => {
  if (food.foodKind === "recipe" || food.foodKind === "quick_meal") return { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 };
  if (food.start && !food.servings[0]?.ml) return { ...food.start, fraction: 1 };
  return food.source === "spoonacular" || food.source === "fatsecret"
    ? { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 }
    : defaultPortion(food.servings, units);
};

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
// The same sheet edits a logged entry (submitLabel "Save"; Move/Copy/Delete are in its title row).
export default function FoodDetail({
  food,
  initial,
  submitLabel,
  onSubmit,
  onEditFood,
  note,
  treat,
}: {
  food: DetailFood;
  initial: Portion;
  submitLabel: string;
  onSubmit: (p: Portion, treat: boolean) => Promise<void>;
  onEditFood?: () => void;
  note?: ReactNode; // under the name (a kept copy's "Saved copy from …" with Check for changes)
  // §40b: with the weekly bank on, a Treat switch (paid from the bank on purpose); bank: its balance this week
  treat?: { initial: boolean; bank: number };
}) {
  const [portion, setPortion] = useState<Portion>(initial);
  const [isTreat, setTreat] = useState(treat?.initial ?? false);
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const editable = food.servings.length > 0;
  const empty = !(portion.quantity * portion.fraction > 0);
  const n = nutrientsFor(food, portion);
  const chips = insights(n);
  const amount = formatAmount(food.servings, portion.servingIndex, portion.unit, portion.quantity, portion.fraction);

  // A big amount asks first (L1): more than 20 servings or 2,000 calories
  const trySubmit = () => {
    if (isBigAmount(food.servings, portion, n.calories)) setAsking(true);
    else void submit();
  };

  const submit = async () => {
    setAsking(false);
    setBusy(true);
    setMsg(null);
    try {
      await onSubmit(portion, isTreat);
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
          {note}
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
            <span className="font-semibold tabular">{`${fmt(v ?? 0)}${unit}` /* not said: 0 (§31) */}</span>
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
                <span className="tabular">{f.key === "calories" ? fmt(v ?? 0) : `${one(v ?? 0)} ${f.unit}`}</span>
              </p>
            );
          })}
        </div>
      </section>

      {treat && editable && (
        <label className={`${boxed} flex items-center gap-3 px-4 py-3`}>
          <input type="checkbox" checked={isTreat} onChange={(e) => setTreat(e.target.checked)} className="size-5 accent-[var(--color-action)]" />
          <span>
            <span className="block font-semibold">Treat</span>
            <span className="block text-sm text-subtle">{`Paid from your workout bank (${fmt(treat.bank)} this week)`}</span>
          </span>
        </label>
      )}

      <Notice msg={msg} />
      {asking && (
        <div role="alertdialog" aria-labelledby="big-amount" className={`${boxed} flex flex-col gap-3 p-4`}>
          <p id="big-amount" className="font-semibold">{`That's a lot — log ${fmt(n.calories ?? 0)} cal of ${food.name}?`}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAsking(false)} className={`${linkButton} flex-1 py-2`}>
              Change
            </button>
            <button type="button" onClick={() => void submit()} className={`${primaryButton} flex-1 py-2`}>
              Log it
            </button>
          </div>
        </div>
      )}
      {editable && !asking && (
        <button type="button" disabled={busy || empty} onClick={trySubmit} className={`${primaryButton} w-full py-3.5 text-lg`}>
          {submitLabel}
        </button>
      )}
    </div>
  );
}
