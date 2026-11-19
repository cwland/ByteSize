import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import GoalDateWidget, { goalDateCopy } from "./GoalDate";
import type { GoalDate } from "../../types";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { m3Routes, settingsMe } from "../../test/fixtures";
import { weightJson } from "../../test/weightFixtures";

const KG = 0.45359237;
const TODAY = "2026-11-18";
// 39.4 lb to go at 1.4 lb a week
const ok: GoalDate = { status: "ok", kgPerWeek: 1.4 * KG, toGoKg: 39.4 * KG, weeks: { min: 23, max: 25 }, date: "2027-04-05", earliest: "2027-03-22", latest: "2027-04-19" };

describe("goalDateCopy (§40a)", () => {
  it("steady: weeks as a range, the date at the pace, the range's dates, the pace and how far to go", () => {
    expect(goalDateCopy(ok, "imperial", undefined, TODAY)).toEqual({
      kind: "ok",
      weeks: "23–25 weeks",
      date: "Apr 5",
      range: "Mar 22 – Apr 19",
      pace: "−1.4 lb a week",
      toGo: "39.4 lb to go",
    });
  });

  it("the same weeks at both ends read as one number; one week is singular", () => {
    expect(goalDateCopy({ ...ok, weeks: { min: 20, max: 20 } }, "imperial", undefined, TODAY)).toMatchObject({ weeks: "20 weeks" });
    expect(goalDateCopy({ ...ok, weeks: { min: 1, max: 1 } }, "imperial", undefined, TODAY)).toMatchObject({ weeks: "1 week" });
    expect(goalDateCopy({ ...ok, weeks: { min: 1, max: 2 } }, "imperial", undefined, TODAY)).toMatchObject({ weeks: "1–2 weeks" });
  });

  it("metric, with the person's date format", () => {
    expect(goalDateCopy(ok, "metric", "dmy-slash", TODAY)).toEqual({
      kind: "ok",
      weeks: "23–25 weeks",
      date: "05/04/2027",
      range: "22/03/2027 – 19/04/2027",
      pace: "−0.6 kg a week",
      toGo: "17.9 kg to go",
    });
    expect(goalDateCopy(ok, "metric", "weekday-long-day-month-long", TODAY)).toMatchObject({ date: "5 April", range: "22 March – 19 April" });
  });

  it("reached, gaining or flat, too little data, no goal weight", () => {
    expect(goalDateCopy({ status: "reached" }, "imperial", undefined, TODAY)).toEqual({ kind: "text", text: "You've reached your goal 🎉" });
    expect(goalDateCopy({ status: "not_heading", kgPerWeek: -0.2 }, "imperial", undefined, TODAY)).toEqual({ kind: "text", text: "At this pace you're not heading toward your goal yet" });
    expect(goalDateCopy({ status: "not_enough" }, "metric", undefined, TODAY)).toEqual({ kind: "text", text: "Keep weighing in — about two weeks of weigh-ins gives an estimate" });
    expect(goalDateCopy({ status: "no_goal" }, "imperial", undefined, TODAY)).toEqual({ kind: "no_goal" });
  });
});

describe("Goal date widget", () => {
  it("shows the estimate as a range, with its dates, the pace and how far to go", async () => {
    fakeServer({ ...m3Routes, "GET /api/settings/me": () => settingsMe, "GET /api/weight": () => weightJson({ goalDate: { ...ok, date: "2027-04-05" } }) });
    renderWithSession(<GoalDateWidget />);
    const box = await screen.findByRole("region", { name: "Goal date" });
    expect(await within(box).findByText(/At your pace:/)).toHaveTextContent("At your pace: 23–25 weeks, around Apr 5");
    expect(within(box).getByText("Mar 22 – Apr 19")).toBeInTheDocument();
    expect(within(box).getByText("−1.4 lb a week")).toBeInTheDocument();
    expect(within(box).getByText("39.4 lb to go")).toBeInTheDocument();
  });

  it("no goal weight: a link to set one", async () => {
    fakeServer({ ...m3Routes, "GET /api/settings/me": () => settingsMe, "GET /api/weight": () => weightJson({ goalKg: null, goalDate: { status: "no_goal" } }) });
    renderWithSession(<GoalDateWidget />);
    const box = await screen.findByRole("region", { name: "Goal date" });
    expect(await within(box).findByRole("link", { name: "Set a goal weight" })).toHaveAttribute("href", "#/goals/details");
  });

  it("says so when the weight can't be loaded", async () => {
    fakeServer({ ...m3Routes, "GET /api/settings/me": () => settingsMe, "GET /api/weight": () => ({ status: 500, json: { error: "Weight is down" } }) });
    renderWithSession(<GoalDateWidget />);
    expect(await within(await screen.findByRole("region", { name: "Goal date" })).findByRole("alert")).toHaveTextContent("Weight is down");
  });
});
