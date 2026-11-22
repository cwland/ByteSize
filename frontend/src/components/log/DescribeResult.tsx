import { useState } from "react";
import { X } from "lucide-react";
import { api } from "../../api";
import { notifyDayChanged } from "../../day";
import { amountFactor, scaleNutrients } from "../../nutrition";
import type { Meal, Nutrients } from "../../types";
import { AiWorking, useEstimate, type EstimateItem, type ItemsEstimate } from "./useEstimate";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, noAutofill, primaryButton, secondaryButton } from "../ui/styles";

// Describe it with several foods (2026-11-22 design): log them as One meal (one entry, opens first) or as Separate
// items (one entry per checked food). Every food's amount can change, any can be removed and more added (asked of the
// AI); the totals follow, and every change stays when switching. One food: no switch, just its line.

type Line = EstimateItem & { key: number; amount: string; included: boolean };
type Mode = "meal" | "items";

const qty = (l: Line) => Number(l.amount);
const valid = (l: Line) => Number.isFinite(qty(l)) && qty(l) > 0 && qty(l) <= 100;
function nutrientsOf(l: Line): Nutrients {
  if (!valid(l)) return {};
  try {
    return scaleNutrients(l.food.nutrients, amountFactor(l.food.servings, l.servingIndex, "serving", qty(l)));
  } catch {
    return {};
  }
}
const KEYS = [
  ["calories", "Calories", ""],
  ["protein_g", "Protein", " g"],
  ["carbs_g", "Carbs", " g"],
  ["fat_g", "Fat", " g"],
  ["fiber_g", "Fiber", " g"],
] as const;
const round = (n: number) => Math.round(n);

let nextKey = 1;
const linesOf = (items: EstimateItem[]): Line[] => items.map((i) => ({ ...i, key: nextKey++, amount: String(i.quantity), included: true }));

export default function DescribeResult({ result, day, meal, onLogged }: { result: ItemsEstimate; day: string; meal: Meal; onLogged: (what: string) => void }) {
  const switchable = result.mealName !== null;
  const [mode, setMode] = useState<Mode>(switchable ? "meal" : "items");
  const [name, setName] = useState(result.mealName ?? "");
  const [save, setSave] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => linesOf(result.items));
  const [more, setMore] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const adding = useEstimate();

  const counted = lines.filter((l) => mode === "meal" || l.included);
  const totals: Record<string, number> = {};
  for (const l of counted) for (const [k, v] of Object.entries(nutrientsOf(l))) if (typeof v === "number") totals[k] = (totals[k] ?? 0) + v;
  const update = (key: number, change: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));
  const remove = (key: number) => setLines((ls) => ls.filter((l) => l.key !== key));
  const ready = counted.length > 0 && counted.every(valid) && (mode === "items" || !!name.trim());
  const logLabel = mode === "meal" ? `Log ${name.trim() || "meal"}` : `Log ${counted.length} item${counted.length === 1 ? "" : "s"}`;

  const addFood = async () => {
    setMsg(null);
    try {
      const out = await adding.runItems(more);
      if (!out) return; // cancelled
      setLines((ls) => [...ls, ...linesOf(out.items)]);
      setMore("");
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };
  const log = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const items = counted.map((l) => ({ name: l.food.name, brand: l.food.brand, icon: l.food.icon, servings: l.food.servings, nutrients: l.food.nutrients, servingIndex: l.servingIndex, quantity: qty(l), fraction: 1 }));
      await api("POST", "/api/log/estimates", { day, meal, items, ...(mode === "meal" ? { combine: { name: name.trim(), save } } : {}) });
      notifyDayChanged();
      onLogged(mode === "meal" ? name.trim() : `${counted.length} item${counted.length === 1 ? "" : "s"}`);
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {switchable && (
        <div role="radiogroup" aria-label="Log as" className="inline-flex self-start rounded-xl bg-pressed p-1">
          {(
            [
              ["meal", "One meal"],
              ["items", "Separate items"],
            ] as const
          ).map(([m, text]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded-lg px-4 py-1.5 text-sm ${mode === m ? "bg-container font-semibold text-ink shadow-sm" : "text-subtle"}`}>
              {text}
            </button>
          ))}
        </div>
      )}

      {mode === "meal" && (
        <label className="block text-sm font-medium text-subtle">
          Meal name
          <input {...noAutofill} type="text" value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
      )}

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-2xl bg-pressed px-4 py-3">
        <p data-testid="describe-total" className="text-2xl font-bold">
          {round(totals.calories ?? 0)} <span className="text-sm font-normal text-subtle">cal</span>
        </p>
        {KEYS.slice(1).map(([k, text, unit]) => (
          <p key={k} className="text-sm text-subtle">
            <span className="font-semibold text-ink">
              {round(totals[k] ?? 0)}
              {unit}
            </span>{" "}
            {text}
          </p>
        ))}
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">{mode === "meal" ? "Made with" : "What the AI found"}</p>
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {lines.map((l) => (
            <li key={l.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              {mode === "items" && (
                <input type="checkbox" aria-label={`Include ${l.food.name}`} checked={l.included} onChange={(e) => update(l.key, { included: e.target.checked })} className="size-5 accent-[var(--color-action)]" />
              )}
              <span className="min-w-0 flex-1 basis-40">
                <span className="block font-medium">{l.food.name}</span>
                <span className="block text-sm text-subtle">{round(nutrientsOf(l).calories ?? 0)} cal</span>
              </span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  aria-label={`Amount of ${l.food.name}`}
                  min={0.25}
                  max={100}
                  step={0.25}
                  value={l.amount}
                  onChange={(e) => update(l.key, { amount: e.target.value })}
                  className="w-20 rounded-lg border border-line bg-page px-2 py-1.5 text-ink"
                />
                {l.food.servings.length > 1 ? (
                  <select aria-label={`Serving of ${l.food.name}`} value={l.servingIndex} onChange={(e) => update(l.key, { servingIndex: Number(e.target.value) })} className="rounded-lg border border-line bg-page px-2 py-1.5 text-ink">
                    {l.food.servings.map((s, i) => (
                      <option key={i} value={i}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm text-subtle">× {l.food.servings[0]?.label}</span>
                )}
              </span>
              <button type="button" aria-label={`Remove ${l.food.name}`} title="Remove" onClick={() => remove(l.key)} className="rounded-full p-1.5 text-muted hover:bg-pressed hover:text-ink">
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          {...noAutofill}
          type="text"
          aria-label="Add a food"
          placeholder="Add a food, e.g. a black coffee"
          value={more}
          onChange={(e) => setMore(e.target.value)}
          className="min-w-0 flex-[999_1_14rem] rounded-xl border border-line bg-page px-3 py-2 text-ink"
        />
        <button type="button" title="Ask the AI for this food and add it" disabled={more.trim().length < 2 || !!adding.step} onClick={() => void addFood()} className={`${secondaryButton} px-4 py-2 text-sm`}>
          Add
        </button>
        <AiWorking step={adding.step} onCancel={adding.cancel} />
      </div>

      {mode === "meal" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="size-5 accent-[var(--color-action)]" />
          Save to My foods
        </label>
      )}

      <Notice msg={msg} />
      <button type="button" disabled={!ready || busy} onClick={() => void log()} className={primaryButton}>
        {logLabel}
      </button>
    </div>
  );
}
