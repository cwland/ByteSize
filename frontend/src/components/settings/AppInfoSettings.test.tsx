import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import AppInfoSettings from "./AppInfoSettings";
import { COUNT_MS } from "../ui/CountUp";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

const you = {
  daysLogged: 1234, foodsLogged: 5678, differentFoods: 321, myFoods: 42, weighIns: 17, weightLost: { amount: 12.5, unit: "lb" }, shots: null, longestStreak: 21, memberSince: "2026-03-04",
  barcodesScanned: 88, photosRead: 9, aiEstimates: 14, aiInsights: 6, lookupsSaved: 1500,
  outsideLookups: { total: 100, off: 60, usda: 25, fatsecret: 10, spoonacular: 3, culury: 2 },
};
const info = (over: Record<string, unknown> = {}) => ({ you, countingSince: "2026-11-18", version: "1.2.3", ...over });
const everyone = { people: 4, daysLogged: 3000, foodsLogged: 12000, barcodesScanned: 400, outsideLookups: 650, lookupsSaved: 9000 };

/** Pretend the person asked for reduced motion, so numbers are there at once. */
const reduceMotion = () => {
  window.matchMedia = ((q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)", media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
};
const tile = (name: string) => screen.getByRole("group", { name });
/** What a screen reader reads for a tile's number. */
const value = (name: string) => tile(name).querySelector(".sr-only")!.textContent;
const shown = (name: string) => tile(name).querySelector('[aria-hidden="true"]:not(svg)')!.textContent;

beforeEach(() => reduceMotion());
afterEach(() => vi.useRealTimers());

describe("Settings › App info", () => {
  it("shows the person's own numbers as tiles, with thousands separators", async () => {
    const s = fakeServer({ "GET /api/app-info": () => info() });
    renderWithSession(<AppInfoSettings />, { isAdmin: false });
    await screen.findByRole("group", { name: "Days logged" });
    expect(s.sent[0].path).toBe("/api/app-info");
    const expected: [string, string][] = [
      ["Days logged", "1,234"], ["Foods logged", "5,678"], ["Different foods", "321"], ["My foods", "42"], ["Weigh-ins", "17"], ["Pounds lost", "12.5"], ["Longest streak", "21"],
      ["Barcodes scanned", "88"], ["Photos read", "9"], ["AI estimates", "14"], ["AI insights", "6"], ["Lookups saved", "1,500"], ["Outside lookups", "100"],
    ];
    for (const [name, n] of expected) expect(value(name), name).toBe(n);
  });

  it("Member since is a date, not a count; Shots logged is left out when GLP-1 is off; no admin totals for a member", async () => {
    fakeServer({ "GET /api/app-info": () => info() });
    renderWithSession(<AppInfoSettings />, { isAdmin: false });
    await screen.findByRole("group", { name: "Member since" });
    expect(within(tile("Member since")).getByText("Mar 4, 2026")).toBeInTheDocument();
    expect(tile("Member since").querySelector(".sr-only")).toBeNull();
    expect(screen.queryByRole("group", { name: "Shots logged" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Everyone on this server/)).not.toBeInTheDocument();
  });

  it("Shots logged shows with GLP-1 on, even at 0", async () => {
    fakeServer({ "GET /api/app-info": () => info({ you: { ...you, shots: 0 } }) });
    renderWithSession(<AppInfoSettings />, { isAdmin: false });
    await screen.findByRole("group", { name: "Shots logged" });
    expect(value("Shots logged")).toBe("0");
  });

  it("Pounds lost is in the person's units and hidden when there's no loss", async () => {
    fakeServer({ "GET /api/app-info": () => info({ you: { ...you, weightLost: { amount: 5.5, unit: "kg" } } }) });
    const first = renderWithSession(<AppInfoSettings />);
    await screen.findByRole("group", { name: "Kilograms lost" });
    expect(value("Kilograms lost")).toBe("5.5");
    expect(screen.queryByRole("group", { name: "Pounds lost" })).not.toBeInTheDocument();
    first.unmount();
    fakeServer({ "GET /api/app-info": () => info({ you: { ...you, weightLost: null } }) });
    renderWithSession(<AppInfoSettings />);
    await screen.findByRole("group", { name: "Days logged" });
    expect(screen.queryByRole("group", { name: /lost$/ })).not.toBeInTheDocument();
  });

  it("the counted tiles say when counting began; Outside lookups lists each source underneath", async () => {
    fakeServer({ "GET /api/app-info": () => info() });
    renderWithSession(<AppInfoSettings />);
    await screen.findByRole("group", { name: "Outside lookups" });
    expect(screen.getByText("Counting since Nov 18, 2026")).toBeInTheDocument();
    const outside = within(tile("Outside lookups"));
    for (const [source, n] of [["Open Food Facts", "60"], ["USDA", "25"], ["FatSecret", "10"], ["Spoonacular", "3"], ["Culury", "2"]]) {
      const line = outside.getByText(source).closest("li")!;
      expect(line.querySelector(".sr-only")!.textContent, source).toBe(n);
    }
  });

  it("the admin also gets Everyone on this server, with the six totals", async () => {
    fakeServer({ "GET /api/app-info": () => info({ everyone }) });
    renderWithSession(<AppInfoSettings />, { isAdmin: true });
    const section = await screen.findByRole("region", { name: "Everyone on this server" });
    const read = (name: string) => within(within(section).getByRole("group", { name })).getAllByText(/\d/, { selector: ".sr-only" })[0].textContent;
    expect(["People", "Days logged", "Foods logged", "Barcodes scanned", "Outside lookups", "Lookups saved"].map(read)).toEqual(["4", "3,000", "12,000", "400", "650", "9,000"]);
  });

  it("ends with the ByteSize version", async () => {
    fakeServer({ "GET /api/app-info": () => info() });
    renderWithSession(<AppInfoSettings />);
    expect(await screen.findByText("ByteSize v1.2.3")).toBeInTheDocument();
  });

  it("says so when the numbers can't be loaded", async () => {
    fakeServer({ "GET /api/app-info": () => ({ status: 500, json: { error: "Something went wrong" } }) });
    renderWithSession(<AppInfoSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("the numbers count up from 0, a little staggered, and end at their values", async () => {
    delete (window as { matchMedia?: unknown }).matchMedia; // no reduce motion
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    fakeServer({ "GET /api/app-info": () => info() });
    // Rendered inside act, so the answer, its render and the tiles' effects (each starting its count) are all done
    // before the clock moves: waiting with findBy* left the effects to a later task, which under load could run
    // after the first advance and start counting late (§46). Nothing here waits on real time.
    await act(async () => void renderWithSession(<AppInfoSettings />));
    screen.getByRole("group", { name: "Days logged" });
    expect(shown("Days logged")).toBe("0");
    expect(value("Days logged")).toBe("1,234"); // screen readers don't wait
    act(() => void vi.advanceTimersByTime(250));
    expect(Number(shown("Days logged").replace(/,/g, ""))).toBeGreaterThan(0);
    expect(shown("Outside lookups")).toBe("0"); // a later tile hasn't started yet
    act(() => void vi.advanceTimersByTime(COUNT_MS + 1500));
    expect(shown("Days logged")).toBe("1,234");
    expect(shown("Outside lookups")).toBe("100");
    expect(shown("Pounds lost")).toBe("12.5");
  });
});
