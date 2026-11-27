import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { weighIns } from "../src/db/schema.js";

// The iPhone's one-time match: weigh-ins with no source whose weight matches Apple Health that day become "health".
// Nothing else changes: weights stay, typed and Health ones are left alone.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
  t.clock.date = new Date("2026-11-18T05:30:00Z");
});
afterAll(async () => t.close());

const match = (items: { day: string; weightKg: number }[]) => t.api("POST", "/api/weigh-ins/health-match", { items });
const old = (day: string, weightKg: number, userId = 1) => t.db.insert(weighIns).values({ userId, day, weightKg }); // no source
const row = async (day: string, userId = 1) =>
  (await t.db.select({ w: weighIns.weightKg, s: weighIns.source }).from(weighIns).where(and(eq(weighIns.userId, userId), eq(weighIns.day, day))))[0];

describe("POST /api/weigh-ins/health-match", () => {
  it("marks an unknown weigh-in whose weight is within 0.05 kg of Health's, and keeps its weight", async () => {
    await old("2026-11-10", 100);
    const r = await match([{ day: "2026-11-10", weightKg: 100.04 }]);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ matched: 1 });
    expect(await row("2026-11-10")).toEqual({ w: 100, s: "health" });
  });

  it("leaves one that is 0.06 kg off", async () => {
    await old("2026-11-10", 100);
    expect((await match([{ day: "2026-11-10", weightKg: 100.06 }])).body).toEqual({ matched: 0 });
    expect(await row("2026-11-10")).toEqual({ w: 100, s: null });
  });

  it("never touches typed or Health weigh-ins", async () => {
    await t.api("PUT", "/api/weigh-ins/2026-11-11", { weightKg: 90 });
    await t.api("PUT", "/api/weigh-ins/2026-11-12", { weightKg: 89, source: "health" });
    const r = await match([
      { day: "2026-11-11", weightKg: 90 },
      { day: "2026-11-12", weightKg: 89 },
    ]);
    expect(r.body).toEqual({ matched: 0 });
    expect((await row("2026-11-11"))?.s).toBe("manual");
    expect((await row("2026-11-12"))?.s).toBe("health");
  });

  it("skips days with no weigh-in and makes none", async () => {
    expect((await match([{ day: "2026-11-09", weightKg: 80 }])).body).toEqual({ matched: 0 });
    expect(await row("2026-11-09")).toBeUndefined();
  });

  it("only marks the caller's own weigh-ins", async () => {
    const ben = await t.createUser("ben");
    await old("2026-11-10", 100, ben.id);
    expect((await match([{ day: "2026-11-10", weightKg: 100 }])).body).toEqual({ matched: 0 });
    expect((await row("2026-11-10", ben.id))?.s).toBeNull();
  });

  it("takes 1 to 1000 items of a day and a weight", async () => {
    const many = Array.from({ length: 1001 }, () => ({ day: "2026-11-10", weightKg: 100 }));
    expect((await match(many)).status).toBe(400);
    expect((await match([])).status).toBe(400);
    expect((await match([{ day: "11/10/2026", weightKg: 100 }])).status).toBe(400);
    expect((await match([{ day: "2026-11-10", weightKg: -1 }])).status).toBe(400);
  });

  it("needs a signed-in person", async () => {
    t.setToken("");
    expect((await match([{ day: "2026-11-10", weightKg: 100 }])).status).toBe(401);
  });
});
