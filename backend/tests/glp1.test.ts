import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory", America/Boise
  t.clock.date = new Date("2026-11-17T19:00:00Z"); // Tuesday noon in Boise
});
afterAll(async () => t.close());

const TODAY = "2026-11-17"; // a Tuesday (weekday 2)
const mounjaro = { medication: "Mounjaro", doseMg: 2.5, injectionWeekday: 5 };
const setup = (s: Record<string, unknown> = {}) => t.api("PUT", "/api/glp1/settings", { ...mounjaro, ...s });
const shot = (day: string, body: Record<string, unknown> = {}) => t.api("PUT", `/api/glp1/shots/${day}`, { site: "abdomen_left", ...body });
const glp1 = async () => (await t.api("GET", "/api/glp1")).body;

describe("GLP-1 settings and schedule", () => {
  it("starts empty", async () => {
    expect(await glp1()).toEqual({ settings: null, lastShot: null, nextDue: null, status: "none", overdueDays: 0, suggestedSite: "abdomen_left", shots: [], doseHistory: [] });
  });

  it("saves settings and validates them", async () => {
    const res = await setup();
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual(mounjaro);
    expect((await glp1()).settings).toEqual(mounjaro);
    for (const bad of [{ injectionWeekday: 7 }, { injectionWeekday: 1.5 }, { doseMg: 0 }, { doseMg: -1 }, { medication: "  " }]) {
      expect((await setup(bad)).status).toBe(400);
    }
  });

  it("with no shots, the next shot is the next injection weekday (today included)", async () => {
    await setup({ injectionWeekday: 5 }); // Friday
    expect(await glp1()).toMatchObject({ nextDue: "2026-11-20", status: "upcoming", overdueDays: 0 });
    await setup({ injectionWeekday: 2 }); // Tuesday = today
    expect(await glp1()).toMatchObject({ nextDue: TODAY, status: "due", overdueDays: 0 });
    await setup({ injectionWeekday: 1 }); // Monday: yesterday, so next week
    expect(await glp1()).toMatchObject({ nextDue: "2026-11-23", status: "upcoming" });
  });

  it("after a shot, the next one is due 7 days later: upcoming, due, overdue", async () => {
    await setup();
    await shot("2026-11-12");
    expect(await glp1()).toMatchObject({ nextDue: "2026-11-19", status: "upcoming", overdueDays: 0 });
    await shot("2026-11-10");
    expect(await glp1()).toMatchObject({ lastShot: { day: "2026-11-12" } }); // a backdated shot isn't the last one
    await t.api("DELETE", "/api/glp1/shots/2026-11-12");
    expect(await glp1()).toMatchObject({ lastShot: { day: "2026-11-10" }, nextDue: TODAY, status: "due", overdueDays: 0 });
    await t.api("DELETE", "/api/glp1/shots/2026-11-10");
    await shot("2026-11-08");
    expect(await glp1()).toMatchObject({ nextDue: "2026-11-15", status: "overdue", overdueDays: 2 });
  });

  it("works without settings once a shot has a dose and medication", async () => {
    expect((await shot("2026-11-10")).status).toBe(400); // nothing to default from
    expect((await shot("2026-11-10", { doseMg: 0.25, medication: "Ozempic" })).status).toBe(200);
    expect(await glp1()).toMatchObject({ settings: null, nextDue: TODAY, status: "due" });
  });

  it("'Injection day' flips at the person's local midnight", async () => {
    await setup();
    await shot("2026-11-10");
    t.clock.date = new Date("2026-11-18T06:30:00Z"); // 23:30 on the 17th in Boise
    expect(await glp1()).toMatchObject({ status: "due", overdueDays: 0 });
    t.clock.date = new Date("2026-11-18T07:30:00Z"); // 00:30 on the 18th
    expect(await glp1()).toMatchObject({ status: "overdue", overdueDays: 1 });
  });

  it("logs a shot with defaults from settings, lists shots newest first, edits and deletes", async () => {
    await setup();
    const res = await shot("2026-11-10", { site: "thigh_left", note: "  felt fine  " });
    expect(res.status).toBe(200);
    expect(res.body.lastShot).toEqual({ day: "2026-11-10", medication: "Mounjaro", doseMg: 2.5, site: "thigh_left", note: "felt fine" });
    await shot("2026-11-03", { site: "abdomen_right" });
    expect((await glp1()).shots.map((s: any) => s.day)).toEqual(["2026-11-10", "2026-11-03"]);
    // the same day again replaces it
    await shot("2026-11-10", { site: "arm_left", note: "" });
    expect((await glp1()).shots[0]).toEqual({ day: "2026-11-10", medication: "Mounjaro", doseMg: 2.5, site: "arm_left", note: null });
    expect((await t.api("DELETE", "/api/glp1/shots/2026-11-10")).status).toBe(200);
    expect((await glp1()).shots.map((s: any) => s.day)).toEqual(["2026-11-03"]);
    expect((await t.api("DELETE", "/api/glp1/shots/2026-11-10")).status).toBe(404);
  });

  it("rejects a bad site, a bad day, a future day and a bad dose", async () => {
    await setup();
    expect((await shot("2026-11-10", { site: "elbow" })).status).toBe(400);
    expect((await t.api("PUT", "/api/glp1/shots/2026-11-10", {})).status).toBe(400);
    expect((await shot("2026-02-30")).status).toBe(400);
    expect((await shot("2026-11-18")).status).toBe(400); // tomorrow in Boise
    expect((await shot("2026-11-10", { doseMg: 0 })).status).toBe(400);
    expect((await glp1()).shots).toEqual([]);
  });

  it("suggests the next site in rotation after the last shot's, wrapping around", async () => {
    await setup();
    await shot("2026-11-03", { site: "thigh_left" });
    expect((await glp1()).suggestedSite).toBe("thigh_right");
    await shot("2026-11-10", { site: "arm_right" });
    expect((await glp1()).suggestedSite).toBe("abdomen_left");
    await shot("2026-10-27", { site: "abdomen_left" }); // backdated: the last shot is still arm_right
    expect((await glp1()).suggestedSite).toBe("abdomen_left");
  });

  it("a different dose on the latest shot updates the current dose; dose history shows the changes", async () => {
    await setup();
    await shot("2026-11-03");
    await shot("2026-11-10", { doseMg: 5 });
    let g = await glp1();
    expect(g.settings.doseMg).toBe(5);
    expect(g.doseHistory).toEqual([
      { day: "2026-11-03", doseMg: 2.5, medication: "Mounjaro" },
      { day: "2026-11-10", doseMg: 5, medication: "Mounjaro" },
    ]);
    // a later shot with no dose uses the new one
    await shot("2026-11-17");
    expect((await glp1()).shots[0].doseMg).toBe(5);
    // backdated shots don't change the current dose, but do appear in the history on their date
    await shot("2026-10-27", { doseMg: 2.5 });
    await shot("2026-10-20", { doseMg: 7.5 });
    g = await glp1();
    expect(g.settings.doseMg).toBe(5);
    expect(g.doseHistory).toEqual([
      { day: "2026-10-20", doseMg: 7.5, medication: "Mounjaro" },
      { day: "2026-10-27", doseMg: 2.5, medication: "Mounjaro" },
      { day: "2026-11-10", doseMg: 5, medication: "Mounjaro" },
    ]);
  });
});

