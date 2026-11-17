import { useState, type FormEvent } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../api";
import { NUTRIENT_KEYS, type FoodResult, type NutrientKey, type Nutrients, type Serving } from "../../types";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label as labelClass, primaryButton, secondaryButton } from "../ui/styles";

export type FoodDraft = {
  name: string;
  brand: string | null;
  barcode: string | null;
  servings: Serving[];
  nutrients: Nutrients;
  aiFields: string[];
  category?: string;
};
// create: a new custom food · edit: one of mine · override: my correction of a database food
export type FoodFormMode = { kind: "create" } | { kind: "edit"; id: number } | { kind: "override"; cacheId: number };

export const NUTRIENT_LABELS: Record<NutrientKey, string> = {
  calories: "Calories",
  protein_g: "Protein (g)",
  fiber_g: "Fiber (g)",
  carbs_g: "Carbs (g)",
  fat_g: "Fat (g)",
  sugar_g: "Sugar (g)",
  added_sugar_g: "Added sugar (g)",
  sugar_alcohol_g: "Sugar alcohol (g)",
  sodium_mg: "Sodium (mg)",
  potassium_mg: "Potassium (mg)",
  magnesium_mg: "Magnesium (mg)",
  water_ml: "Water (ml)",
};
export const emptyDraft = (over: Partial<FoodDraft> = {}): FoodDraft => ({ name: "", brand: null, barcode: null, servings: [{ label: "1 serving" }], nutrients: {}, aiFields: [], ...over });
export const draftOf = (f: FoodResult & { category?: string }): FoodDraft => ({
  name: f.name,
  brand: f.brand,
  barcode: f.barcode,
  servings: f.servings,
  nutrients: f.nutrients,
  aiFields: f.aiFields,
  ...(f.category ? { category: f.category } : {}),
});

type ServingRow = { label: string; grams: string; ml: string };
const toRow = (s: Serving): ServingRow => ({ label: s.label, grams: s.grams === undefined ? "" : String(s.grams), ml: s.ml === undefined ? "" : String(s.ml) });
const fromRow = (r: ServingRow): Serving => ({ label: r.label.trim(), ...(r.grams ? { grams: Number(r.grams) } : {}), ...(r.ml ? { ml: Number(r.ml) } : {}) });

