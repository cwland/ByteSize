import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { multipart } from "./photoFakes.js";
import { weighIns } from "../src/db/schema.js";

// Each weigh-in remembers where it came from: typed (manual), Apple Health (health), or unknown (null: imported, or
// saved before ByteSize kept track). The iPhone marks Health ones.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
  t.clock.date = NOW;
});
afterAll(async () => t.close());

// America/Denver: 05:30 UTC on Nov 18 is Nov 17 there
const NOW = new Date("2026-11-18T05:30:00Z");
const typed = (day: string, weightKg: number) => t.api("PUT", `/api/weigh-ins/${day}`, { weightKg });
const fromHealth = (day: string, weightKg: number) => t.api("PUT", `/api/weigh-ins/${day}`, { weightKg, source: "health" });
const sourceOn = async (day: string) => (await t.db.select({ s: weighIns.source }).from(weighIns).where(and(eq(weighIns.userId, 1), eq(weighIns.day, day))))[0]?.s;
const listed = async () => (await t.api("GET", "/api/weight")).body.weighIns as { day: string; source: string | null }[];

describe("weigh-in source", () => {
  it("a typed weigh-in is saved as manual", async () => {
    await typed("2026-11-16", 80);
    expect(await sourceOn("2026-11-16")).toBe("manual");
  });

  it("a Health weigh-in on an empty day is saved as health", async () => {
    await fromHealth("2026-11-16", 80);
    expect(await sourceOn("2026-11-16")).toBe("health");
  });

  it("typing over a Health weigh-in makes it manual", async () => {
    await fromHealth("2026-11-16", 80);
    await typed("2026-11-16", 79.5);
    expect(await sourceOn("2026-11-16")).toBe("manual");
  });

  it("a Health weigh-in that is skipped leaves the typed one manual", async () => {
    await typed("2026-11-16", 80);
    await fromHealth("2026-11-16", 79);
    expect(await sourceOn("2026-11-16")).toBe("manual");
  });

  it("imported weigh-ins have no source, and replacing a day by import clears it", async () => {
    await typed("2026-11-15", 81);
    const { payload, headers } = multipart([
      { name: "existing", value: "replace" },
      { name: "file", filename: "weights.csv", type: "text/csv", data: Buffer.from("Date,Weight (kg)\n2026-11-14,82\n2026-11-15,81.5\n") },
    ]);
    expect((await t.api("POST", "/api/weight/import", payload, headers)).status).toBe(200);
    expect(await sourceOn("2026-11-14")).toBeNull();
    expect(await sourceOn("2026-11-15")).toBeNull();
  });

  it("GET /api/weight gives each weigh-in its source", async () => {
    await typed("2026-11-15", 81);
    await fromHealth("2026-11-16", 80);
    await t.db.insert(weighIns).values({ userId: 1, day: "2026-11-14", weightKg: 82 }); // from before sources were kept
    expect((await listed()).map((w) => [w.day, w.source])).toEqual([
      ["2026-11-14", null],
      ["2026-11-15", "manual"],
      ["2026-11-16", "health"],
    ]);
  });
});
