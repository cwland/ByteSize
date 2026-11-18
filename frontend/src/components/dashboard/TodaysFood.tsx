import { Plus } from "lucide-react";
import { formatAmount } from "../../amounts";
import { MEALS, MEAL_NAMES } from "../../meals";
import { dayLabel } from "../../selectedDay";
import type { Day, Meal, Units } from "../../types";
import { fmt } from "../../units";
import FoodPic from "../log/FoodPic";

// The wide Dashboard's middle column: the selected day's food by meal with calories, "Open the log",
// and "+ Add food" under an empty meal with its suggested calories. Water isn't food: it's left out
// (Supplements shows only when it holds something besides water).
export default function TodaysFood({ data, isToday, units, onAdd }: { data: Day | null; isToday: boolean; units: Units; onAdd: (meal: Meal) => void }) {
  const title = isToday || !data ? "Today's food" : `Food on ${dayLabel(data.day)}`;
  const food = (data?.entries ?? []).filter((e) => e.source !== "water");
  return (
    <section aria-label={title} className="rounded-2xl bg-container p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <a href="#/log" className="rounded-full px-2 py-1 text-sm font-bold text-link hover:bg-pressed">
          Open the log
        </a>
      </div>
      {data &&
        MEALS.map((m) => {
          const entries = food.filter((e) => e.meal === m);
          if (m === "supplements" && !entries.length) return null;
          const totals = data.meals[m];
          return (
            <div key={m} role="group" aria-label={MEAL_NAMES[m]} className="mt-4">
              <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                <h3 className="font-bold">{MEAL_NAMES[m]}</h3>
                {entries.length > 0 ? (
                  <span className="text-sm text-subtle tabular">{`${fmt(totals.calories)} cals`}</span>
                ) : (
                  totals.suggested !== null && <span className="text-sm text-subtle tabular">{`${fmt(totals.suggested)} calories suggested`}</span>
                )}
              </div>
              {entries.length > 0 ? (
                <ul className="mt-1">
                  {entries.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 py-2">
                      <FoodPic icon={e.icon} imageUrl={e.imageUrl} size="size-9" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{e.name}</span>
                        <span className="block truncate text-sm text-subtle">{formatAmount(e.servings, e.servingIndex, e.unit, e.quantity, e.fraction, units)}</span>
                      </span>
                      <span className="font-bold tabular">{e.nutrients.calories === undefined ? "?" : fmt(e.nutrients.calories)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <button
                  type="button"
                  aria-label={`Add food to ${MEAL_NAMES[m]}`}
                  onClick={() => onAdd(m)}
                  className="mt-3 inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:bg-primary-pressed"
                >
                  <Plus aria-hidden="true" className="size-4" strokeWidth={3} /> Add food
                </button>
              )}
            </div>
          );
        })}
    </section>
  );
}
