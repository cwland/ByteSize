import Navigation from "./Navigation";
import TopBar from "./TopBar";
import { DashboardPreview, GoalsPreview, LogPreview } from "./Placeholder";
import SettingsPage from "./settings/SettingsPage";
import { pageFromHash, useHash, type Page } from "../routes";
import { useSession } from "../session";
import { SelectedDayProvider } from "../selectedDay";

// The signed-in app: top bar (‹ day ›), the page for the address, and the bottom tab bar.
// Mobile-first; on desktop the content stays a centered phone-width column.
export default function AppShell() {
  const page: Page = pageFromHash(useHash());
  const { user } = useSession();
  return (
    <SelectedDayProvider timeZone={user.timezone}>
      <div className="min-h-screen bg-page">
        <TopBar />
        <main className="mx-auto max-w-[560px] px-3 pt-2 pb-32">
          {page === "dashboard" && <DashboardPreview />}
          {page === "log" && <LogPreview />}
          {page === "goals" && <GoalsPreview />}
          {page === "settings" && <SettingsPage />}
        </main>
        <Navigation page={page} />
      </div>
    </SelectedDayProvider>
  );
}
