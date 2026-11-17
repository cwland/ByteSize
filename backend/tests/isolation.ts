import type { TestApp } from "./helpers.js";

// Calls the API as a given user (by their token), without touching the TestApp's own token
export function asUser(t: TestApp, token: string) {
  return async (method: string, url: string, body?: unknown) => {
    const res = await t.app.inject({ method: method as any, url, payload: body as any, headers: { authorization: `Bearer ${token}` } });
    let parsed: any = res.body;
    try {
      parsed = res.body ? JSON.parse(res.body) : null;
    } catch {
      // not JSON
    }
    return { status: res.statusCode, body: parsed };
  };
}

// Two signed-in members, "anna" and "ben", for checking one never sees the other's data.
// Sets up the admin first if needed. Every route that touches a person's data gets a case in isolation.test.ts.
export async function twoUsers(t: TestApp) {
  const a = await t.createUser("anna");
  const b = await t.createUser("ben");
  return { a: { ...a, as: asUser(t, a.token) }, b: { ...b, as: asUser(t, b.token) } };
}
