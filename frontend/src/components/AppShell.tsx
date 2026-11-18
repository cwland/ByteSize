import Navigation from "./Navigation";
import Rail from "./Rail";
import TopBar from "./TopBar";
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
import { isGlp1, isOldLog, pageFromHash, useHash, type Page } from "../routes";
import { useSession } from "../session";
import { SelectedDayProvider, todayIn, useSelectedDay } from "../selectedDay";
import { useWide } from "../wide";

// The signed-in app: top bar (week strip on the Dashboard), the page for the address, and the bottom tab bar.
// Mobile-first; up to 1024 px the content stays a centered phone-width column. Wider (useWide): a side rail
// and a content column up to about 1180 px, the pages drawing their own headers (PageHeader).
export default function AppShell() {
  const hash = useHash();
  const page: Page = pageFromHash(hash);
  const { user } = useSession();
  // No Log page (§28): its old address shows the Dashboard, and says so in the address bar
  useEffect(() => {
    if (isOldLog(hash)) history.replaceState(null, "", "#/");
  }, [hash]);
  const wide = useWide();
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

  const content = (
    <>
      {page === "dashboard" && (isGlp1(hash) ? <Glp1Page /> : <Dashboard />)}
      {page === "myfoods" && <MyFoodsPage />}
      {page === "goals" && <GoalsPage />}
      {page === "settings" && <SettingsPage />}
    </>
  );

  // One tree for both layouts, so crossing 1024 px (an iPad turned, a window resized) keeps the page and
  // any open sheet with what was typed: only classes change, the top bar's slot empties, and LogButton
  // draws the rail or the bottom tab bar in the same place (after main).
  return (
    <SelectedDayProvider timeZone={user.timezone}>
      <div className={wide ? "flex min-h-screen bg-page" : "min-h-screen bg-page"}>
        <TodayOnEnter page={page} />
        {!wide && <TopBar days={page === "dashboard" && !isGlp1(hash)} />}
        <main className={wide ? "min-w-0 flex-1 px-9 pt-7 pb-12" : "mx-auto max-w-[560px] px-3 pt-2 pb-32"}>
          <div className={wide ? "mx-auto max-w-[1180px]" : undefined}>{content}</div>
        </main>
        {/* After the page, as on phones (tab and screen-reader order); the rail moves itself first (order-first) */}
        <LogButton page={page} wide={wide} />
      </div>
    </SelectedDayProvider>
  );
}

// Entering the Dashboard from another page always selects today
function TodayOnEnter({ page }: { page: Page }) {
  const { today } = useSelectedDay();
  const was = useRef(page);
  useEffect(() => {
    if (page === was.current) return;
    if (page === "dashboard") today();
    was.current = page;
  }, [page, today]);
  return null;
}

// The bottom tab bar's floating +: Add food for the meal of the moment (meal windows) on the day shown.
// Wide screens draw the rail (no +) in the same place, so a sheet the + opened stays open across 1024 px.
function LogButton({ page, wide = false }: { page: Page; wide?: boolean }) {
  const { user } = useSession();
  const { day } = useSelectedDay();
  const settings = useSettingsMe();
  const [meal, setMeal] = useState<Meal | null>(null);
  const add = () => setMeal(mealFor(user.timezone, new Date(), settings.mealWindows));
  return (
    <>
      {wide ? <Rail page={page} /> : <Navigation page={page} onAdd={add} />}
      {meal && <AddFoodSheet day={day} meal={meal} onClose={() => setMeal(null)} />}
    </>
  );
}
