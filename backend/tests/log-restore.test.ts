import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { twoUsers } from "./isolation.js";
import { logEntries, logTrash } from "../src/db/schema.js";

// Undo for a deleted log entry (iOS design §6.7 change 7): a deleted entry waits 10 minutes in the trash, and
// POST /api/log/:id/restore puts it back exactly as it was.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

const DAY = "2026-11-17";
const TOO_LATE = "That's too late to undo";

/** A food entry with an AI flag, a fraction and an early time, written straight to the table. */
async function yogurt(userId: number, at = new Date("2026-11-17T15:00:00Z")) {
  const [row] = await t.db
    .insert(logEntries)
    .values({
      userId,
      day: DAY,
      meal: "breakfast",
      name: "Greek yogurt",
      brand: "Fage",
      icon: "🥣",
      source: "cache",
      sourceRef: "cache:7",
      servingIndex: 0,
      unit: "serving",
      quantity: 2,
      fraction: 0.5,
      perServing: { calories: 100, protein_g: 18 },
      servings: [{ label: "1 cup", grams: 227 }],
      nutrients: { calories: 100, protein_g: 18 },
      aiEstimated: true,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  return row;
}

describe("restore a deleted log entry", () => {
  it("comes back with the same id, amount, flags and place in the day", async () => {
    const { a } = await twoUsers(t);
    t.clock.date = new Date("2026-11-17T18:00:00Z");
    const first = await yogurt(a.id);
    const water = await a.as("POST", "/api/log", { water_ml: 500, day: DAY });
    expect(water.status).toBe(200);
    expect((await a.as("DELETE", `/api/log/${first.id}`)).status).toBe(204);
    expect((await a.as("GET", `/api/day/${DAY}`)).body.entries.map((e: { id: number }) => e.id)).toEqual([water.body.entry.id]);

    const back = await a.as("POST", `/api/log/${first.id}/restore`);
    expect(back.status).toBe(200);
    expect(back.body.entry).toMatchObject({ id: first.id, name: "Greek yogurt", quantity: 2, fraction: 0.5, aiEstimated: true, meal: "breakfast", day: DAY });
    const day = (await a.as("GET", `/api/day/${DAY}`)).body;
    expect(day.entries.map((e: { id: number }) => e.id)).toEqual([first.id, water.body.entry.id]); // its old place (created first)
    expect(await t.db.select().from(logTrash)).toHaveLength(0);
  });

  it("works once", async () => {
    const { a } = await twoUsers(t);
    const row = await yogurt(a.id);
    await a.as("DELETE", `/api/log/${row.id}`);
    expect((await a.as("POST", `/api/log/${row.id}/restore`)).status).toBe(200);
    const again = await a.as("POST", `/api/log/${row.id}/restore`);
    expect(again.status).toBe(404);
    expect(again.body.error).toBe(TOO_LATE);
  });

  it("is only for the person who deleted it", async () => {
    const { a, b } = await twoUsers(t);
    const row = await yogurt(a.id);
    await a.as("DELETE", `/api/log/${row.id}`);
    expect((await b.as("POST", `/api/log/${row.id}/restore`)).status).toBe(404);
    expect(await t.db.select().from(logTrash)).toHaveLength(1);
    expect((await a.as("POST", `/api/log/${row.id}/restore`)).status).toBe(200);
  });

  it("is too late after 10 minutes", async () => {
    const { a } = await twoUsers(t);
    t.clock.date = new Date("2026-11-17T18:00:00Z");
    const row = await yogurt(a.id);
    await a.as("DELETE", `/api/log/${row.id}`);
    t.clock.date = new Date("2026-11-17T18:11:00Z");
    const late = await a.as("POST", `/api/log/${row.id}/restore`);
    expect(late.status).toBe(404);
    expect(late.body.error).toBe(TOO_LATE);
    expect(await t.db.select().from(logEntries).where(eq(logEntries.id, row.id))).toHaveLength(0);
  });

  it("a delete clears that person's trash older than 10 minutes", async () => {
    const { a, b } = await twoUsers(t);
    t.clock.date = new Date("2026-11-17T18:00:00Z");
    const old = await yogurt(a.id);
    const bens = await yogurt(b.id);
    await a.as("DELETE", `/api/log/${old.id}`);
    await b.as("DELETE", `/api/log/${bens.id}`);
    t.clock.date = new Date("2026-11-17T18:20:00Z");
    const fresh = await yogurt(a.id);
    await a.as("DELETE", `/api/log/${fresh.id}`);
    const left = await t.db.select({ userId: logTrash.userId, entryId: logTrash.entryId }).from(logTrash);
    expect(left).toEqual(expect.arrayContaining([{ userId: a.id, entryId: fresh.id }, { userId: b.id, entryId: bens.id }]));
    expect(left).toHaveLength(2);
  });

  it("restores water too", async () => {
    const { a } = await twoUsers(t);
    const water = (await a.as("POST", "/api/log", { water_ml: 250, day: DAY })).body.entry;
    await a.as("DELETE", `/api/log/${water.id}`);
    const back = await a.as("POST", `/api/log/${water.id}/restore`);
    expect(back.status).toBe(200);
    expect(back.body.entry).toMatchObject({ id: water.id, name: "Water", quantity: 250, unit: "ml" });
  });

  it("an unknown id is too late as well", async () => {
    const { a } = await twoUsers(t);
    expect((await a.as("POST", "/api/log/999999/restore")).status).toBe(404);
  });
});
