import type { Nutrients, Serving } from "../nutrients.js";

// A food as an outside source describes it, already in ByteSize's shape (nutrients for servings[0]).
export type SourceFood = {
  source: "off" | "usda";
  sourceId: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  servings: Serving[];
  nutrients: Nutrients;
  imageUrl: string | null;
  raw: unknown;
};

export type FoodFetch = typeof fetch;

const LABEL = { off: "Open Food Facts", usda: "USDA" } as const;

/** A source that didn't answer usefully. The message is safe to show (never contains a key or URL). */
export class SourceError extends Error {
  constructor(
    public source: "off" | "usda",
    message: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

/**
 * Calls a source with a hard timeout (aborts the request, and gives up even if the fetch
 * ignores the abort). Returns the status and parsed JSON (null when the body isn't JSON).
 */
export async function requestJson(
  fetchFn: FoodFetch,
  source: "off" | "usda",
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; json: any }> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new SourceError(source, `${LABEL[source]} took too long to answer`));
    }, timeoutMs);
  });
  const call = (async () => {
    let res: Response;
    try {
      res = await fetchFn(url, { ...init, signal: ctrl.signal });
    } catch {
      throw new SourceError(source, `Couldn't reach ${LABEL[source]}`);
    }
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      // not JSON
    }
    return { status: res.status, json };
  })();
  try {
    return await Promise.race([call, timedOut]);
  } finally {
    clearTimeout(timer);
    call.catch(() => {}); // a late failure after the timeout is already handled
  }
}

export const sourceStatusError = (source: "off" | "usda", status: number) => new SourceError(source, `${LABEL[source]} answered with an error (${status})`);

/** A finite, non-negative number (OFF sometimes sends numeric strings), else undefined. */
export function num(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Rounding for stored per-100 values: calories and mg to 1 decimal, grams to 2. */
export const round = (v: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};
