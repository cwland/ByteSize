import { useEffect, useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { todayIn } from "../../selectedDay";
import type { Targets } from "../../types";
import PlanFlow from "../plan/PlanFlow";
import TargetsEditor from "./TargetsEditor";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import PageHeader from "../PageHeader";
import { useWide } from "../../wide";
import { EditLayoutButton, WidgetColumns, useWidgetLayout } from "../dashboard/WidgetPage";
import type { WidgetProps } from "../dashboard/widgets";
import { GoalsContext, type GoalsMode } from "./goalsContext";

// The mode a Goals address opens: "#/goals/plan" the plan picker (the Dashboard's "Pick a plan"), "#/goals/details"
// Edit my details (the goal date's "Set a goal weight")
const modeOf = (hash: string): GoalsMode | null => (hash.startsWith("#/goals/plan") ? "plan" : hash.startsWith("#/goals/details") ? "details" : null);

// Goals (§40a): widgets the person can arrange, as on the Dashboard (§28) — by default Your plan and Goal date on
// the left; Weight (with GLP-1 dose markers), Weekly trends and Badges on the right; one column in that reading
// order on phones. Change plan, Edit my details and Edit targets take the whole page while open.
// Wide screens: a title with Edit page; two columns keep today's 2 : 3 split, three share the width equally.
export default function GoalsPage() {
  const { user } = useSession();
  const wide = useWide();
  const [targets, setTargets] = useState<Targets | null | undefined>(undefined);
  const [mode, setMode] = useState<GoalsMode>(() => modeOf(window.location.hash) ?? "view");
  const [msg, setMsg] = useState<Msg>(null);
  const layout = useWidgetLayout("goals");

  useEffect(() => {
    api<{ targets: Targets | null }>("GET", `/api/targets?day=${todayIn(user.timezone)}`)
      .then((r) => setTargets(r.targets))
      .catch((e) => setMsg(errorMsg(e)));
  }, [user.timezone]);

  // A link to #/goals/plan or #/goals/details while Goals is open
  useEffect(() => {
    const on = () => {
      const m = modeOf(window.location.hash);
      if (m) setMode(m);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const close = () => {
    setMode("view");
    if (modeOf(window.location.hash)) window.location.hash = "#/goals";
  };
  const saved = (t: Targets) => {
    setTargets(t);
    close();
  };

  if (mode === "plan") return <PlanFlow onDone={saved} onCancel={close} cancelLabel="Cancel" />;
  if (mode === "details") return <PlanFlow startAtDetails onDone={saved} onCancel={close} cancelLabel="Cancel" />;
  if (mode === "edit") return <TargetsEditor initial={targets ?? null} onSaved={saved} onCancel={close} />;

  const today = todayIn(user.timezone);
  const props: WidgetProps = { day: today, data: null, isToday: true, wide };
  const editButton = layout.editing ? null : <EditLayoutButton layout={layout} />;
  const wideGrid = (shown: number) => (shown === 2 ? "grid items-start gap-5 grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : undefined);

  return (
    <GoalsContext.Provider value={{ targets, setMode }}>
      <div className={`flex flex-col ${wide ? "gap-5" : "gap-3"}`}>
        {wide ? <PageHeader title="Goals">{editButton}</PageHeader> : <h1 className="sr-only">Goals</h1>}
        {!wide && editButton && <div className="flex justify-end">{editButton}</div>}
        <Notice msg={msg} />
        <WidgetColumns layout={layout} props={props} wideGrid={wideGrid} />
      </div>
    </GoalsContext.Provider>
  );
}
