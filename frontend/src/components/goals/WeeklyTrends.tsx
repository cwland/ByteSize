import { useEffect, useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { dayRange } from "../../format";
import type { TrendKey, Units, WeekTrend } from "../../types";
import { fmt, kgToLb, waterUnit, waterValue } from "../../units";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { linkButton } from "../ui/styles";

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

function Cell({ name, value, status }: { name: string; value: string | null; status: WeekTrend["status"][TrendKey] }) {
  const mark = value !== null && status ? MARKS[status] : null;
  return (
    <div role="group" aria-label={name}>
      <p className="text-xs text-muted">{name}</p>
      <p className="whitespace-nowrap text-sm font-semibold tabular">
        {value ?? "—"}
        {mark && (
          <span role="img" aria-label={mark.label} className={`ml-1 font-bold ${mark.tone}`}>
            {mark.sign}
          </span>
        )}
      </p>
    </div>
  );
}

function WeekRow({ week, units }: { week: WeekTrend; units: Units }) {
  const { avg, status } = week;
  const logged = week.daysLogged === 0 ? "Nothing logged" : `${week.daysLogged} ${week.daysLogged === 1 ? "day" : "days"} logged`;
  const show = (v: number | null, f: (n: number) => string) => (v === null ? null : f(v));
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">{`${dayRange(week.start, week.end)} · ${logged}`}</p>
        <div role="group" aria-label="Weight" className="shrink-0 text-sm">
          <span className="sr-only">Weight </span>
          <span className="font-semibold tabular">{weightChange(week.weightChangeKg, units)}</span>
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-[repeat(3,minmax(0,1fr))_5.5rem] gap-2">
        <Cell name="Calories" value={show(avg.calories, fmt)} status={status.calories} />
        <Cell name="Protein" value={show(avg.protein_g, (n) => `${fmt(n)} g`)} status={status.protein_g} />
        <Cell name="Fiber" value={show(avg.fiber_g, (n) => `${fmt(n)} g`)} status={status.fiber_g} />
        <Cell name="Water" value={show(avg.water_ml, (n) => `${fmt(waterValue(n, units))} ${waterUnit(units)}`)} status={status.water_ml} />
      </div>
    </li>
  );
}

// Goals › Weekly trends: newest week first, daily averages over logged days against the targets,
// and the week's change in trend weight. 8 weeks at a time.
export default function WeeklyTrends() {
  const { user } = useSession();
  const [count, setCount] = useState(PAGE);
  const [weeks, setWeeks] = useState<WeekTrend[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    let live = true;
    api<{ weeks: WeekTrend[] }>("GET", `/api/trends/weekly?weeks=${count}`)
      .then((r) => live && setWeeks(r.weeks))
      .catch((e) => live && setMsg(errorMsg(e)));
    return () => void (live = false);
  }, [count]);

  // Offer more while the last 8 weeks loaded still had something in them
  const more = !!weeks && weeks.length === count && count < MAX_WEEKS && weeks.slice(-PAGE).some((w) => w.daysLogged > 0 || w.weightChangeKg !== null);
  return (
    <section aria-label="Weekly trends" className="rounded-2xl bg-container p-5">
      <h2 className="text-lg font-bold">Weekly trends</h2>
      <p className="mt-1 text-sm text-subtle">Daily averages on the days you logged</p>
      <Notice msg={msg} />
      {weeks && (
        <ul className="mt-2 divide-y divide-line">
          {weeks.map((w) => (
            <WeekRow key={w.start} week={w} units={user.units} />
          ))}
        </ul>
      )}
      {more && (
        <button type="button" onClick={() => setCount((c) => Math.min(c + PAGE, MAX_WEEKS))} className={`${linkButton} mt-2`}>
          Show more
        </button>
      )}
    </section>
  );
}
