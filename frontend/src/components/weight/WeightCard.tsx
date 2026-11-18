import { useState } from "react";
import { ChevronRight, Weight as WeightIcon } from "lucide-react";
import { useSession } from "../../session";
import { addDays, todayIn } from "../../selectedDay";
import { formatWeight } from "../../units";
import { Notice } from "../ui/Notice";
import { linkButton, primaryButton } from "../ui/styles";
import WeighInSheet from "./WeighInSheet";
import { shortDay, useWeight } from "../../weight";
import type { WeighIn } from "../../types";

// The wide Dashboard's small trend line: the weigh-ins of the last 8 weeks, oldest to newest
const TREND_DAYS = 56;
function TrendLine({ weighIns }: { weighIns: WeighIn[] }) {
  const pts = [...weighIns].sort((a, b) => a.day.localeCompare(b.day));
  if (pts.length < 2) return null;
  const kg = pts.map((p) => p.weightKg);
  const lo = Math.min(...kg);
  const span = Math.max(...kg) - lo || 1;
  const t0 = Date.parse(pts[0].day);
  const tspan = Date.parse(pts[pts.length - 1].day) - t0 || 1;
  const points = pts.map((p) => `${(((Date.parse(p.day) - t0) / tspan) * 100).toFixed(2)},${(2 + (1 - (p.weightKg - lo) / span) * 26).toFixed(2)}`).join(" ");
  return (
    <svg role="img" aria-label="Weight trend, recent weigh-ins" viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-3 h-12 w-full">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="text-action" />
    </svg>
  );
}

// Dashboard: the latest weigh-in, the trend and lost so far, with Weigh in. The chart lives on Goals.
// trend (wide screens): a small line of the last 8 weeks' weigh-ins under it.
export default function WeightCard({ trend = false }: { trend?: boolean }) {
  const { user } = useSession();
  const today = todayIn(user.timezone);
  // Only the summary is needed here: ask for today's window so the list stays short (8 weeks for the line)
  const { data, error } = useWeight(trend ? addDays(today, -TREND_DAYS) : today, today);
  const [open, setOpen] = useState(false);
  const w = (kg: number) => formatWeight(kg, user.units);

  return (
    <section aria-label="Weight" className="rounded-2xl bg-container p-4">
      <div className="flex items-center gap-3">
        <WeightIcon className="size-6 text-action" aria-hidden="true" />
        <h2 className="flex-1 font-semibold">Weight</h2>
        <button type="button" onClick={() => setOpen(true)} className={`${primaryButton} px-4 py-1.5 text-sm`}>
          Weigh in
        </button>
      </div>
      {error && <Notice msg={{ ok: false, text: error }} />}
      {data &&
        (data.latest ? (
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-3xl font-bold tabular">{w(data.latest.weightKg)}</p>
              <p className="text-xs text-muted">{data.latest.day === today ? "Today" : shortDay(data.latest.day)}</p>
            </div>
            <div className="text-right text-sm text-subtle tabular">
              {data.trendKg !== null && <p>{`Trend ${w(data.trendKg)}`}</p>}
              {data.lostKg !== null && <p>{data.lostKg >= 0 ? `${w(data.lostKg)} lost so far` : `${w(-data.lostKg)} gained so far`}</p>}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-subtle">No weigh-ins yet</p>
        ))}
      {trend && data && <TrendLine weighIns={data.weighIns} />}
      {data?.latest && (
        <a href="#/goals" className={`${linkButton} mt-3 inline-flex items-center text-sm`}>
          See your progress <ChevronRight aria-hidden="true" className="size-4" />
        </a>
      )}
      {open && <WeighInSheet onClose={() => setOpen(false)} />}
    </section>
  );
}
