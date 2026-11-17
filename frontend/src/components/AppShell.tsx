import Navigation from "./Navigation";
import TopBar from "./TopBar";
import { DashboardPreview, LogPreview } from "./Placeholder";
import GoalsPage from "./goals/GoalsPage";
import PlanFlow from "./plan/PlanFlow";
import { useEffect, useState } from "react";
import { api } from "../api";
import { todayIn } from "../selectedDay";
import type { Targets } from "../types";
import SettingsPage from "./settings/SettingsPage";
import { pageFromHash, useHash, type Page } from "../routes";
import { useSession } from "../session";
import { SelectedDayProvider } from "../selectedDay";

// The signed-in app: top bar (‹ day ›), the page for the address, and the bottom tab bar.
// Mobile-first; on desktop the content stays a centered phone-width column.
export default function AppShell() {
  const page: Page = pageFromHash(useHash());
  const { user } = useSession();
  // First run after setup: no targets yet → the plan flow, full screen, before the tabs.
  // If the check fails (server hiccup) the app shows as usual; Goals can still pick a plan.
  const [needsPlan, setNeedsPlan] = useState(false);
  useEffect(() => {
    api<{ targets: Targets | null }>("GET", `/api/targets?day=${todayIn(user.timezone)}`)
      .then((r) => setNeedsPlan(r.targets === null))
      .catch(() => {});
  }, [user.timezone]);

  if (needsPlan) {
    return (
      <div className="min-h-screen bg-page">
        <main className="mx-auto max-w-[560px] px-3 pt-[max(1rem,env(safe-area-inset-top))] pb-10">
          <PlanFlow onDone={() => setNeedsPlan(false)} onCancel={() => setNeedsPlan(false)} />
        </main>
      </div>
    );
  }

  return (
    <SelectedDayProvider timeZone={user.timezone}>
      <div className="min-h-screen bg-page">
        <TopBar />
        <main className="mx-auto max-w-[560px] px-3 pt-2 pb-32">
          {page === "dashboard" && <DashboardPreview />}
          {page === "log" && <LogPreview />}
          {page === "goals" && <GoalsPage />}
          {page === "settings" && <SettingsPage />}
        </main>
        <Navigation page={page} />
      </div>
    </SelectedDayProvider>
  );
}
