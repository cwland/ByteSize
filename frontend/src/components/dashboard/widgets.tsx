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
import ActivityWidget from "../activity/ActivityWidget";
import Gauge from "./Gauge";
import Ring from "./Ring";
import GoalDateWidget from "../goals/GoalDate";
import WeeklyTrends from "../goals/WeeklyTrends";
import Badges from "../goals/Badges";
import { YourPlan } from "../goals/goalsContext";
import GoalsWeight from "../goals/GoalsWeight";
import { goalIdOf, goalWidgetId, type LayoutPage, type LayoutWidget } from "./layout";
import { GoalsListWidget, PastGoalsWidget } from "../goals/GoalWidgets";
import { kindName } from "../goals/goalCopy";
import type { Goal } from "../../types";
import { planPickerHref } from "../../plans";
import InsightsWidget from "../insights/InsightsWidget";

// The widget registry (§28, §40a): the one list every widget page (Dashboard, Goals), the Add widget list and the
// layout read. Adding a widget later means adding one entry here (and its id, per page, to backend/src/lib/widgets.ts,
// which backend/tests/widgets-sync.test.ts keeps in step). pages: the pages it's offered on, each with where it sits
// by default (0 left, 1 middle, 2 right; registry order within a column) or null (offered in Add widget only).
// fits: a hint for the library (narrow cards suit any column; wide ones want room). onlyWhen: shown only then.

// What every widget gets: the selected day (loaded once by the Dashboard; today on other pages, with no day data)
// and the screen width
// loadsDay: the page loads the day itself (the Dashboard), so data is coming: widgets wait for it instead of fetching
export type WidgetProps = { day: string; data: Day | null; isToday: boolean; wide: boolean; loadsDay?: boolean };
export type WidgetDef = {
  id: string;
  pages: Partial<Record<LayoutPage, number | null>>;
  newDefault?: number;
  title: string;
  description: string; // one line, for the Add widget list
  fits: "narrow" | "wide";
  onlyWhen?: string; // e.g. "Shows when GLP-1 is on" (the widget hides itself otherwise)
  Component: (p: WidgetProps) => JSX.Element | null;
  /** §40c: a goal's own widget ("goal:<id>"); the page draws it from its loaded goals */
  goalId?: number;
};

