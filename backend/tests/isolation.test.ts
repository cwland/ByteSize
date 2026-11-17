import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { twoUsers } from "./isolation.js";
import { softPasskey } from "./softPasskey.js";

// Every route that reads or changes a person's data gets a case here (M2 adds foods, logs, targets...)
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

describe("per-user isolation", () => {
  it("a user only sees their own sessions", async () => {
    const { a, b } = await twoUsers(t);
    const mine = (await a.as("GET", "/api/auth/sessions")).body;
    const bens = (await b.as("GET", "/api/auth/sessions")).body;
    expect(mine.length).toBeGreaterThan(0);
    const bensIds = new Set(bens.map((s: any) => s.id));
    expect(mine.some((s: any) => bensIds.has(s.id))).toBe(false);
    expect((await a.as("DELETE", `/api/auth/sessions/${bens[0].id}`)).status).toBe(404);
    expect((await b.as("GET", "/api/auth/me")).status).toBe(200); // ben is still signed in
  });

  it("a member's sign-in history shows only their own attempts", async () => {
    const { a } = await twoUsers(t);
    const names = (await a.as("GET", "/api/auth/logins")).body.map((e: any) => e.username.toLowerCase());
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names)).toEqual(new Set(["anna"]));
  });

  it("a user can't list, rename or delete another user's passkeys", async () => {
    const { a, b } = await twoUsers(t);
    const origin = "http://localhost:5173";
    const key = softPasskey();
    const as = (token: string, method: string, url: string, payload?: object) =>
      t.app.inject({ method: method as "POST", url, payload, headers: { origin, authorization: `Bearer ${token}` } }).then((r) => ({ status: r.statusCode, body: r.body ? r.json() : undefined }));
    const o = await as(b.token, "POST", "/api/passkeys/register/options", {});
    const added = await as(b.token, "POST", "/api/passkeys/register/verify", { challengeId: o.body.challengeId, response: key.create(o.body.options, origin), name: "Ben's phone" });
    expect(added.status).toBe(200);
    expect((await a.as("GET", "/api/passkeys")).body).toEqual([]);
    expect((await a.as("PATCH", `/api/passkeys/${added.body.id}`, { name: "Mine now" })).status).toBe(404);
    expect((await a.as("DELETE", `/api/passkeys/${added.body.id}`)).status).toBe(404);
    expect((await b.as("GET", "/api/passkeys")).body).toMatchObject([{ id: added.body.id, name: "Ben's phone" }]);
  });

  it("a member can't see someone else's sign-ins by setting their email to that username", async () => {
    await t.createUser("alice@example.com");
    const mallory = await t.createUser("mallory");
    const as = (await import("./isolation.js")).asUser(t, mallory.token);
    expect((await as("PATCH", "/api/profile", { email: "Alice@example.com" })).status).toBe(200);
    const names = (await as("GET", "/api/auth/logins")).body.map((e: any) => e.username.toLowerCase());
    expect(names).not.toContain("alice@example.com");
    expect(names).toContain("mallory");
  });
  it("a user can't see another's body, plans or targets", async () => {
    const { a, b } = await twoUsers(t);
    const body = { sex: "female", birthYear: 1980, heightCm: 165, weightKg: 90, goalWeightKg: 70, activity: "light", glp1: false };
    expect((await a.as("PUT", "/api/body", body)).status).toBe(200);
    expect((await a.as("POST", "/api/plans/select", { plan: "steady" })).status).toBe(200);
    const windows = { breakfast: "08:00", lunch: "12:00", snacks: "15:00", dinner: "19:00" };
    expect((await a.as("PUT", "/api/settings/me", { mealWindows: windows, waterButtonsMl: [300] })).status).toBe(200);

    expect((await b.as("GET", "/api/body")).body).toEqual({ body: null });
    expect((await b.as("GET", "/api/plans")).status).toBe(409);
    expect((await b.as("GET", "/api/targets")).body).toEqual({ targets: null });
    expect((await b.as("GET", "/api/settings/me")).body.waterButtonsMl).toEqual([237, 473]);
    // ben's own changes don't touch anna's
    expect((await b.as("PUT", "/api/targets", { calories: { min: 1000, max: 1100 }, protein_g: { min: 1, max: 2 }, fiber_g: { min: 1, max: 2 }, water_ml: { min: 1, max: 2 } })).status).toBe(200);
    expect((await a.as("GET", "/api/targets")).body.targets.plan).toBe("steady");
    expect((await a.as("GET", "/api/body")).body).toEqual({ body });
    expect((await a.as("GET", "/api/settings/me")).body).toEqual({ mealWindows: windows, waterButtonsMl: [300] });
  });
});
