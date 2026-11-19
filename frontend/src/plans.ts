import type { Targets } from "./types";

/** The plan's name as people see it: "Steady" ("Steady plan" with `withPlan`), or "Your own targets" when set by hand */
export const planName = (t: Pick<Targets, "plan">, withPlan = false) =>
  t.plan ? `${t.plan[0].toUpperCase()}${t.plan.slice(1)}${withPlan ? " plan" : ""}` : "Your own targets";

/** Goals' plan picker; `from` (a route like "/") is where Done and Cancel go back to (default: Goals) */
export const planPickerHref = (from?: string) => (from ? `#/goals/plan?from=${from}` : "#/goals/plan");
