import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { badges, glp1Shots, logEntries, userBody, weighIns } from "../src/db/schema.js";

let t: TestApp;
let userId: number;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  userId = (await t.login()).id; // admin "alex", America/Denver
  t.clock.date = new Date("2026-11-17T19:00:00Z"); // noon Nov 17 in Denver
});
afterAll(async () => t.close());

const getBadges = async () => (await t.api("GET", "/api/badges")).body;
const earned = (list: any[]) => Object.fromEntries(list.filter((b) => b.earnedOn).map((b) => [b.id, b.earnedOn]));
const weigh = (day: string, weightKg: number) => t.db.insert(weighIns).values({ userId, day, weightKg });
const body = (goalWeightKg: number) =>
  t.db.insert(userBody).values({ userId, sex: "male", birthDate: "1975-01-01", heightCm: 180, weightKg: 100, goalWeightKg, activity: "some", glp1: true });

/** Food on each of these days (one entry each, water doesn't count). */
async function foodOn(days: string[]) {
  const food = (await t.api("POST", "/api/my-foods", { name: "Toast", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80 } })).body.food;
  const first = await t.api("POST", "/api/log", { day: days[0], meal: "breakfast", food: { kind: "user_food", id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
  const [row] = await t.db.select().from(logEntries).where(eq(logEntries.id, first.body.entry.id));
  const { id: _id, ...rest } = row;
  if (days.length > 1) await t.db.insert(logEntries).values(days.slice(1).map((day) => ({ ...rest, day })));
}
const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

const ALL_UNEARNED = [
  { id: "first_weigh_in", earnedOn: null, seen: false },
  { id: "lost_5", earnedOn: null, seen: false },
  { id: "halfway", earnedOn: null, seen: false },
  { id: "goal_reached", earnedOn: null, seen: false },
  { id: "streak_7", earnedOn: null, seen: false },
  { id: "streak_30", earnedOn: null, seen: false },
  { id: "streak_100", earnedOn: null, seen: false },
  { id: "shots_on_time_4", earnedOn: null, seen: false },
  { id: "goal_met", earnedOn: null, seen: false, count: 0 }, // §40c: goals completed
];

describe("badges", () => {
  it("with nothing logged, lists every badge unearned (the next lost_N is lost_5)", async () => {
    expect(await getBadges()).toEqual({ badges: ALL_UNEARNED, new: [] });
  });

  it("earns first weigh-in, lost 5/10/20 lb, halfway at their thresholds (start = first weigh-in, lost = start - weigh-in)", async () => {
    await body(80); // halfway at 90 kg
    // 60 days apart: the trend nearly catches up with each weigh-in
    await weigh("2026-01-01", 100);
    await weigh("2026-03-02", 97.5); // lost ~2.50 kg >= 5 lb (2.268 kg)
    await weigh("2026-05-01", 95); // ~5.00 kg >= 10 lb (4.536 kg)
    await weigh("2026-06-30", 89); // ~10.99 kg >= 20 lb (9.072 kg); trend <= 90: halfway
    const res = await getBadges();
    expect(earned(res.badges)).toEqual({ first_weigh_in: "2026-01-01", lost_5: "2026-03-02", lost_10: "2026-05-01", lost_20: "2026-06-30", halfway: "2026-06-30" });
    expect(res.badges.map((b: any) => b.id)).toEqual(["first_weigh_in", "lost_5", "lost_10", "lost_20", "lost_30", "halfway", "goal_reached", "streak_7", "streak_30", "streak_100", "shots_on_time_4", "goal_met"]);
    expect(res.new).toEqual(["first_weigh_in", "lost_5", "lost_10", "lost_20", "halfway"]);
  });

  it("pounds lost, halfway and goal go by the weigh-in itself, not the lagging trend", async () => {
    await body(96); // halfway at 98 kg
    await weigh("2026-11-01", 100);
    await weigh("2026-11-02", 97.7); // 5.07 lb on the scale; the trend (~99.8) hasn't caught up
    await weigh("2026-11-03", 95.9); // past the 96 kg goal on the scale
    expect(earned((await getBadges()).badges)).toEqual({ first_weigh_in: "2026-11-01", lost_5: "2026-11-02", halfway: "2026-11-02", goal_reached: "2026-11-03" });
  });

  it("a heavier weigh-in after a scale badge keeps it earned", async () => {
    await body(80);
    await weigh("2026-11-01", 100);
    await weigh("2026-11-08", 95.4); // 10.1 lb lost on the scale
    expect(earned((await getBadges()).badges)).toMatchObject({ lost_10: "2026-11-08" });
    await weigh("2026-11-12", 97.9); // a salty day: back under 5 lb lost
    const list = (await getBadges()).badges;
    expect(earned(list)).toMatchObject({ lost_5: "2026-11-08", lost_10: "2026-11-08" });
    expect(list.find((b: any) => b.id === "lost_20")).toMatchObject({ earnedOn: null });
  });

  it("a weigh-in just short of a threshold doesn't earn it", async () => {
    await body(80);
    await weigh("2026-01-01", 100);
    await weigh("2026-11-01", 100 - 2.2); // 4.85 lb
    expect(earned((await getBadges()).badges)).toEqual({ first_weigh_in: "2026-01-01" });
  });

  it("goal reached when a weigh-in reaches the goal; badges are stored once and kept after regaining", async () => {
    await body(80);
    await weigh("2026-01-01", 100);
    await weigh("2026-06-30", 89);
    const first = await getBadges();
    expect(earned(first.badges)).toMatchObject({ lost_20: "2026-06-30", halfway: "2026-06-30" });
    await getBadges();
    expect(await t.db.select().from(badges).where(eq(badges.userId, userId))).toHaveLength(5); // never duplicated

    // The weigh-in that earned them goes, and the weight comes back: still earned, same day
    await t.db.delete(weighIns).where(and(eq(weighIns.userId, userId), eq(weighIns.day, "2026-06-30")));
    await weigh("2026-08-29", 100);
    expect(earned((await getBadges()).badges)).toMatchObject({ lost_20: "2026-06-30", halfway: "2026-06-30" });

    await weigh("2026-10-28", 79); // trend ~79.04 <= 80
    const res = await getBadges();
    expect(earned(res.badges)).toMatchObject({ goal_reached: "2026-10-28", lost_30: "2026-10-28", lost_40: "2026-10-28" });
    expect(res.badges.filter((b: any) => b.id.startsWith("lost_")).map((b: any) => [b.id, b.earnedOn])).toEqual([
      ["lost_5", "2026-06-30"],
      ["lost_10", "2026-06-30"],
      ["lost_20", "2026-06-30"],
      ["lost_30", "2026-10-28"],
      ["lost_40", "2026-10-28"],
      ["lost_50", null],
    ]);
  });

  it("no halfway or goal badge without a body profile, or with a goal at or above the start", async () => {
    await weigh("2026-01-01", 100);
    await weigh("2026-06-30", 89);
    expect(earned((await getBadges()).badges)).not.toHaveProperty("halfway");
    await body(105);
    const e = earned((await getBadges()).badges);
    expect(e).not.toHaveProperty("halfway");
    expect(e).not.toHaveProperty("goal_reached");
  });

  it("new badges show until marked seen; seen sticks", async () => {
    await weigh("2026-11-01", 100);
    expect((await getBadges()).new).toEqual(["first_weigh_in"]);
    expect((await getBadges()).new).toEqual(["first_weigh_in"]);
    const seen = await t.api("POST", "/api/badges/seen", { ids: ["first_weigh_in", "streak_7"] });
    expect(seen.status).toBe(200);
    expect(seen.body).toEqual({ seen: ["first_weigh_in"] }); // streak_7 isn't earned
    const res = await getBadges();
    expect(res.new).toEqual([]);
    expect(res.badges[0]).toEqual({ id: "first_weigh_in", earnedOn: "2026-11-01", seen: true });
    expect((await t.api("POST", "/api/badges/seen", { ids: [] })).status).toBe(400);
    expect((await t.api("POST", "/api/badges/seen", {})).status).toBe(400);
  });

  it("streak badges: the day the streak reached 7, 30 and 100", async () => {
    await foodOn(run("2026-07-01", 100)); // Jul 1 .. Oct 8
    expect(earned((await getBadges()).badges)).toEqual({ streak_7: "2026-07-07", streak_30: "2026-07-30", streak_100: "2026-10-08" });
  });

  it("a vacation gap continues the streak toward a badge; without it the streak starts again", async () => {
    await foodOn([...run("2026-11-01", 3), ...run("2026-11-06", 4)]); // Nov 1-3, Nov 6-9
    expect(earned((await getBadges()).badges)).toEqual({});
    await t.api("POST", "/api/vacations", { from: "2026-11-04", to: "2026-11-05" });
    expect(earned((await getBadges()).badges)).toEqual({ streak_7: "2026-11-09" });
    // Removing the vacation later doesn't take the badge back
    const [v] = (await t.api("GET", "/api/vacations")).body.vacations;
    await t.api("DELETE", `/api/vacations/${v.id}`);
    expect(earned((await getBadges()).badges)).toEqual({ streak_7: "2026-11-09" });
  });

  it("shots_on_time_4: four on-time shots in a row (first counts; then within 1 day of last + 7)", async () => {
    const shot = (day: string) => t.db.insert(glp1Shots).values({ userId, day, medication: "Zepbound", doseMg: 2.5, site: "abdomen_left" });
    for (const d of ["2026-10-01", "2026-10-08", "2026-10-17", "2026-10-24", "2026-10-31", "2026-11-08"]) await shot(d);
    // Oct 17 is 9 days after Oct 8: late, the run starts over; Oct 24, 31 (7), Nov 8 (8) make 3
    expect(earned((await getBadges()).badges)).toEqual({});
    await shot("2026-11-14"); // 6 days: on time, the 4th
    expect(earned((await getBadges()).badges)).toEqual({ shots_on_time_4: "2026-11-14" });
  });

  it("the first four shots on time earn it on the 4th", async () => {
    for (const d of ["2026-10-01", "2026-10-09", "2026-10-15", "2026-10-22", "2026-10-30"]) await t.db.insert(glp1Shots).values({ userId, day: d, medication: "Zepbound", doseMg: 2.5, site: "arm_left" });
    expect(earned((await getBadges()).badges)).toEqual({ shots_on_time_4: "2026-10-22" });
  });
});
