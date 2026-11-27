import { useState } from "react";
import { useSession } from "../../session";
import { addDays, dayLabel, todayIn } from "../../selectedDay";
import type { Units, Weight, WeighIn } from "../../types";
import { formatWeight, weightValue } from "../../units";
import { useAllWeight } from "../../weight";
import { useSettingsMe } from "../../day";
import { formatDay } from "../../dateFormat";
import { Notice } from "../ui/Notice";
import { linkButton, primaryButton } from "../ui/styles";
import WeighInSheet from "./WeighInSheet";
import WeightChart, { type ChartMarker } from "./WeightChart";

type Range = "1m" | "3m" | "all";
const RANGES: { id: Range; label: string; days?: number }[] = [
  { id: "1m", label: "1 month", days: 30 },
  { id: "3m", label: "3 months", days: 91 },
  { id: "all", label: "All" },
];

const LIST_LIMIT = 7;

// Where the weight is heading, in words: the Goal date widget's estimate (§40a; its pace and middle date, so the page
// never shows two different numbers). Without a goal weight: the pace alone (the projection, over the look-back in Profile).
export function projectionText(w: Weight, units: Units, dateFormat: string | undefined, today: string) {
  // A rate that rounds to 0 in the person's units would read "Losing 0 lb a week"
  const rate = (kgPerWeek: number | undefined) => (kgPerWeek !== undefined && weightValue(kgPerWeek, units) > 0 ? `Losing ${formatWeight(kgPerWeek, units)} a week` : "Losing slowly");
  const g = w.goalDate;
  switch (g.status) {
    case "ok":
      return `${rate(g.kgPerWeek)} — goal around ${formatDay(g.date, dateFormat, today)}`;
    case "reached":
      return "You've reached your goal";
    case "not_heading":
      return g.kgPerWeek > 0 && weightValue(g.kgPerWeek, units) > 0 ? rate(g.kgPerWeek) : "Not losing right now";
    case "not_enough":
      return "Not enough weigh-ins yet";
  }
  const p = w.projection;
  if (p.status === "ok") return rate(p.kgPerWeek);
  return p.status === "not_losing" ? "Not losing right now" : "Not enough weigh-ins yet";
}

