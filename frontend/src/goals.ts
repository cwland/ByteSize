import { createContext, useContext } from "react";
import type { GoalsList } from "./types";

// Goals (§40c): GET /api/goals is loaded by each widget page with its layout (a goal's widget is "goal:<id>") and
// shared with its widgets through GoalsDataContext. Making, editing, ending or deleting a goal says so with
// notifyGoalsChanged: the page loads its goals and layout again (a new goal joins the Goals page).
const EVENT = "bytesize:goals-changed";
export const notifyGoalsChanged = () => window.dispatchEvent(new Event(EVENT));
export const onGoalsChanged = (on: () => void) => {
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
};

export const NO_GOALS: GoalsList = { active: [], past: [] };
export type GoalsData = GoalsList & { loaded: boolean };
export const GoalsDataContext = createContext<GoalsData>({ ...NO_GOALS, loaded: false });
export const useGoalsData = () => useContext(GoalsDataContext);