function Budget({ data, isToday }: WidgetProps) {
  const { user } = useSession();
  const t = data?.targets ?? null;
  const food = data?.totals.calories ?? 0;
  // §40b: what the weekly bank paid today (treats and a covered overage)
  const paid = data?.workoutCalories?.mode === "bank" ? data.workoutCalories.bank?.thisDay : undefined;
  const bankPaid = paid ? paid.treatSpent + paid.covered : 0;
  const water = (ml: number) => waterValue(ml, user.units);
  return (
    <section aria-label="Budget" className="rounded-2xl bg-container p-5">
      <h2 className="text-lg font-bold">{t ? `Budget: ${fmt(t.calories.min)}–${fmt(t.calories.max)} cals` : "Budget"}</h2>
      {t ? (
        <div className="mt-3 grid grid-cols-[4.5rem_1fr_4.5rem] items-end gap-2">
          <div className="text-center">
            <p data-testid="food-calories" className="text-xl font-bold tabular">
              {fmt(food)}
            </p>
            <p className="text-xs text-muted">Food</p>
          </div>
          <Gauge food={food} min={t.calories.min} max={t.calories.max} bankPaid={bankPaid} />
          <div className="text-center">
            <p data-testid="exercise-calories" className="text-xl font-bold tabular">
              {fmt(data?.exercise.calories ?? 0)}
            </p>
            <p className="text-xs text-muted">Earned</p>
          </div>
        </div>
      ) : (
        data && (
          <div className="mt-3 flex flex-col items-center gap-3 text-center">
            <p className="text-subtle">Pick a plan to see your budget</p>
            <button type="button" onClick={() => (window.location.hash = planPickerHref("/"))} className={primaryButton}>
              Pick a plan
            </button>
          </div>
        )
      )}
      {data && <WorkoutCaloriesLine day={data} isToday={isToday} />}
      {data && (
        <div className="mt-6 grid grid-cols-3 gap-2">
          <Ring name="Protein" value={data.totals.protein_g ?? 0} min={t?.protein_g.min} max={t?.protein_g.max} unit="g" />
          <Ring name="Fiber" value={data.totals.fiber_g ?? 0} min={t?.fiber_g.min} max={t?.fiber_g.max} unit="g" />
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

// "Earned today: 320" (and, adding to the day, how much the range grew)
export function earnedText(day: Day, isToday: boolean): string | null {
  const wc = day.workoutCalories;
  const earned = wc?.earned ?? day.exercise.calories;
  if (!(earned > 0)) return null;
  const base = `${isToday ? "Earned today" : "Earned"}: ${fmt(earned)}`;
  return wc?.mode === "add" && wc.added > 0 ? `${base} · ${fmt(wc.added)} added to your range` : base;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Under the budget gauge (§40b): what workouts earned; with the weekly bank, its balance, a small bar per day of the
// week so far (filled: put in; marked: spent), and what it paid for this day
function WorkoutCaloriesLine({ day, isToday }: { day: Day; isToday: boolean }) {
  const text = earnedText(day, isToday);
  const bank = day.workoutCalories?.mode === "bank" ? day.workoutCalories.bank : null;
  if (!text && !bank) return null;
  const tallest = Math.max(1, ...(bank?.days.map((d) => Math.max(d.deposit, d.spent)) ?? [1]));
  const t = bank?.thisDay;
  return (
    <div className="mt-3 text-center text-sm">
      {text && <p className="text-subtle">{text}</p>}
      {bank && (
        <div role="group" aria-label="Bank" className="mt-2 flex flex-col items-center gap-1">
          <p className="font-semibold">{`Bank: ${fmt(bank.balance)} this week`}</p>
          <div className="flex h-6 items-end gap-1">
            {bank.days.map((d) => {
              const name = WEEKDAY[new Date(`${d.day}T12:00:00Z`).getUTCDay()];
              const said = `${name}: ${fmt(d.deposit)} in${d.spent > 0 ? `, ${fmt(d.spent)} spent` : ""}`;
              return (
                <span key={d.day} role="img" aria-label={said} title={said} className="relative flex h-6 w-3 items-end rounded-sm bg-pressed">
                  <span className="w-full rounded-sm bg-action" style={{ height: `${(d.deposit / tallest) * 100}%` }} />
                  {d.spent > 0 && <span className="absolute inset-x-0 bottom-0 border-t-2 border-ink" style={{ height: `${(d.spent / tallest) * 100}%` }} />}
                </span>
              );
            })}
          </div>
          {t && t.treatSpent > 0 && <p className="text-subtle">{`Treats: ${fmt(t.treatSpent)} from your bank`}</p>}
          {t && t.overBy > 0 && t.covered > 0 && (
            <p className={t.covered === t.overBy ? "text-success" : "text-warning"}>
              {t.covered === t.overBy ? `Over by ${fmt(t.overBy)} — covered by your bank` : `Over by ${fmt(t.overBy)} — your bank covered ${fmt(t.covered)}`}
            </p>
          )}
        </div>
      )}
    </div>
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
  { id: "food", pages: { dashboard: 0 }, fits: "narrow", title: "Food", description: "The day's meals: add, edit, move and copy food", Component: (p) => <FoodWidget day={p.day} data={p.data} isToday={p.isToday} /> },
  { id: "budget", pages: { dashboard: 1 }, fits: "narrow", title: "Budget", description: "Calories left in your range, with protein, fiber and water rings", Component: Budget },
  { id: "water", pages: { dashboard: 1 }, fits: "narrow", title: "Water", description: "Add a glass of water in one tap", Component: Water },
  { id: "day-totals", pages: { dashboard: 2 }, fits: "narrow", title: "Day totals", description: "Calories, protein, carbs, fat and more against your targets", Component: ({ data, isToday }) => <DayTotalsWidget data={data} isToday={isToday} /> },
  // §43: below Day totals (in reading order on phones, where it's the way to the Insights page); offered on Goals
  { id: "insights", pages: { dashboard: 2, goals: null }, fits: "narrow", title: "Insights", description: "Your newest weekly recap, and the way to all your insights", Component: () => <InsightsWidget /> },
  { id: "weight", pages: { dashboard: 2 }, fits: "narrow", title: "Weight", description: "Your latest weigh-in and how it's trending", Component: ({ wide }) => <WeightCard trend={wide} /> },
  { id: "next-shot", pages: { dashboard: 2 }, fits: "narrow", title: "Next shot", description: "When your next GLP-1 shot is due", onlyWhen: "Shows when GLP-1 is on", Component: () => <Glp1Card /> },
  { id: "streak", pages: { dashboard: 2 }, fits: "narrow", title: "Streak", description: "Days in a row you've logged food", Component: Streak },
  // Goals (§40a)
  { id: "your-plan", pages: { goals: 0 }, fits: "narrow", title: "Your plan", description: "Today's plan and targets: change plan, edit targets, edit my details", Component: () => <YourPlan /> },
  { id: "goal-date", pages: { goals: 0, dashboard: null }, fits: "narrow", title: "Goal date", description: "When you'll reach your goal weight at your current pace", Component: () => <GoalDateWidget /> },
  // §40c: the active goals with + New goal (each goal is also a widget of its own, below), and finished goals
  { id: "goals", pages: { goals: 0, dashboard: null }, fits: "narrow", title: "Goals", description: "Your active goals, and + New goal", Component: () => <GoalsListWidget /> },
  { id: "weight-chart", pages: { goals: 1 }, fits: "wide", title: "Weight", description: "Your weight chart with start, now and goal, and your weigh-ins", Component: () => <GoalsWeight /> },
  // §40b: under Water on the Dashboard, under Weight on Goals (placed here so it sits between Weight and Weekly trends)
  { id: "activity", pages: { dashboard: 1, goals: 1 }, fits: "narrow", title: "Activity", description: "Steps and workouts for the day: add, edit and delete them", Component: ({ day, data, loadsDay }) => <ActivityWidget day={day} data={data} loadsDay={loadsDay} /> },
  { id: "weekly-trends", pages: { goals: 1 }, fits: "wide", title: "Weekly trends", description: "Each week's averages against your targets", Component: () => <WeeklyTrends /> },
  { id: "past-goals", pages: { goals: 1 }, fits: "narrow", title: "Past goals", description: "Goals you finished or ended, met or missed", Component: () => <PastGoalsWidget /> },
  { id: "badges", pages: { goals: 0 }, fits: "narrow", title: "Badges", description: "Badges you've earned and the ones still to get", Component: () => <Badges /> },
];

function DayTotalsWidget({ data, isToday }: { data: Day | null; isToday: boolean }) {
  const { user } = useSession();
  return data ? <DayTotals day={data} units={user.units} earned={earnedText(data, isToday)} isToday={isToday} /> : null;
}

// §40c: an active goal's widget, offered on every page (only in Add widget: the Goals page places new goals itself)
const PERIOD_WORD = { week: "each week", month: "each month", stretch: "over its dates" } as const;
export const goalWidgetDef = (g: Goal): WidgetDef => ({
  id: goalWidgetId(g.id),
  pages: { dashboard: null, goals: null },
  fits: "narrow",
  title: g.name,
  description: `${kindName(g.type)} goal: progress ${PERIOD_WORD[g.period]}`,
  Component: () => null, // drawn by the page with its goal (WidgetColumns)
  goalId: g.id,
});

export const widgetById = (id: string, goals: Goal[] = []): WidgetDef | undefined => {
  const gid = goalIdOf(id);
  if (gid === null) return WIDGETS.find((w) => w.id === id);
  const g = goals.find((x) => x.id === gid);
  return g ? goalWidgetDef(g) : undefined;
};

// A page's registry: the widgets offered there, each with its default column on that page, and the active goals' widgets
export const registryFor = (page: LayoutPage, goals: Goal[] = []): (WidgetDef & LayoutWidget)[] => [
  ...WIDGETS.filter((w) => page in w.pages).map((w) => ({ ...w, column: w.pages[page] ?? null })),
  ...goals.map((g) => ({ ...goalWidgetDef(g), column: null })),
];
