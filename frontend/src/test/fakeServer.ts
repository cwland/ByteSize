import { vi } from "vitest";

// A pretend ByteSize server at the HTTP boundary: the screens and api.ts run for real, only fetch is
// replaced. Routes answer with the same shapes the real API sends; every request is recorded so tests
// can check what was sent.
export interface Sent {
  method: string;
  path: string;
  body: any;
  headers: Record<string, string>;
  signal?: AbortSignal; // aborted when the screen stops waiting (Cancel)
}
// A handler may return a Response itself (e.g. an answer streamed as lines)
type Handler = (body: any, path: string) => { status?: number; json?: unknown } | Response | unknown;

export function fakeServer(routes: Record<string, Handler>) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    const signal = init?.signal ?? undefined;
    sent.push({ method, path, body, headers: Object.fromEntries(new Headers(init?.headers).entries()), signal });
    const key = Object.keys(routes).find((k) => {
      const [m, pattern] = k.split(" ");
      return m === method && new RegExp(`^${pattern.replace(/:\w+/g, "[^/?]+")}(\\?.*)?$`).test(path);
    });
    if (!key) return new Response(JSON.stringify({ error: `No fake for ${method} ${path}` }), { status: 404 });
    // Like a real fetch, an aborted request rejects with AbortError (even while the handler is still working)
    const aborted = new Promise<never>((_, reject) => {
      const fail = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal?.aborted) fail();
      signal?.addEventListener("abort", fail);
    });
    aborted.catch(() => {});
    const out = (await Promise.race([routes[key](body, path), aborted])) as { status?: number; json?: unknown };
    if (out instanceof Response) return out;
    // { status: 409, json: … } sets the HTTP status; anything else is the JSON itself
    const isWrapped = !!out && typeof out === "object" && typeof out.status === "number" && Object.keys(out).every((k) => k === "status" || k === "json");
    const status = isWrapped ? (out.status ?? 200) : 200;
    const json = isWrapped ? out.json : out;
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(json ?? {}), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { sent, writes: () => sent.filter((s) => s.method !== "GET") };
}

// A user exactly as the API's publicUser() returns it
export function userJson(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: "cory",
    displayName: "Cory",
    email: null,
    isAdmin: true,
    theme: "avocado",
    colorMode: "system",
    units: "imperial",
    timezone: "America/Boise",
    setupDone: true,
    ...over,
  };
}
