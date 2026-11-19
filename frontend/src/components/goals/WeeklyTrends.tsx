import { useEffect, useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { dayRange } from "../../format";
import type { TrendKey, Units, WeekTrend } from "../../types";
import { fmt, kgToLb, waterUnit, waterValue } from "../../units";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { linkButton } from "../ui/styles";
import { useWide } from "../../wide";

const PAGE = 8;
const MAX_WEEKS = 104;

// In range / below / above, as a symbol with a name (never colour alone)
const MARKS = {
  in: { sign: "✓", label: "in range", tone: "text-success" },
  below: { sign: "↓", label: "below range", tone: "text-warning" },
  above: { sign: "↑", label: "above range", tone: "text-warning" },
} as const;

// "−1.4 lb" / "+0.6 kg" / "0 lb"; unknown stays "—"
export function weightChange(kg: number | null, units: Units) {
  if (kg === null) return "—";
  const v = Math.round((units === "metric" ? kg : kgToLb(kg)) * 10) / 10;
  const unit = units === "metric" ? "kg" : "lb";
  if (v === 0) return `0 ${unit}`;
  return `${v < 0 ? "−" : "+"}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${unit}`;
}

function Mark({ value, status }: { value: string | null; status: WeekTrend["status"][TrendKey] }) {
  const mark = value !== null && status ? MARKS[status] : null;
  return (
    mark && (
      <span role="img" aria-label={mark.label} className={`ml-1 font-bold ${mark.tone}`}>
        {mark.sign}
      </span>
    )
  );
}

function Cell({ name, value, status }: { name: string; value: string | null; status: WeekTrend["status"][TrendKey] }) {
  return (
    <div role="group" aria-label={name}>
      <p className="text-xs text-muted">{name}</p>
      <p className="whitespace-nowrap text-sm font-semibold tabular">
        {value ?? "—"}
        <Mark value={value} status={status} />
      </p>
    </div>
  );
}

// A week's averages as shown: null when nothing was logged for it
function averages(week: WeekTrend, units: Units) {
  const { avg } = week;
  const show = (v: number | null, f: (n: number) => string) => (v === null ? null : f(v));
  return {
    calories: show(avg.calories, fmt),
    protein_g: show(avg.protein_g, (n) => `${fmt(n)} g`),
    fiber_g: show(avg.fiber_g, (n) => `${fmt(n)} g`),
    water_ml: show(avg.water_ml, (n) => `${fmt(waterValue(n, units))} ${waterUnit(units)}`),
  };
}

function WeekRow({ week, units }: { week: WeekTrend; units: Units }) {
  const { status } = week;
  // Days whose calories were in range (a day the workout bank covered counts, §40b)
  const inRange = week.daysLogged > 0 && week.caloriesInRange !== undefined ? ` · ${week.caloriesInRange} in range` : "";
  const logged = week.daysLogged === 0 ? "Nothing logged" : `${week.daysLogged} ${week.daysLogged === 1 ? "day" : "days"} logged${inRange}`;
  const a = averages(week, units);
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">{`${dayRange(week.start, week.end)} · ${logged}`}</p>
        <div role="group" aria-label="Weight" className="shrink-0 text-sm">
          <span className="font-semibold tabular">{weightChange(week.weightChangeKg, units)}</span>
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-[repeat(3,minmax(0,1fr))_5.5rem] gap-2">
        <Cell name="Calories" value={a.calories} status={status.calories} />
        <Cell name="Protein" value={a.protein_g} status={status.protein_g} />
        <Cell name="Fiber" value={a.fiber_g} status={status.fiber_g} />
        <Cell name="Water" value={a.water_ml} status={status.water_ml} />
      </div>
    </li>
  );
}

// Wide screens: the weeks as a table (scrolls sideways when narrow)
const KEYS: TrendKey[] = ["calories", "protein_g", "fiber_g", "water_ml"];
function WeekTable({ weeks, units }: { weeks: WeekTrend[]; units: Units }) {
  const num = "px-3 py-2.5 text-right whitespace-nowrap";
  return (
    <div className="mt-3 overflow-x-auto">
      <table aria-label="Weekly trends" className="w-full min-w-[40rem] text-sm tabular">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th scope="col" className="py-2 pr-3 text-left font-semibold">
              Week
            </th>
            {["Calories / day", "Protein", "Fiber", "Water", "Weight", "Logged"].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-right font-semibold last:pr-0">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {weeks.map((w) => {
            const a = averages(w, units);
            return (
              <tr key={w.start}>
                <th scope="row" className="py-2.5 pr-3 text-left font-semibold whitespace-nowrap">
                  {dayRange(w.start, w.end)}
                </th>
                {KEYS.map((k) => (
                  <td key={k} className={`${num} font-semibold`}>
                    {a[k] ?? "—"}
                    <Mark value={a[k]} status={w.status[k]} />
                  </td>
                ))}
                <td className={`${num} font-semibold`}>{weightChange(w.weightChangeKg, units)}</td>
                <td className={`${num} pr-0 text-subtle`}>{w.daysLogged === 0 ? "Nothing logged" : `${w.daysLogged} ${w.daysLogged === 1 ? "day" : "days"}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Goals › Weekly trends: newest week first, daily averages over logged days against the targets,
// and the week's change in trend weight. 8 weeks at a time, up to 104.
export default function WeeklyTrends() {
  const { user } = useSession();
  const wide = useWide();
  // The weeks to ask for; try counts requests, so Show more after a failed load asks again
  const [want, setWant] = useState({ weeks: PAGE, try: 0 });
  const [loaded, setLoaded] = useState<{ weeks: WeekTrend[]; asked: number } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    let live = true;
    api<{ weeks: WeekTrend[] }>("GET", `/api/trends/weekly?weeks=${want.weeks}`)
      .then((r) => {
        if (!live) return;
        setLoaded({ weeks: r.weeks, asked: want.weeks });
        setMsg(null);
      })
      .catch((e) => live && setMsg(errorMsg(e)));
    return () => void (live = false);
  }, [want]);

  const weeks = loaded?.weeks ?? null;
  // More until the server has fewer weeks than asked (that's all of them) or 104 are shown: empty weeks
  // don't stop it, so history before a long gap stays reachable
  const more = !!loaded && loaded.weeks.length >= loaded.asked && loaded.asked < MAX_WEEKS;
  return (
    <section aria-label="Weekly trends" className="rounded-2xl bg-container p-5">
      <h2 className="text-lg font-bold">Weekly trends</h2>
      <p className="mt-1 text-sm text-subtle">Daily averages on the days you logged</p>
      <Notice msg={msg} />
      {weeks && wide && <WeekTable weeks={weeks} units={user.units} />}
      {weeks && !wide && (
        <ul className="mt-2 divide-y divide-line">
          {weeks.map((w) => (
            <WeekRow key={w.start} week={w} units={user.units} />
          ))}
        </ul>
      )}
      {more && (
        <button type="button" onClick={() => setWant((w) => ({ weeks: Math.min(loaded!.asked + PAGE, MAX_WEEKS), try: w.try + 1 }))} className={`${linkButton} mt-2`}>
          Show more
        </button>
      )}
    </section>
  );
}
