import { createContext, useContext } from "react";
import { Target } from "lucide-react";
import { useSession } from "../../session";
import type { Targets } from "../../types";
import { fmt, waterUnit, waterValue } from "../../units";
import { linkButton, primaryButton, secondaryButton } from "../ui/styles";

// What the Goals page shares with its widgets (§40a): today's targets (undefined while loading, null: no plan) and
// the page's modes (the plan picker, Edit my details, Edit targets take the whole page)
export type GoalsMode = "view" | "plan" | "details" | "edit";
export type GoalsShared = { targets: Targets | null | undefined; setMode: (m: GoalsMode) => void };
export const GoalsContext = createContext<GoalsShared | null>(null);
export const useGoals = () => useContext(GoalsContext);

const planName = (t: Targets) => (t.plan ? `${t.plan[0].toUpperCase()}${t.plan.slice(1)} plan` : "Your own targets");

// Your plan (Goals): today's plan and target ranges, Change plan, Edit targets, Edit my details
export function YourPlan() {
  const { user } = useSession();
  const goals = useGoals();
  if (!goals) return null;
  const { targets, setMode } = goals;
  const water = (v: number) => waterValue(v, user.units);
  if (targets === null)
    return (
      <section aria-label="Plan" className="flex flex-col items-center rounded-2xl bg-container p-8 text-center">
        <Target className="size-10 text-action" aria-hidden="true" />
        <p className="mt-3 text-lg font-bold">Pick a plan to set your daily targets</p>
        <button type="button" onClick={() => setMode("plan")} className={`${primaryButton} mt-4`}>
          Pick a plan
        </button>
      </section>
    );
  if (!targets) return null;
  return (
    <section aria-label="Plan" className="rounded-2xl bg-container p-5">
      <p className="text-sm text-muted">Your plan</p>
      <h2 className="text-2xl font-bold">{planName(targets)}</h2>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <dt className="text-subtle">Calories</dt>
        <dd className="font-semibold tabular">{`${fmt(targets.calories.min)}–${fmt(targets.calories.max)} cals`}</dd>
        <dt className="text-subtle">Protein</dt>
        <dd className="font-semibold tabular">{`${fmt(targets.protein_g.min)}–${fmt(targets.protein_g.max)} g`}</dd>
        <dt className="text-subtle">Fiber</dt>
        <dd className="font-semibold tabular">{`${fmt(targets.fiber_g.min)}–${fmt(targets.fiber_g.max)} g`}</dd>
        <dt className="text-subtle">Water</dt>
        <dd className="font-semibold tabular">{`${fmt(water(targets.water_ml.min))}–${fmt(water(targets.water_ml.max))} ${waterUnit(user.units)}`}</dd>
      </dl>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={() => setMode("plan")} className={primaryButton}>
          Change plan
        </button>
        <button type="button" onClick={() => setMode("edit")} className={secondaryButton}>
          Edit targets
        </button>
      </div>
      <button type="button" onClick={() => setMode("details")} className={`${linkButton} mt-4`}>
        Edit my details
      </button>
    </section>
  );
}
