import { ArrowLeftRight } from "lucide-react";
import type { Day, NutrientKey, Range, Targets, Units } from "../../types";
import { linkButton } from "../ui/styles";
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

// The plan picker, as Goals › Change plan opens it
const openPlanPicker = () => (window.location.hash = "#/goals/plan");
const planName = (t: Targets) => (t.plan ? `${t.plan[0].toUpperCase()}${t.plan.slice(1)}` : "Your own targets");

// "Day totals" (a Dashboard widget): the plan in force that day with Change plan (§41; Pick a plan without one), then
// eaten vs the target range for the day ("—" where there is no target).
// The server sums a nutrient a food doesn't say as 0, and that number shows (§31).
export default function DayTotals({ day, units }: { day: Day; units: Units }) {
  const targets: Targets | null = day.targets;
  const amount = (row: Row, v: number) => (row.key === "water_ml" ? `${fmt(waterValue(v, units))} ${waterUnit(units)}` : `${fmt(v)}${row.unit ? ` ${row.unit}` : ""}`);
  const range = (row: Row, r: Range) =>
    row.key === "water_ml" ? `${fmt(waterValue(r.min, units))}–${fmt(waterValue(r.max, units))} ${waterUnit(units)}` : `${fmt(r.min)}–${fmt(r.max)}${row.unit ? ` ${row.unit}` : ""}`;
  return (
    <section aria-labelledby="day-totals" className="rounded-2xl bg-container p-5">
      <h2 id="day-totals" className="text-lg font-bold">
        Day totals
      </h2>
      {targets ? (
        <p className="mt-1 flex items-center gap-1 text-sm text-subtle">
          <span>{`Plan: ${planName(targets)}`}</span>
          <button type="button" aria-label="Change plan" title="Change plan" onClick={openPlanPicker} className="flex size-9 items-center justify-center rounded-full text-link hover:bg-pressed">
            <ArrowLeftRight aria-hidden="true" className="size-4" />
          </button>
        </p>
      ) : (
        <button type="button" onClick={openPlanPicker} className={`${linkButton} mt-1 text-sm`}>
          Pick a plan
        </button>
      )}
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
            const target = row.target && targets ? range(row, targets[row.target]) : "—";
            return (
              <tr key={row.key}>
                <th scope="row" className="py-2.5 text-left font-semibold">
                  {row.name}
                </th>
                <td className="py-2.5 text-right font-bold">
                  {amount(row, day.totals[row.key] ?? 0)}
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
