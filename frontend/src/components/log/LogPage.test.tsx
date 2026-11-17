import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogPage from "./LogPage";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { dayJson, entryJson, mealTotals, settingsMe } from "../../test/fixtures";

const toast = entryJson();
const bar = entryJson({
  id: 2,
  name: "Peanut butter bar",
  icon: "🍫",
  servingIndex: 1,
  fraction: 0.5,
  servings: [
    { label: "100 g", grams: 100 },
    { label: "1 bar", grams: 40 },
  ],
  nutrients: { calories: 127, protein_g: 10, carbs_g: 1, fat_g: 22 }, // no fiber: unknown
});
const day = dayJson({
  day: "2026-11-16",
  entries: [toast, bar],
  meals: {
    breakfast: mealTotals(287, { protein_g: 16, carbs_g: 1, fat_g: 24, fiber_g: 5, suggested: 392 }),
    lunch: mealTotals(0, { suggested: 490 }),
    dinner: mealTotals(0, { suggested: 686 }),
    snacks: mealTotals(0, { suggested: 392 }),
    supplements: mealTotals(0),
  },
});
const bothInBreakfast = { ...day, entries: [toast, { ...bar, meal: "breakfast" }] };

function show(routes: Record<string, (b: any) => unknown> = {}) {
  const server = fakeServer({ "GET /api/day/:date": () => bothInBreakfast, "GET /api/settings/me": () => settingsMe, ...routes });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <LogPage />
    </SelectedDayProvider>,
  );
  return server;
}


// "Today" is pinned: noon on Mon, Nov 16 in Boise (the fixtures' day), whatever the real date is
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("Log", () => {
  it("meal cards show entries with icons, portions and totals", async () => {
    show();
    const breakfast = await screen.findByRole("region", { name: "Breakfast" });
    expect(within(breakfast).getByRole("heading", { name: "Breakfast: 287 cals" })).toBeInTheDocument();
    expect(within(breakfast).getByText("16g protein · 1g carbs · 24g fat · 5g fiber")).toBeInTheDocument();
    const toastRow = within(breakfast).getByRole("button", { name: /Toast/ });
    expect(within(toastRow).getByText("🍞")).toBeInTheDocument();
    expect(within(breakfast).queryByText(/calories suggested/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Lunch" })).getByText("490 calories suggested")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Snacks" })).getByRole("button", { name: "Add Food" })).toBeInTheDocument();
  });

  it("meal card rows show amount first and pills", async () => {
    show();
    const breakfast = await screen.findByRole("region", { name: "Breakfast" });
    const toastRow = within(breakfast).getByRole("button", { name: /Toast/ });
    expect(within(toastRow).getByText("2 slices")).toBeInTheDocument();
    expect(within(toastRow).getByText("160 cal")).toBeInTheDocument();
    expect(within(toastRow).getByText("6 g protein")).toBeInTheDocument();
    expect(within(toastRow).getByText("4 g fiber")).toBeInTheDocument();
    const barRow = within(breakfast).getByRole("button", { name: /Peanut butter bar/ });
    expect(within(barRow).getByText("½ bar")).toBeInTheDocument();
    expect(within(barRow).getByText("127 cal")).toBeInTheDocument();
    expect(within(barRow).getByText("? g fiber")).toBeInTheDocument(); // unknown, not 0
    expect(within(breakfast).queryByText(/×/)).not.toBeInTheDocument();
  });

  it("move an entry to tomorrow's lunch", async () => {
    const server = show({ "POST /api/log/move": () => ({ entries: [] }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Toast/ }));
    await user.click(screen.getByRole("button", { name: "Move" }));
    const sheet = screen.getByRole("dialog", { name: "Move to…" });
    await user.click(within(sheet).getByRole("button", { name: "Later day" }));
    await user.click(within(sheet).getByRole("radio", { name: "Lunch" }));
    await user.click(within(sheet).getByRole("button", { name: "Move here" }));
    const moved = server.writes().find((w) => w.path === "/api/log/move")!;
    expect(moved.body).toEqual({ ids: [1], day: "2026-11-17", meal: "lunch", copy: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("delete asks first and removes the row", async () => {
    let deleted = false;
    const server = show({
      "GET /api/day/:date": () => (deleted ? { ...bothInBreakfast, entries: [bothInBreakfast.entries[1]] } : bothInBreakfast),
      "DELETE /api/log/:id": () => {
        deleted = true;
        return { status: 204 };
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Toast/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete Toast?" });
    expect(server.writes()).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(server.writes()).toContainEqual(expect.objectContaining({ method: "DELETE", path: "/api/log/1" }));
    await screen.findByRole("button", { name: /Peanut butter bar/ });
    expect(screen.queryByRole("button", { name: /Toast/ })).not.toBeInTheDocument();
  });

  it("editing an entry uses the same sheet with Save", async () => {
    const server = show({ "PATCH /api/log/:id": (b) => ({ entry: { ...bar, ...b } }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Peanut butter bar/ }));
    const sheet = screen.getByRole("dialog", { name: "Edit portion" });
    expect(within(sheet).getByRole("region", { name: "Nutrition facts" })).toBeInTheDocument();
    for (const b of ["Move", "Copy", "Delete"]) expect(within(sheet).getByRole("button", { name: b })).toBeInTheDocument();
    const serving = within(sheet).getByRole("button", { name: /^Serving/ });
    expect(serving).toHaveTextContent("½ bar");
    await user.click(serving);
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Whole number" }), "1");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Fraction" }), "—");
    expect(serving).toHaveTextContent("1 bar");
    const cal = within(within(sheet).getByRole("region", { name: "Summary" })).getByText("Calories").parentElement!;
    expect(cal).toHaveTextContent("254");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(server.writes()).toContainEqual(expect.objectContaining({ method: "PATCH", path: "/api/log/2", body: { servingIndex: 1, unit: "serving", quantity: 1, fraction: 1 } }));
  });

  it("a refused edit shows the server's message in the sheet", async () => {
    show({ "PATCH /api/log/:id": () => ({ status: 400, json: { error: "Can't measure this food in ml" } }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Toast/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't measure this food in ml");
  });

  it("a food with unknown calories shows a question mark, not 0, in the row and the sheet", async () => {
    const mystery = entryJson({ id: 3, name: "Mystery soup", icon: "🍲", nutrients: { protein_g: 8 } });
    show({ "GET /api/day/:date": () => ({ ...day, entries: [mystery] }) });
    const row = await screen.findByRole("button", { name: /Mystery soup/ });
    expect(within(row).getByText("? cal")).toBeInTheDocument();
    expect(within(row).queryByText("0 cal")).not.toBeInTheDocument();
    await userEvent.setup().click(row);
    const cal = within(screen.getByRole("region", { name: "Summary" })).getByText("Calories").parentElement!;
    expect(cal).toHaveTextContent("?");
    expect(cal).not.toHaveTextContent("0");
  });
});
