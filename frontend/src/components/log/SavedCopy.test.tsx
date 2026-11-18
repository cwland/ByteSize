// §21 "Saved copy from <date>" with Check for changes: on search rows and in Track food.
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogPage from "./LogPage";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { barFood, culuryOff, dayJson, restaurantRoutes, settingsMe } from "../../test/fixtures";

const SAVED = "2026-11-17T12:00:00.000Z";
const keptBar = { ...barFood, savedAt: SAVED };
const freshUsda = { ...barFood, id: 77, name: "Peanuts, raw", brand: null, barcode: null, source: "usda", savedAt: null };
const myShake = { ...barFood, kind: "user_food", id: 5, name: "Peanut protein shake", brand: null, barcode: null, source: "mine" };
const search = {
  groups: [
    { source: "mine", label: "My foods", foods: [myShake] },
    { source: "usda", label: "USDA branded", foods: [freshUsda] },
    { source: "off", label: "Open Food Facts", foods: [keptBar] },
  ],
  errors: [],
};

function open(refresh: (b: any) => unknown, routes: Record<string, (b: any, path: string) => unknown> = {}) {
  const server = fakeServer({
    ...culuryOff,
    "GET /api/day/:date": () => dayJson(),
    "GET /api/settings/me": () => settingsMe,
    "GET /api/foods/recent": () => ({ foods: [] }),
    "GET /api/foods/search": () => search,
    "POST /api/foods/refresh": refresh,
    ...restaurantRoutes,
    ...routes,
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <LogPage />
    </SelectedDayProvider>,
  );
  return server;
}

async function searchPeanut(user: ReturnType<typeof userEvent.setup>) {
  const card = await screen.findByRole("region", { name: "Snacks" });
  await user.click(within(card).getByRole("button", { name: "Add Food" }));
  const sheet = screen.getByRole("dialog", { name: "Add food to Snacks" });
  await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "peanut");
  await within(sheet).findByText("Peanut butter bar");
  return sheet;
}
const rowOf = (sheet: HTMLElement, name: string) => within(sheet).getByText(name).closest("li")!;

describe("Saved copy note", () => {
  it("a search row from a kept copy says so; Check for changes refreshes it and says Updated", async () => {
    const user = userEvent.setup();
    const server = open(() => ({ result: "updated", food: { ...barFood, nutrients: { ...barFood.nutrients, calories: 470 }, savedAt: null } }));
    const sheet = await searchPeanut(user);
    const row = rowOf(sheet, "Peanut butter bar");
    expect(within(row).getByText("Saved copy from Nov 17, 2026")).toBeInTheDocument();
    // a food fetched just now and the person's own foods have no note
    expect(within(rowOf(sheet, "Peanuts, raw")).queryByText(/Saved copy/)).not.toBeInTheDocument();
    expect(within(rowOf(sheet, "Peanut protein shake")).queryByText(/Saved copy/)).not.toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Check Peanut butter bar for changes" }));
    expect(server.writes().at(-1)).toMatchObject({ method: "POST", path: "/api/foods/refresh", body: { cacheId: 42 } });
    expect(await within(row).findByText("Updated")).toBeInTheDocument();
    expect(within(row).queryByText(/Saved copy/)).not.toBeInTheDocument();
    expect(within(row).getByText(/188 cal/)).toBeInTheDocument(); // 1 bar (40 g) of the new 470 per 100 g
  });

  it("in Track food: the note and Check for changes, saying Up to date", async () => {
    const user = userEvent.setup();
    open(() => ({ result: "up_to_date", food: { ...barFood, savedAt: null } }));
    const sheet = await searchPeanut(user);
    await user.click(within(rowOf(sheet, "Peanut butter bar")).getByText("Peanut butter bar"));
    const track = screen.getByRole("dialog", { name: "Add food to Snacks" });
    expect(within(track).getByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(within(track).getByText("Saved copy from Nov 17, 2026")).toBeInTheDocument();
    await user.click(within(track).getByRole("button", { name: "Check Peanut butter bar for changes" }));
    expect(await within(track).findByText("Up to date")).toBeInTheDocument();
  });

  it("a failed check says why and keeps the note", async () => {
    const user = userEvent.setup();
    open(() => ({ status: 400, json: { error: "Turn on Open Food Facts in Settings › Integrations to check for changes" } }));
    const sheet = await searchPeanut(user);
    const row = rowOf(sheet, "Peanut butter bar");
    await user.click(within(row).getByRole("button", { name: "Check Peanut butter bar for changes" }));
    expect(await within(row).findByText(/Turn on Open Food Facts/)).toBeInTheDocument();
    expect(within(row).getByText("Saved copy from Nov 17, 2026")).toBeInTheDocument();
  });
});

describe("FatSecret search rows", () => {
  const summary = { ...barFood, id: 31, name: "Peanut granola clusters", brand: "Bear Naked", barcode: null, source: "fatsecret", servings: [{ label: "1/4 cup" }], nutrients: { calories: 140, protein_g: 3 }, savedAt: null, summary: true };
  const whole = { ...summary, servings: [{ label: "1/4 cup", grams: 30 }], nutrients: { calories: 140, protein_g: 3, fiber_g: 2 }, summary: false };

  it("opening one fetches the whole food first (fiber, grams)", async () => {
    const user = userEvent.setup();
    const server = open(() => ({}), {
      "GET /api/foods/search": () => ({ groups: [{ source: "fatsecret", label: "FatSecret", foods: [summary] }], errors: [] }),
      "GET /api/foods/cache/:id": () => ({ food: whole }),
    });
    const card = await screen.findByRole("region", { name: "Snacks" });
    await user.click(within(card).getByRole("button", { name: "Add Food" }));
    const sheet = screen.getByRole("dialog", { name: "Add food to Snacks" });
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "peanut");
    await user.click(await within(sheet).findByText("Peanut granola clusters"));
    expect(await within(sheet).findByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(server.sent.some((r) => r.path === "/api/foods/cache/31")).toBe(true);
    const fiber = within(within(sheet).getByRole("region", { name: "Summary" })).getByText("Fiber", { exact: true }).parentElement!;
    expect(fiber).toHaveTextContent("2 g");
  });
});