describe("side effects", () => {
  const put = (day: string, body: unknown) => t.api("PUT", `/api/side-effects/${day}`, body);
  const list = async (from = "2026-11-01", to = TODAY) => (await t.api("GET", `/api/side-effects?from=${from}&to=${to}`)).body;

  it("saves, replaces, lists and clears a day's check-in", async () => {
    const res = await put("2026-11-16", { effects: { nausea: 2, fatigue: 1 }, note: " rough morning " });
    expect(res.status).toBe(200);
    expect(res.body.sideEffect).toEqual({ day: "2026-11-16", effects: { nausea: 2, fatigue: 1 }, note: "rough morning" });
    await put("2026-11-17", { effects: { headache: 3 } });
    await put("2026-11-16", { effects: { nausea: 1 } });
    expect(await list()).toEqual({
      days: [
        { day: "2026-11-16", effects: { nausea: 1 }, note: null },
        { day: "2026-11-17", effects: { headache: 3 }, note: null },
      ],
    });
    expect(await list("2026-11-17", TODAY)).toEqual({ days: [{ day: "2026-11-17", effects: { headache: 3 }, note: null }] });
    // a note alone is kept; nothing at all clears the day
    expect((await put("2026-11-16", { effects: {}, note: "fine today" })).body.sideEffect).toEqual({ day: "2026-11-16", effects: {}, note: "fine today" });
    expect((await put("2026-11-16", { effects: {} })).body).toEqual({ sideEffect: null });
    expect((await put("2026-11-17", { effects: {}, note: "  " })).body).toEqual({ sideEffect: null });
    expect(await list()).toEqual({ days: [] });
  });

  it("rejects unknown effects, levels outside 1-3, bad days and bad ranges", async () => {
    for (const effects of [{ dizziness: 1 }, { nausea: 4 }, { nausea: 0 }, { nausea: 1.5 }, { nausea: "2" }]) {
      expect((await put("2026-11-16", { effects })).status).toBe(400);
    }
    expect((await put("2026-11-18", { effects: { nausea: 1 } })).status).toBe(400); // tomorrow
    expect((await put("nope", { effects: { nausea: 1 } })).status).toBe(400);
    expect((await t.api("GET", "/api/side-effects?from=2026-11-17&to=2026-11-01")).status).toBe(400);
    expect((await t.api("GET", "/api/side-effects?from=2024-01-01&to=2026-11-17")).status).toBe(400);
    expect((await t.api("GET", "/api/side-effects")).status).toBe(400);
    expect(await list()).toEqual({ days: [] });
  });
});

