import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { api } from "../../api";
import { useSession } from "../../session";
import { todayIn } from "../../selectedDay";
import type { Glp1View, Targets } from "../../types";
import { fmt, waterUnit, waterValue } from "../../units";
import PlanFlow from "../plan/PlanFlow";
import TargetsEditor from "./TargetsEditor";
import WeeklyTrends from "./WeeklyTrends";
import Badges from "./Badges";
import VacationMode from "./VacationMode";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { linkButton, primaryButton, secondaryButton } from "../ui/styles";
import WeightSection from "../weight/WeightSection";
import type { ChartMarker } from "../weight/WeightChart";
import { mg } from "../glp1/glp1";
import PageHeader from "../PageHeader";
import { useWide } from "../../wide";

type Mode = "view" | "plan" | "details" | "edit";
const planName = (t: Targets) => (t.plan ? `${t.plan[0].toUpperCase()}${t.plan.slice(1)} plan` : "Your own targets");

// Goals: today's plan and target ranges (Change plan, Edit targets), then weight (with GLP-1 dose markers),
// weekly trends, badges, vacation mode and the GLP-1 link.
// "#/goals/plan" opens the plan picker straight away (the Dashboard's "Pick a plan").
// Wide screens: a title, plan and weight side by side, trends as a table, badges beside vacation mode.
export default function GoalsPage() {
  const { user } = useSession();
  const wide = useWide();
  const [targets, setTargets] = useState<Targets | null | undefined>(undefined);
  const [mode, setMode] = useState<Mode>(() => (window.location.hash.startsWith("#/goals/plan") ? "plan" : "view"));
  const [msg, setMsg] = useState<Msg>(null);
  const [doseMarkers, setDoseMarkers] = useState<ChartMarker[]>([]);

  useEffect(() => {
    api<{ targets: Targets | null }>("GET", `/api/targets?day=${todayIn(user.timezone)}`)
      .then((r) => setTargets(r.targets))
      .catch((e) => setMsg(errorMsg(e)));
  }, [user.timezone]);

  // Each dose on the weight chart, from the starting dose on (GLP-1 set up only; failing: no markers)
  useEffect(() => {
    let live = true;
    api<Glp1View>("GET", "/api/glp1")
      .then((v) => live && v.settings && setDoseMarkers(v.doseHistory.map((d) => ({ day: d.day, label: mg(d.doseMg), name: `dose ${mg(d.doseMg)}` }))))
      .catch(() => {});
    return () => void (live = false);
  }, []);

  const saved = (t: Targets) => {
    setTargets(t);
    setMode("view");
    if (window.location.hash.startsWith("#/goals/plan")) window.location.hash = "#/goals";
  };

  if (mode === "plan") return <PlanFlow onDone={saved} onCancel={() => setMode("view")} cancelLabel="Cancel" />;
  if (mode === "details") return <PlanFlow startAtDetails onDone={saved} onCancel={() => setMode("view")} cancelLabel="Cancel" />;
  if (mode === "edit") return <TargetsEditor initial={targets ?? null} onSaved={saved} onCancel={() => setMode("view")} />;

  const water = (v: number) => waterValue(v, user.units);
  const planCard = (
    <>
      {targets === null && (
        <section aria-label="Plan" className="flex flex-col items-center rounded-2xl bg-container p-8 text-center">
          <Target className="size-10 text-action" aria-hidden="true" />
          <p className="mt-3 text-lg font-bold">Pick a plan to set your daily targets</p>
          <button type="button" onClick={() => setMode("plan")} className={`${primaryButton} mt-4`}>
            Pick a plan
          </button>
        </section>
      )}
      {targets && (
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
      )}
    </>
  );
  const weight = <WeightSection onReplan={() => setMode("plan")} markers={doseMarkers} />;
  const glp1Link = (
    <a href="#/glp1?from=/goals" className={`${secondaryButton} text-center`}>
      GLP-1 shots
    </a>
  );

  if (wide) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Goals" />
        <Notice msg={msg} />
        <div data-testid="goals-top" className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {planCard}
          <div className="min-w-0 lg:col-start-2">{weight}</div>
        </div>
        <WeeklyTrends />
        <div data-testid="goals-bottom" className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Badges />
          <div className="flex flex-col gap-5">
            <VacationMode />
            {glp1Link}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="sr-only">Goals</h1>
      <Notice msg={msg} />
      {planCard}
      {weight}
      <WeeklyTrends />
      <Badges />
      <VacationMode />
      {glp1Link}
    </div>
  );
}
