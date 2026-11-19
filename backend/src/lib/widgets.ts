// The widget pages and the widgets each takes (§28, §40a). The app's widget registry
// (frontend/src/components/dashboard/widgets.tsx) has the same ids and pages; backend/tests/widgets-sync.test.ts
// checks the two agree. A page's layout may only name its own widgets. A widget may be offered on more than one page.
export const LAYOUT_PAGES = ["dashboard", "goals"] as const;
export type LayoutPage = (typeof LAYOUT_PAGES)[number];
export const PAGE_WIDGETS: Record<LayoutPage, readonly string[]> = {
  dashboard: ["food", "budget", "water", "activity", "day-totals", "weight", "next-shot", "streak", "goal-date"],
  goals: ["your-plan", "goal-date", "weight-chart", "weekly-trends", "badges", "activity"],
};
/** The Dashboard's widgets (the page §28 started with) */
export const WIDGET_IDS = PAGE_WIDGETS.dashboard;
export const LAYOUT_VERSION = 1;
export const MAX_COLUMNS = 3;
