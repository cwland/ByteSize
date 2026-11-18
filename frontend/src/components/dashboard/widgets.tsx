import { useState } from "react";
import { Flame, GlassWater } from "lucide-react";
import { api } from "../../api";
import { notifyDayChanged, useSettingsMe } from "../../day";
import { useSession } from "../../session";
import type { Day } from "../../types";
import { fmt, waterUnit, waterValue } from "../../units";
import DayTotals from "../log/DayTotals";
import Glp1Card from "../glp1/Glp1Card";
import WeightCard from "../weight/WeightCard";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton, secondaryButton } from "../ui/styles";
import FoodWidget from "./FoodWidget";
import Gauge from "./Gauge";
import Ring from "./Ring";
import type { LayoutWidget } from "./layout";

// The Dashboard's widget registry (§28): the one list the Dashboard, the Add widget list and the layout read.
// Adding a widget later means adding one entry here (and its id to backend/src/lib/widgets.ts, which a test
// keeps in step). column: where it sits by default (0 left, 1 middle, 2 right; registry order within a column).
// fits: a hint for the library (narrow cards suit any column; wide ones want room). onlyWhen: shown only then.

// What every widget gets: the selected day (loaded once by the Dashboard) and the screen width
export type WidgetProps = { day: string; data: Day | null; isToday: boolean; wide: boolean };
export type WidgetDef = LayoutWidget & {
  title: string;
  description: string; // one line, for the Add widget list
  fits: "narrow" | "wide";
  onlyWhen?: string; // e.g. "Shows when GLP-1 is on" (the widget hides itself otherwise)
  Component: (p: WidgetProps) => JSX.Element | null;
};

function Budget({ data }: WidgetProps) {
  const { user } = useSession();
  const [calWhy, setCalWhy] = useState(false);
  const t = data?.targets ?? null;
  const food = data?.totals.calories ?? 0;
  const unknown = data?.totals.unknownCount ?? {};
  const water = (ml: number) => waterValue(ml, user.units);
  return (
    <section aria-label="Budget" className="rounded-2xl bg-container p-5">
      <h2 className="text-lg font-bold">{t ? `Budget: ${fmt(t.calories.min)}–${fmt(t.calories.max)} cals` : "Budget"}</h2>
      {t ? (
        <div className="mt-3 grid grid-cols-[4.5rem_1fr_4.5rem] items-end gap-2">
          <div className="text-center">
            <p data-testid="food-calories" className="text-xl font-bold tabular">
              {fmt(food)}
              {(unknown.calories ?? 0) > 0 && (
                <button
                  type="button"
                  aria-label="Why are calories uncertain?"
                  onClick={() => setCalWhy((w) => !w)}
                  className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-pressed align-top text-xs font-bold text-subtle"
                >
                  ?
                </button>
              )}
            </p>
            <p className="text-xs text-muted">Food</p>
            {calWhy && <p className="mt-1 text-xs text-muted">{`${unknown.calories} ${unknown.calories === 1 ? "food" : "foods"} missing calories`}</p>}
          </div>
          <Gauge food={food} min={t.calories.min} max={t.calories.max} />
          <div className="text-center">
            <p data-testid="exercise-calories" className="text-xl font-bold tabular">
              {fmt(data?.exercise.calories ?? 0)}
            </p>
            <p className="text-xs text-muted">Exercise</p>
          </div>
        </div>
      ) : (
        data && (
          <div className="mt-3 flex flex-col items-center gap-3 text-center">
            <p className="text-subtle">Pick a plan to see your budget</p>
            <button type="button" onClick={() => (window.location.hash = "#/goals/plan")} className={primaryButton}>
              Pick a plan
            </button>
          </div>
        )
      )}
      {data && (
        <div className="mt-6 grid grid-cols-3 gap-2">
          <Ring name="Protein" value={data.totals.protein_g ?? 0} min={t?.protein_g.min} max={t?.protein_g.max} unit="g" unknown={unknown.protein_g} />
          <Ring name="Fiber" value={data.totals.fiber_g ?? 0} min={t?.fiber_g.min} max={t?.fiber_g.max} unit="g" unknown={unknown.fiber_g} />
          <Ring
            name="Water"
            value={water(data.totals.water_ml ?? 0)}
            min={t ? water(t.water_ml.min) : undefined}
            max={t ? water(t.water_ml.max) : undefined}
            unit={waterUnit(user.units)}
          />
        </div>
      )}
    </section>
  );
}

// Water quick-add buttons; a failure is said directly under them
function Water({ day }: WidgetProps) {
  const { user } = useSession();
  const settings = useSettingsMe();
  const [msg, setMsg] = useState<Msg>(null);
  const add = async (ml: number) => {
    try {
      await api("POST", "/api/log", { day, meal: "supplements", water_ml: ml });
      setMsg(null);
      notifyDayChanged();
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };
  const label = (ml: number) => (user.units === "metric" ? `+${fmt(ml)} ml` : `+${waterValue(ml, user.units)} oz`);
  return (
    <>
      <section aria-label="Water" className="flex items-center gap-3 rounded-2xl bg-container p-4">
        <GlassWater className="size-6 text-action" aria-hidden="true" />
        <span className="flex-1 font-semibold">Water</span>
        {settings.waterButtonsMl.map((ml) => (
          <button key={ml} type="button" onClick={() => add(ml)} className={`${secondaryButton} px-4 py-1.5 text-sm`}>
            {label(ml)}
          </button>
        ))}
      </section>
      <Notice msg={msg} />
    </>
  );
}

function Streak({ data }: WidgetProps) {
  if (!data) return null;
  return (
    <section aria-label="Streak" className="flex items-center gap-2 rounded-2xl bg-container px-4 py-3">
      <Flame className={`size-5 ${data.streak > 0 ? "text-action" : "text-inactive"}`} aria-hidden="true" />
      <span className="font-semibold">{data.streak > 0 ? `${data.streak}-day streak` : "Log a food to start a streak"}</span>
    </section>
  );
}

export const WIDGETS: WidgetDef[] = [
  { id: "food", column: 0, fits: "narrow", title: "Food", description: "The day's meals: add, edit, move and copy food", Component: (p) => <FoodWidget day={p.day} data={p.data} isToday={p.isToday} /> },
  { id: "budget", column: 1, fits: "narrow", title: "Budget", description: "Calories left in your range, with protein, fiber and water rings", Component: Budget },
  { id: "water", column: 1, fits: "narrow", title: "Water", description: "Add a glass of water in one tap", Component: Water },
  { id: "day-totals", column: 2, fits: "narrow", title: "Day totals", description: "Calories, protein, carbs, fat and more against your targets", Component: ({ data }) => <DayTotalsWidget data={data} /> },
  { id: "weight", column: 2, fits: "narrow", title: "Weight", description: "Your latest weigh-in and how it's trending", Component: ({ wide }) => <WeightCard trend={wide} /> },
  { id: "next-shot", column: 2, fits: "narrow", title: "Next shot", description: "When your next GLP-1 shot is due", onlyWhen: "Shows when GLP-1 is on", Component: () => <Glp1Card /> },
  { id: "streak", column: 2, fits: "narrow", title: "Streak", description: "Days in a row you've logged food", Component: Streak },
];

function DayTotalsWidget({ data }: { data: Day | null }) {
  const { user } = useSession();
  return data ? <DayTotals day={data} units={user.units} /> : null;
}

export const widgetById = (id: string) => WIDGETS.find((w) => w.id === id);
