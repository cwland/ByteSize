import { afterEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Who is signing in is worked out from X-Forwarded-For only when the connection comes from a trusted proxy.
// Anyone else's header is ignored, so a device on the network can't pose as a new address on every try to
// get around the lockout after 5 wrong passwords (or the per-address request limits).

const saved = process.env.TRUST_PROXY;
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
  if (saved === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = saved;
});

async function start(trustProxy?: string) {
  if (trustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = trustProxy;
  t = await setupTestApp();
  await t.login(); // makes "alex"
  t.setToken("");
  return t;
}

// A sign-in arriving over a connection from `from`, claiming to be `claims` in X-Forwarded-For
async function signIn(app: TestApp, from: string, password: string, claims?: string) {
  const res = await app.app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: from,
    headers: claims ? { "x-forwarded-for": claims } : {},
    payload: { username: "alex", password },
  });
  return res.statusCode;
}

describe("forwarded addresses", () => {
  it("by default, a device on the network can't fake new addresses to dodge the lockout", async () => {
    const app = await start();
    for (let i = 0; i < 5; i++) await signIn(app, "192.168.50.60", "wrong-pass", `203.0.113.${i + 1}`);
    expect(await signIn(app, "192.168.50.60", "password123", "203.0.113.99")).toBe(429);
  });

  it("by default, a Docker container can't either", async () => {
    const app = await start();
    for (let i = 0; i < 5; i++) await signIn(app, "172.19.0.1", "wrong-pass", `203.0.113.${i + 1}`);
    expect(await signIn(app, "172.19.0.1", "password123", "203.0.113.99")).toBe(429);
  });

  it("with TRUST_PROXY set, people behind the proxy are told apart by their real address", async () => {
    const app = await start("172.20.0.2");
    for (let i = 0; i < 5; i++) await signIn(app, "172.20.0.2", "wrong-pass", "192.168.50.60");
    expect(await signIn(app, "172.20.0.2", "password123", "192.168.50.60")).toBe(429); // the guesser is locked out
    expect(await signIn(app, "172.20.0.2", "password123", "192.168.50.70")).toBe(200); // everyone else isn't
  });

  it("with TRUST_PROXY set, a header from anything but the proxy is ignored", async () => {
    const app = await start("172.20.0.2");
    for (let i = 0; i < 5; i++) await signIn(app, "192.168.50.60", "wrong-pass", `203.0.113.${i + 1}`);
    expect(await signIn(app, "192.168.50.60", "password123", "203.0.113.99")).toBe(429);
  });
});
