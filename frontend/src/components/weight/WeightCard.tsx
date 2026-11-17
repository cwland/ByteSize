import { useState } from "react";
import { ChevronRight, Weight as WeightIcon } from "lucide-react";
import { useSession } from "../../session";
import { todayIn } from "../../selectedDay";
import { formatWeight } from "../../units";
import { Notice } from "../ui/Notice";
import { linkButton, primaryButton } from "../ui/styles";
import WeighInSheet from "./WeighInSheet";
import { shortDay, useWeight } from "../../weight";

// Dashboard: the latest weigh-in, the trend and lost so far, with Weigh in. The chart lives on Goals.
export default function WeightCard() {
  const { user } = useSession();
  const today = todayIn(user.timezone);
  // Only the summary is needed here: ask for today's window so the list stays short
  const { data, error } = useWeight(today, today);
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
      {data?.latest && (
        <a href="#/goals" className={`${linkButton} mt-3 inline-flex items-center text-sm`}>
          See your progress <ChevronRight aria-hidden="true" className="size-4" />
        </a>
      )}
      {open && <WeighInSheet onClose={() => setOpen(false)} />}
    </section>
  );
}
