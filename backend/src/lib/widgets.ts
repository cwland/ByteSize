// The Dashboard widgets ByteSize has (§28). The app's widget registry (frontend/src/components/dashboard/widgets.tsx)
// has the same ids; a frontend test checks the two lists match. A layout may only name these.
export const WIDGET_IDS = ["food", "budget", "water", "day-totals", "weight", "next-shot", "streak"] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];
export const LAYOUT_VERSION = 1;
export const MAX_COLUMNS = 3;