describe("after-injection averages", () => {
  const toast = { name: "Toast", servings: [{ label: "2 slices", grams: 60 }], nutrients: { calories: 160, protein_g: 6 } };
  const after = async () => (await t.api("GET", "/api/glp1/after-injection")).body;
  async function eat(day: string, food: { id: number }, quantity = 1) {
    const res = await t.api("POST", "/api/log", { day, meal: "lunch", food: { kind: "user_food", id: food.id }, servingIndex: 0, unit: "serving", quantity, fraction: 1 });
    expect(res.status).toBe(200);
  }

  it("averages calories and protein by days since the last shot, over days with food only", async () => {
    await setup();
    const food = (await t.api("POST", "/api/my-foods", toast)).body.food;
    await shot("2026-08-20"); // before the 12-week window
    await eat("2026-08-24", food); // offset 4, but outside the window (today - 84)
    await eat("2026-11-02", food); // 74 days after the 08-20 shot: ignored
    await shot("2026-11-03");
    await shot("2026-11-10");
    await eat("2026-11-03", food); // offset 0: 160 / 6
    await eat("2026-11-10", food, 2); // offset 0: 320 / 12
    await eat("2026-11-11", food); // offset 1: 160 / 6
    await t.api("POST", "/api/log", { day: "2026-11-12", meal: "supplements", water_ml: 500 }); // water only: not a day with food
    await eat("2026-11-17", food); // offset 7: ignored
    const res = await after();
    expect(res.enough).toBe(true);
    expect(res.days).toEqual([
      { offset: 0, avgCalories: 240, avgProtein: 9, daysCounted: 2 },
      { offset: 1, avgCalories: 160, avgProtein: 6, daysCounted: 1 },
      { offset: 2, avgCalories: null, avgProtein: null, daysCounted: 0 },
      { offset: 3, avgCalories: null, avgProtein: null, daysCounted: 0 },
      { offset: 4, avgCalories: null, avgProtein: null, daysCounted: 0 },
      { offset: 5, avgCalories: null, avgProtein: null, daysCounted: 0 },
      { offset: 6, avgCalories: null, avgProtein: null, daysCounted: 0 },
    ]);
  });

  it("isn't enough with fewer than 2 shots, and days before the first shot don't count", async () => {
    await setup();
    const food = (await t.api("POST", "/api/my-foods", toast)).body.food;
    await eat("2026-11-09", food); // before any shot
    await eat("2026-11-10", food);
    await shot("2026-11-10");
    const res = await after();
    expect(res.enough).toBe(false);
    expect(res.days[0]).toEqual({ offset: 0, avgCalories: 160, avgProtein: 6, daysCounted: 1 });
    expect(res.days.reduce((n: number, d: any) => n + d.daysCounted, 0)).toBe(1);
    await t.api("DELETE", "/api/glp1/shots/2026-11-10");
    expect((await after()).enough).toBe(false);
  });
});