// Goals › Weight: start / now / goal, lost so far, the projection, the chart (1 month · 3 months · All)
// and the latest 7 weigh-ins in range (Show all for the rest), each tappable to edit or delete. markers: e.g. dose changes.
export default function WeightSection({ onReplan, markers }: { onReplan: () => void; markers?: ChartMarker[] }) {
  const { user } = useSession();
  const today = todayIn(user.timezone);
  const [range, setRange] = useState<Range>("1m");
  const days = RANGES.find((r) => r.id === range)!.days;
  const rangeFrom = days ? addDays(today, -days) : undefined;
  const { dateFormat } = useSettingsMe();
  const { data: all, error } = useAllWeight();
  // Every weigh-in is loaded once; the range only cuts the chart and the list
  const data = all && rangeFrom ? { ...all, weighIns: all.weighIns.filter((p) => p.day >= rangeFrom && p.day <= today) } : all;
  const [sheet, setSheet] = useState<{ edit?: WeighIn } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const w = (kg: number) => formatWeight(kg, user.units);

  const from = rangeFrom ?? data?.start?.day ?? today;
  const newestFirst = data ? [...data.weighIns].reverse() : [];
  // The change since the weigh-in before each one, looked up in every weigh-in (not just this range), so the oldest
  // row shown still compares with the one before it. Rounded the way weights are shown, so 0.04 reads "no change".
  const changeOn = new Map<string, number>();
  if (all) all.weighIns.forEach((p, i) => i > 0 && changeOn.set(p.day, p.weightKg - all.weighIns[i - 1].weightKg));
  const changeOf = (day: string) => {
    const kg = changeOn.get(day);
    if (kg === undefined) return null;
    const shown = weightValue(Math.abs(kg), user.units);
    if (Math.round(shown * 10) === 0) return { text: "no change", spoken: "no change", tone: "text-muted" };
    const amount = w(Math.abs(kg));
    return kg < 0 ? { text: `↓ ${amount}`, spoken: `down ${amount}`, tone: "text-success" } : { text: `↑ ${amount}`, spoken: `up ${amount}`, tone: "text-error" };
  };
  const listed = showAll ? newestFirst : newestFirst.slice(0, LIST_LIMIT);
  const lost = data?.lostKg ?? null;
  const lostTrend = data?.lostTrendKg ?? null;

  return (
    <section aria-label="Weight" className="rounded-2xl bg-container p-5">
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-lg font-bold">Weight</h2>
        <button type="button" onClick={() => setSheet({})} className={`${primaryButton} px-4 py-1.5 text-sm`}>
          Weigh in
        </button>
      </div>
      {error && <Notice msg={{ ok: false, text: error }} />}
      {data && (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <dt className="text-xs text-muted">Start</dt>
              <dd data-testid="weight-start" className="font-bold tabular">{data.start ? w(data.start.weightKg) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Now</dt>
              <dd data-testid="weight-now" className="font-bold tabular">
                {data.latest ? w(data.latest.weightKg) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Goal</dt>
              <dd data-testid="weight-goal" className="font-bold tabular">
                {data.goalKg !== null ? w(data.goalKg) : "—"}
              </dd>
            </div>
          </dl>
          {lost !== null && (
            <p className="mt-3 flex justify-between rounded-xl bg-pressed px-3 py-2 text-sm">
              <span className="text-subtle">{lost >= 0 ? "Lost so far" : "Gained so far"}</span>
              <span data-testid="weight-lost" className="font-semibold tabular">
                {w(Math.abs(lost))}
              </span>
            </p>
          )}
          {lostTrend != null && (
            <p className="mt-1 flex justify-between px-3 text-sm">
              <span className="text-subtle">{lostTrend >= 0 ? "By trend" : "Gained by trend"}</span>
              <span data-testid="weight-lost-trend" className="tabular">
                {w(Math.abs(lostTrend))}
              </span>
            </p>
          )}
          <p className="mt-3 font-semibold">{projectionText(data, user.units, dateFormat, today)}</p>
          {data.trendKg !== null && <p className="text-sm text-subtle tabular">{`Trend ${w(data.trendKg)}`}</p>}
          {data.replanHint && (
            <div role="status" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-active px-3 py-2 text-sm">
              <span className="flex-1 font-semibold text-ink">Your weight has changed — check your plan</span>
              <button type="button" onClick={onReplan} className={linkButton}>
                Check your plan
              </button>
            </div>
          )}
          <div role="group" aria-label="Range" className="mt-4 flex gap-2">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={range === r.id}
                onClick={() => setRange(r.id)}
                className={`rounded-full px-3 py-1 text-sm font-semibold ${range === r.id ? "bg-ink text-page" : "bg-pressed text-subtle hover:bg-strong"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <WeightChart weighIns={data.weighIns} goalKg={data.goalKg} units={user.units} from={from} to={today} markers={markers} onSelect={(edit) => setSheet({ edit })} />
          </div>
          {data.weighIns.length > 0 && (
            <ul aria-label="Weigh-ins" className="mt-2 divide-y divide-line">
              {listed.map((p) => {
                const change = changeOf(p.day);
                return (
                <li key={p.day}>
                  <button
                    type="button"
                    aria-label={`Edit ${dayLabel(p.day)}, ${w(p.weightKg)}${change ? `, ${change.spoken}` : ""}`}
                    onClick={() => setSheet({ edit: p })}
                    className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-pressed"
                  >
                    <span className="flex-1 text-subtle">{dayLabel(p.day)}</span>
                    {p.note && <span className="max-w-[40%] truncate text-xs text-muted">{p.note}</span>}
                    {change && <span data-testid="weigh-in-change" className={`text-sm font-semibold tabular ${change.tone}`}>{change.text}</span>}
                    <span className="font-semibold tabular">{w(p.weightKg)}</span>
                  </button>
                </li>
                );
              })}
            </ul>
          )}
          {listed.length < newestFirst.length && (
            <button type="button" onClick={() => setShowAll(true)} className={`${linkButton} mt-2 text-sm`}>
              {`Show all (${newestFirst.length})`}
            </button>
          )}
        </>
      )}
      {sheet && <WeighInSheet initial={sheet.edit} onClose={() => setSheet(null)} />}
    </section>
  );
}
