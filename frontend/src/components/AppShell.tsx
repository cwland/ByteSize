import Navigation from "./Navigation";
import TopBar from "./TopBar";
import LogPage from "./log/LogPage";
import AddFoodSheet from "./log/AddFoodSheet";
import { mealFor } from "../meals";
import { useSettingsMe } from "../day";
import Dashboard from "./dashboard/Dashboard";
import GoalsPage from "./goals/GoalsPage";
import PlanFlow from "./plan/PlanFlow";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Meal, SavedBody, Targets } from "../types";
import SettingsPage from "./settings/SettingsPage";
import MyFoodsPage from "./myfoods/MyFoodsPage";
import Glp1Page from "./glp1/Glp1Page";
import { isGlp1, isMyFoods, pageFromHash, useHash, type Page } from "../routes";
import { useSession } from "../session";
import { SelectedDayProvider, todayIn, useSelectedDay } from "../selectedDay";

// The signed-in app: top bar (week strip on Dashboard and Log), the page for the address, and the bottom tab bar.
// Mobile-first; on desktop the content stays a centered phone-width column.
export default function AppShell() {
  const hash = useHash();
  const page: Page = pageFromHash(hash);
  const myFoods = page === "log" && isMyFoods(hash); // My Foods sits under the Log tab
  const { user } = useSession();
  // First run after setup: no targets yet → the plan flow, full screen, before the tabs.
  // Saved details that need a review (the questions changed) → the same flow, asked once; "Not now" skips it.
  // If a check fails (server hiccup) the app shows as usual; Goals can still pick a plan.
  const [needsPlan, setNeedsPlan] = useState(false);
  useEffect(() => {
    api<{ targets: Targets | null }>("GET", `/api/targets?day=${todayIn(user.timezone)}`)
      .then((r) => r.targets === null && setNeedsPlan(true))
      .catch(() => {});
    api<{ body: SavedBody | null }>("GET", "/api/body")
      .then((r) => r.body?.needsReview && setNeedsPlan(true))
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
        <TodayOnEnter page={page} />
        <TopBar days={(page === "dashboard" && !isGlp1(hash)) || (page === "log" && !myFoods)} />
        <main className="mx-auto max-w-[560px] px-3 pt-2 pb-32">
          {page === "dashboard" && (isGlp1(hash) ? <Glp1Page /> : <Dashboard />)}
          {page === "log" && (myFoods ? <MyFoodsPage /> : <LogPage />)}
          {page === "goals" && <GoalsPage />}
          {page === "settings" && <SettingsPage />}
        </main>
        <LogButton page={page} />
      </div>
    </SelectedDayProvider>
  );
}

// Entering the Dashboard or Log from another page always selects today
function TodayOnEnter({ page }: { page: Page }) {
  const { today } = useSelectedDay();
  const was = useRef(page);
  useEffect(() => {
    if (page !== was.current && (page === "dashboard" || page === "log")) today();
    was.current = page;
  }, [page, today]);
  return null;
}

// The bottom tab bar's floating +: Add food for the meal of the moment (meal windows) on the day shown
function LogButton({ page }: { page: Page }) {
  const { user } = useSession();
  const { day } = useSelectedDay();
  const settings = useSettingsMe();
  const [meal, setMeal] = useState<Meal | null>(null);
  return (
    <>
      <Navigation page={page} onAdd={() => setMeal(mealFor(user.timezone, new Date(), settings.mealWindows))} />
      {meal && <AddFoodSheet day={day} meal={meal} onClose={() => setMeal(null)} />}
    </>
  );
}
