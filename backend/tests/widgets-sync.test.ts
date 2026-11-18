import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAYOUT_VERSION, MAX_COLUMNS, WIDGET_IDS } from "../src/lib/widgets.js";

// The app's widget registry and layout constants (frontend) must match what the server accepts (§28). Read as text
// so neither side's build depends on the other (the Docker build compiles each on its own).
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../frontend/src/components/dashboard/${rel}`, import.meta.url)), "utf8");

describe("dashboard widgets: frontend and server agree", () => {
  it("the registry has exactly the widget ids the server accepts", () => {
    const ids = [...read("widgets.tsx").matchAll(/\{ id: "([a-z-]+)", column:/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual([...WIDGET_IDS].sort());
  });

  it("layout version and column count match", () => {
    const layout = read("layout.ts");
    expect(Number(/export const LAYOUT_VERSION = (\d+);/.exec(layout)?.[1])).toBe(LAYOUT_VERSION);
    expect(Number(/export const COLUMNS = (\d+);/.exec(layout)?.[1])).toBe(MAX_COLUMNS);
  });
});
