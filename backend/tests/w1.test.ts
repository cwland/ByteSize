import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { twoUsers } from "./isolation.js";
import { glp1Settings, glp1Shots, users } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

// W1 (SPEC-14, SPEC-15): GLP-1 standard doses and dose units; the "What's new" version each person has seen.
let t: TestApp;
let me: number;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  me = (await t.login()).id;
});
afterAll(async () => t.close());

// a few days back: always a past day in the account's timezone
const today = () => new Date(t.app.now().getTime() - 3 * 86400000).toISOString().slice(0, 10);

describe("GLP-1 medications and dose units", () => {
  it("the standard medications and their doses come with the GLP-1 view", async () => {
    const r = await t.api("GET", "/api/glp1");
    expect(r.status).toBe(200);
    expect(r.body.medications).toContainEqual({ name: "Zepbound", ingredient: "tirzepatide", doses: [2.5, 5, 7.5, 10, 12.5, 15] });
    expect(r.body.medications.map((m: { name: string }) => m.name)).toEqual(["Wegovy", "Ozempic", "Zepbound", "Mounjaro", "Saxenda", "Trulicity"]);
    expect(r.body.medications.find((m: { name: string }) => m.name === "Wegovy").doses).toEqual([0.25, 0.5, 1, 1.7, 2.4]);
  });

  it("a compounded medication in units", async () => {
    const r = await t.api("PUT", "/api/glp1/settings", { medication: "Compounded Tirzepatide + B12", doseMg: 25, doseUnit: "units", injectionWeekday: 2 });
    expect(r.status).toBe(200);
    expect(r.body.settings).toEqual({ medication: "Compounded Tirzepatide + B12", doseMg: 25, doseUnit: "units", injectionWeekday: 2 });
    // a shot without a unit takes the settings' unit
    const shot = await t.api("PUT", `/api/glp1/shots/${today()}`, { site: "abdomen_left" });
    expect(shot.status).toBe(200);
    expect(shot.body.lastShot).toMatchObject({ doseMg: 25, doseUnit: "units" });
  });

  it("a standard medication is in mg when no unit is sent", async () => {
    const r = await t.api("PUT", "/api/glp1/settings", { medication: "Zepbound", doseMg: 7.5, injectionWeekday: 2 });
    expect(r.body.settings).toMatchObject({ doseUnit: "mg" });
  });

  it("how high a dose can be depends on its unit", async () => {
    const tooHigh = await t.api("PUT", "/api/glp1/settings", { medication: "Zepbound", doseMg: 150, doseUnit: "mg", injectionWeekday: 2 });
    expect(tooHigh.status).toBe(400);
    expect(JSON.stringify(tooHigh.body)).toContain("That dose looks too high");
    const units = await t.api("PUT", "/api/glp1/settings", { medication: "Compounded", doseMg: 150, doseUnit: "units", injectionWeekday: 2 });
    expect(units.status).toBe(200);
    expect((await t.api("PUT", "/api/glp1/settings", { medication: "Compounded", doseMg: 1500, doseUnit: "units", injectionWeekday: 2 })).status).toBe(400);
    expect((await t.api("PUT", "/api/glp1/settings", { medication: "Compounded", doseMg: 1, doseUnit: "drops", injectionWeekday: 2 })).status).toBe(400);
  });

  it("settings and shots saved before units read as mg", async () => {
    await t.db.insert(glp1Settings).values({ userId: me, medication: "Ozempic", doseMg: 1, injectionWeekday: 1 });
    await t.db.insert(glp1Shots).values({ userId: me, day: today(), medication: "Ozempic", doseMg: 1, site: "thigh_left" });
    const r = await t.api("GET", "/api/glp1");
    expect(r.body.settings.doseUnit).toBe("mg");
    expect(r.body.lastShot.doseUnit).toBe("mg");
  });
});

describe("What's new: the version each person has seen", () => {
  it("is saved and comes back with the user", async () => {
    expect((await t.api("GET", "/api/auth/me")).body.user.seenVersion).toBeNull();
    const r = await t.api("PUT", "/api/auth/seen-version", { version: "0.2.0" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ seenVersion: "0.2.0" });
    expect((await t.api("GET", "/api/auth/me")).body.user.seenVersion).toBe("0.2.0");
  });

  it("must look like a version", async () => {
    expect((await t.api("PUT", "/api/auth/seen-version", { version: "latest" })).status).toBe(400);
  });

  it("one person's seen version never changes another's", async () => {
    const { a, b } = await twoUsers(t);
    await a.as("PUT", "/api/auth/seen-version", { version: "0.2.0" });
    expect((await b.as("GET", "/api/auth/me")).body.user.seenVersion).toBeNull();
    const [row] = await t.db.select().from(users).where(eq(users.id, b.id));
    expect(row.seenVersion).toBeNull();
  });
});
