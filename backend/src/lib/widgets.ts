// The widget pages and the widgets each takes (§28, §40a). The app's widget registry
// (frontend/src/components/dashboard/widgets.tsx) has the same ids and pages; backend/tests/widgets-sync.test.ts
// checks the two agree. A page's layout may only name its own widgets. A widget may be offered on more than one page.
export const LAYOUT_PAGES = ["dashboard", "goals"] as const;
// Layouts kept for the native apps (iOS design §6.7): the iPhone Dashboard, one column of its own widgets
// (ios/ByteSizeKit/…/DashboardWidget.swift; backend/tests/ios-widgets.test.ts checks they match). Not web pages.
export const NATIVE_PAGES = ["ios"] as const;
export const ALL_LAYOUT_PAGES = [...LAYOUT_PAGES, ...NATIVE_PAGES] as const;
export type LayoutPage = (typeof ALL_LAYOUT_PAGES)[number];
export const PAGE_WIDGETS: Record<LayoutPage, readonly string[]> = {
  dashboard: ["food", "budget", "water", "activity", "day-totals", "insights", "weight", "next-shot", "streak", "goal-date", "goals"],
  goals: ["your-plan", "goal-date", "weight-chart", "weekly-trends", "badges", "activity", "goals", "past-goals", "insights"],
  ios: ["calendar", "overview", "water", "weight", "streak", "badges", "shots"],
};
/** The Dashboard's widgets (the page §28 started with) */
export const WIDGET_IDS = PAGE_WIDGETS.dashboard;
export const LAYOUT_VERSION = 1;
export const MAX_COLUMNS = 3;

// §40c: each active goal is a widget of its own, "goal:<id>", offered on every page. Layouts keep only the person's
// active goals (an ended or deleted goal's widget leaves them); a new goal joins the Goals page by itself.
export const GOAL_WIDGET_PREFIX = "goal:";
export const GOAL_WIDGET = /^goal:([1-9]\d{0,9})$/;
export const GOAL_WIDGET_PAGES: readonly LayoutPage[] = ["dashboard", "goals"];
export const goalWidgetId = (id: number) => `${GOAL_WIDGET_PREFIX}${id}`;

/**
 * §43: a Dashboard saved before Insights, with Insights put in once: right below Day totals, or else at the bottom of
 * the right-hand column (phones reach the Insights page from this widget).
 */
export function withInsights(columns: string[][]): string[][] {
  if (columns.some((c) => c.includes("insights"))) return columns;
  const cols = Array.from({ length: Math.max(MAX_COLUMNS, columns.length) }, (_, i) => [...(columns[i] ?? [])]);
  const at = cols.findIndex((c) => c.includes("day-totals"));
  if (at >= 0) cols[at].splice(cols[at].indexOf("day-totals") + 1, 0, "insights");
  else cols[MAX_COLUMNS - 1].push("insights");
  return cols;
}
