import { describe, expect, it } from "vitest";
import { ApiError, apiLines } from "./api";
import { fakeServer } from "./test/fakeServer";

const lines = (text: string) => new Response(text, { headers: { "content-type": "application/x-ndjson" } });

describe("apiLines", () => {
  it("hands progress lines on and returns the answer line", async () => {
    fakeServer({ "POST /api/ai/estimate": () => lines('{"progress":"another"}\n{"food":{"name":"Toast"}}\n') });
    const seen: unknown[] = [];
    expect(await apiLines("POST", "/api/ai/estimate", { text: "toast" }, { onLine: (l) => seen.push(l) })).toEqual({ food: { name: "Toast" } });
    expect(seen).toEqual([{ progress: "another" }]);
  });

  it("a line that isn't JSON is the app's own error, not a SyntaxError", async () => {
    fakeServer({ "POST /api/ai/estimate": () => lines('{"progress":"another"}\n<html>Bad gateway</html>\n') });
    const err = (await apiLines("POST", "/api/ai/estimate", { text: "toast" }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Couldn't reach ByteSize. Check your connection and try again.");
  });
});
