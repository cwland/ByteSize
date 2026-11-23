import { FRACTION_CHOICES, exactFraction, splitWhole, unitChoices } from "../../amounts";
import type { Portion, Serving, Unit } from "../../types";

const select = "w-full rounded-xl border border-line bg-page px-2 py-2.5 text-center text-lg font-semibold text-ink outline-none focus:border-action";

// Whole numbers 0–20; grams and ml every number to 1,000 (144 g is there, nothing skipped)
export function wholeChoices(unit: Unit, current: number) {
  const out = Array.from({ length: unit === "g" || unit === "ml" ? 1001 : 21 }, (_, i) => i);
  if (!out.includes(current)) out.push(current);
  return out.sort((a, b) => a - b);
}

const valueOf = (p: Portion) => (p.unit === "serving" ? `s:${p.servingIndex}` : p.unit);

// Three columns, like a phone's wheel picker: whole number · fraction · unit. Amounts are sent as
// quantity = whole + fraction with fraction 1.
export default function AmountPicker({ servings, portion, onChange }: { servings: Serving[]; portion: Portion; onChange: (p: Portion) => void }) {
  const { whole, fraction } = splitWhole(portion.quantity * portion.fraction);
  const set = (w: number, f: number) => onChange({ ...portion, quantity: w + exactFraction(f), fraction: 1 });

  const pickUnit = (v: string) => {
    const next: Pick<Portion, "servingIndex" | "unit"> = v.startsWith("s:") ? { servingIndex: Number(v.slice(2)), unit: "serving" } : { servingIndex: 0, unit: v as Unit };
    // the number stays; only the unit changes (3 cups → 3 tbsp)
    const q = portion.quantity * portion.fraction || 1;
    onChange({ ...next, quantity: q, fraction: 1 });
  };

  return (
    <div className="grid grid-cols-[1fr_1fr_2fr] gap-2">
      <select aria-label="Whole number" value={whole} onChange={(e) => set(Number(e.target.value), fraction)} className={select}>
        {wholeChoices(portion.unit, whole).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <select aria-label="Fraction" value={fraction} onChange={(e) => set(whole, Number(e.target.value))} className={select}>
        {FRACTION_CHOICES.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <select aria-label="Unit" value={valueOf(portion)} onChange={(e) => pickUnit(e.target.value)} className={select}>
        {unitChoices(servings).map((u) => (
          <option key={u.value} value={u.value}>
            {u.label}
          </option>
        ))}
      </select>
    </div>
  );
}