// Name, brand, barcode, servings and the 12 nutrients (blank = unknown). AI guesses are marked until edited.
export default function FoodForm({ mode, draft, fillRef, onSaved }: { mode: FoodFormMode; draft: FoodDraft; fillRef?: { kind: "cache" | "user_food"; id: number }; onSaved: (f: FoodResult) => void }) {
  const [name, setName] = useState(draft.name);
  const [brand, setBrand] = useState(draft.brand ?? "");
  const [barcode, setBarcode] = useState(draft.barcode ?? "");
  const [servings, setServings] = useState<ServingRow[]>(() => (draft.servings.length ? draft.servings : [{ label: "1 serving" }]).map(toRow));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, draft.nutrients[k] === undefined ? "" : String(draft.nutrients[k])])));
  const [ai, setAi] = useState(() => new Set(draft.aiFields));
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const setNutrient = (k: string, v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    setAi((s) => {
      const next = new Set(s);
      next.delete(k); // checked by a person: no longer a guess
      return next;
    });
  };
  const setServing = (i: number, patch: Partial<ServingRow>) => setServings((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const unknowns = NUTRIENT_KEYS.filter((k) => values[k] === "");

  const fillGaps = async () => {
    if (!fillRef) return;
    try {
      const out = await api<{ nutrients: Nutrients; aiFields: string[] }>("POST", "/api/ai/fill-gaps", { food: fillRef });
      setValues((s) => ({ ...s, ...Object.fromEntries(Object.entries(out.nutrients).filter(([k]) => s[k] === "").map(([k, v]) => [k, String(v)])) }));
      setAi((s) => new Set([...s, ...out.aiFields]));
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const rows = servings.filter((r, i) => i === 0 || r.label.trim());
    if (!name.trim()) return setMsg({ ok: false, text: "Give the food a name" });
    if (!rows[0].label.trim()) return setMsg({ ok: false, text: "Name the serving size, like “1 cup”" });
    const nutrients: Nutrients = Object.fromEntries(NUTRIENT_KEYS.filter((k) => values[k] !== "").map((k) => [k, Number(values[k])]));
    const common = { name: name.trim(), brand: brand.trim() || null, servings: rows.map(fromRow), nutrients };
    setBusy(true);
    try {
      let out: { food: FoodResult };
      if (mode.kind === "override") out = await api("POST", "/api/my-foods/override", { cacheId: mode.cacheId, ...common });
      else {
        const body = { ...common, barcode: barcode.trim() || null, aiFields: [...ai].filter((k) => values[k] !== ""), ...(draft.category ? { category: draft.category } : {}) };
        out = mode.kind === "edit" ? await api("PATCH", `/api/my-foods/${mode.id}`, body) : await api("POST", "/api/my-foods", body);
      }
      onSaved(out.food);
    } catch (err) {
      setMsg(errorMsg(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {mode.kind === "override" && <p className="text-sm text-subtle">Saved as your version of this food. Searching or typing its barcode finds yours from now on.</p>}
      {ai.size > 0 && <p className="text-sm text-subtle">Values marked AI estimate are guesses. Check them against the label if you can.</p>}
      <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <Field label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
      {mode.kind !== "override" && <Field label="Barcode" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} />}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Servings (nutrients are for the first)</legend>
        {servings.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_5rem_auto] items-end gap-2">
            <input aria-label={i === 0 ? "Serving size" : `Serving ${i + 1}`} placeholder="1 cup" value={r.label} onChange={(e) => setServing(i, { label: e.target.value })} className={field} />
            <input aria-label={i === 0 ? "Grams" : `Serving ${i + 1} grams`} placeholder="g" type="number" step="any" value={r.grams} onChange={(e) => setServing(i, { grams: e.target.value })} className={field} />
            <input aria-label={i === 0 ? "Milliliters" : `Serving ${i + 1} ml`} placeholder="ml" type="number" step="any" value={r.ml} onChange={(e) => setServing(i, { ml: e.target.value })} className={field} />
            {i > 0 ? (
              <button type="button" aria-label={`Remove serving ${i + 1}`} onClick={() => setServings((rows) => rows.filter((_, j) => j !== i))} className="mb-2 text-subtle hover:text-error">
                <Trash2 className="size-5" />
              </button>
            ) : (
              <span className="w-5" />
            )}
          </div>
        ))}
        <button type="button" onClick={() => setServings((rows) => [...rows, { label: "", grams: "", ml: "" }])} className="inline-flex items-center gap-1 self-start text-sm font-semibold text-link">
          <Plus className="size-4" /> Add a serving
        </button>
      </fieldset>

      <fieldset className="grid grid-cols-2 gap-x-3 gap-y-2">
        <legend className="mb-1 text-sm font-semibold">Nutrition per first serving (blank = unknown)</legend>
        {NUTRIENT_KEYS.map((k) => (
          <label key={k} className={labelClass}>
            <span className="flex items-center gap-1.5">
              {NUTRIENT_LABELS[k]}
              {ai.has(k) && <span className="rounded-full bg-active px-1.5 text-[10px] font-bold text-action">AI estimate</span>}
            </span>
            <input aria-label={NUTRIENT_LABELS[k]} type="number" step="any" min="0" value={values[k]} onChange={(e) => setNutrient(k, e.target.value)} className={field} />
          </label>
        ))}
      </fieldset>

      <Notice msg={msg} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          Save food
        </button>
        {fillRef && unknowns.length > 0 && (
          <button type="button" onClick={fillGaps} className={`${secondaryButton} inline-flex items-center gap-1.5`}>
            <Sparkles className="size-4" /> Fill gaps with AI
          </button>
        )}
      </div>
    </form>
  );
}
