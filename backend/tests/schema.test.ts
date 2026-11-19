import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { appLog, passkeys, sessions, users } from "../src/db/schema.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());

describe("schema", () => {
  it("every user-owned table cascades with its user", async () => {
    const [u] = await t.db.insert(users).values({ username: "alex", passwordHash: "x" }).returning();
    expect(u.isAdmin).toBe(false);
    expect(u.disabled).toBe(false);
    expect(u.units).toBe("imperial");
    expect(u.timezone).toBe("America/Denver");
    await t.db.insert(sessions).values({ userId: u.id, tokenId: "tok", tokenVersion: 0, how: "password", expiresAt: new Date(Date.now() + 1000) });
    await t.db.insert(passkeys).values({ userId: u.id, credentialId: "cred", publicKey: "pk", rpId: "localhost", name: "Phone" });
    await t.db.insert(appLog).values({ userId: u.id, category: "auth", level: "info", event: "user line" });
    await t.db.insert(appLog).values({ category: "schedule", level: "info", event: "system line" });

    await t.db.delete(users).where(eq(users.id, u.id));

    expect(await t.db.select().from(sessions)).toHaveLength(0);
    expect(await t.db.select().from(passkeys)).toHaveLength(0);
    const left = await t.db.select().from(appLog);
    expect(left.map((r) => r.event)).toEqual(["system line"]);
    expect(await t.db.select().from(appLog).where(isNull(appLog.userId))).toHaveLength(1);
  });
});
