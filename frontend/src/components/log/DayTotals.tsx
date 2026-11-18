import type { LogEntry, NutrientKey, Range, Targets, Units } from "../../types";
import { fmt, waterUnit, waterValue } from "../../units";

type Row = { name: string; key: NutrientKey; unit: string; target?: keyof Pick<Targets, "calories" | "protein_g" | "fiber_g" | "water_ml"> };
const ROWS: Row[] = [
  { name: "Calories", key: "calories", unit: "", target: "calories" },
  { name: "Protein", key: "protein_g", unit: "g", target: "protein_g" },
  { name: "Carbs", key: "carbs_g", unit: "g" },
  { name: "Fat", key: "fat_g", unit: "g" },
  { name: "Fiber", key: "fiber_g", unit: "g", target: "fiber_g" },
  { name: "Sugar", key: "sugar_g", unit: "g" },
  { name: "Sodium", key: "sodium_mg", unit: "mg" },
  { name: "Water", key: "water_ml", unit: "", target: "water_ml" },
];

// What the day's entries add up to for one nutrient, from their snapshotted nutrients. Water is
// counted from every entry; for the rest only foods count (a water entry isn't missing fiber).
// known: null when every food lacks it (unknown, shown blank — never 0); partial when some do.
export function dayTotal(entries: LogEntry[], key: NutrientKey): { known: number | null; partial: boolean } {
  const list = key === "water_ml" ? entries : entries.filter((e) => e.source !== "water");
  const values = list.map((e) => e.nutrients[key]).filter((v): v is number => v !== undefined);
  if (key === "water_ml") return { known: values.reduce((s, v) => s + v, 0), partial: false };
  if (list.length > 0 && values.length === 0) return { known: null, partial: false };
  return { known: values.reduce((s, v) => s + v, 0), partial: values.length < list.length };
}

// The wide Log's "Day totals": eaten vs the target range for the day ("—" where there is no target)
export default function DayTotals({ entries, targets, units }: { entries: LogEntry[]; targets: Targets | null; units: Units }) {
  const amount = (row: Row, v: number) => (row.key === "water_ml" ? `${fmt(waterValue(v, units))} ${waterUnit(units)}` : `${fmt(v)}${row.unit ? ` ${row.unit}` : ""}`);
  const range = (row: Row, r: Range) =>
    row.key === "water_ml" ? `${fmt(waterValue(r.min, units))}–${fmt(waterValue(r.max, units))} ${waterUnit(units)}` : `${fmt(r.min)}–${fmt(r.max)}${row.unit ? ` ${row.unit}` : ""}`;
  return (
    <section aria-labelledby="day-totals" className="rounded-2xl bg-container p-5">
      <h2 id="day-totals" className="text-lg font-bold">
        Day totals
      </h2>
      <table aria-labelledby="day-totals" className="mt-3 w-full text-sm tabular">
        <thead>
          <tr className="border-b border-line text-left text-xs font-semibold text-muted">
            <th scope="col" className="pb-2 font-semibold">
              Nutrient
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              Eaten
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              Target
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {ROWS.map((row) => {
            const { known, partial } = dayTotal(entries, row.key);
            const target = row.target && targets ? range(row, targets[row.target]) : "—";
            return (
              <tr key={row.key}>
                <th scope="row" className="py-2.5 text-left font-semibold">
                  {row.name}
                </th>
                <td className="py-2.5 text-right font-bold">
                  {known !== null && amount(row, known)}
                  {partial && <span className="block text-xs font-normal text-muted">+ some unknown</span>}
                </td>
                <td className="py-2.5 text-right text-subtle">{target}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
