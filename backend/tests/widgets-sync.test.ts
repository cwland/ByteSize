import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAYOUT_PAGES, LAYOUT_VERSION, MAX_COLUMNS, PAGE_WIDGETS } from "../src/lib/widgets.js";

// The app's widget registry and layout constants (frontend) must match what the server accepts (§28, §40a). Read as
// text so neither side's build depends on the other (the Docker build compiles each on its own).
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../frontend/src/components/dashboard/${rel}`, import.meta.url)), "utf8");

// Registry entries begin `{ id: "goal-date", pages: { goals: 0, dashboard: null }, …`
function registry() {
  const out: Record<string, string[]> = {};
  for (const m of read("widgets.tsx").matchAll(/\{ id: "([a-z-]+)", pages: \{([^}]*)\}/g)) {
    for (const page of [...m[2].matchAll(/([a-z]+):/g)].map((p) => p[1])) (out[page] ??= []).push(m[1]);
  }
  return out;
}

describe("widgets: frontend and server agree", () => {
  it("each page's registry has exactly the widget ids the server accepts for it", () => {
    const pages = registry();
    expect(Object.keys(pages).sort()).toEqual([...LAYOUT_PAGES].sort());
    for (const page of LAYOUT_PAGES) expect(pages[page].sort(), page).toEqual([...PAGE_WIDGETS[page]].sort());
  });

  it("layout version, column count and pages match", () => {
    const layout = read("layout.ts");
    expect(Number(/export const LAYOUT_VERSION = (\d+);/.exec(layout)?.[1])).toBe(LAYOUT_VERSION);
    expect(Number(/export const COLUMNS = (\d+);/.exec(layout)?.[1])).toBe(MAX_COLUMNS);
    const pages = /export const LAYOUT_PAGES = \[([^\]]*)\]/.exec(layout)?.[1];
    expect([...(pages ?? "").matchAll(/"([a-z]+)"/g)].map((m) => m[1])).toEqual([...LAYOUT_PAGES]);
  });
});
