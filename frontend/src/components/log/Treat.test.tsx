import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FoodHost from "../../test/FoodHost";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { barFood, culuryOff, dayJson, entryJson, restaurantRoutes, settingsMe, workoutCaloriesJson } from "../../test/fixtures";

// §40b: with the weekly bank on, a food can be logged as a treat (paid from the bank on purpose)
const bank = { weekStart: "2026-11-15", balance: 400, deposited: 400, spent: 0, weeklyCap: 1000, days: [], thisDay: { overBy: 0, covered: 0, treatSpent: 0 } };
const bankDay = (over: Record<string, unknown> = {}) => dayJson({ workoutCalories: workoutCaloriesJson({ mode: "bank", bank }), ...over });

function open(day: object, routes: Record<string, (b: any) => unknown> = {}) {
  const server = fakeServer({
    ...culuryOff,
    ...restaurantRoutes,
    "GET /api/day/:date": () => day,
    "GET /api/settings/me": () => settingsMe,
    "GET /api/foods/recent": () => ({ foods: [] }),
    "GET /api/foods/search": () => ({ groups: [{ source: "off", label: "Open Food Facts", foods: [barFood] }], errors: [] }),
    ...routes,
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <FoodHost />
    </SelectedDayProvider>,
  );
  return server;
}
async function trackBar(user: ReturnType<typeof userEvent.setup>) {
  const card = await screen.findByRole("region", { name: "Snacks" });
  await user.click(within(card).getByRole("button", { name: "Add Food" }));
  const sheet = screen.getByRole("dialog", { name: "Add food to Snacks" });
  await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "bar");
  await user.click(await within(sheet).findByRole("button", { name: /^Peanut butter bar/ }));
  return sheet;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("Treat", () => {
  it("with the weekly bank: Track food has a Treat switch; on, the entry is logged as a treat", async () => {
    const server = open(bankDay(), { "POST /api/log": (b) => ({ entry: entryJson({ ...b, id: 3 }) }) });
    const user = userEvent.setup();
    const sheet = await trackBar(user);
    const treat = within(sheet).getByRole("checkbox", { name: /Treat/ });
    expect(treat).not.toBeChecked();
    expect(within(sheet).getByText("Paid from your workout bank (400 this week)")).toBeInTheDocument();
    await user.click(treat);
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    expect(server.writes().find((w) => w.path === "/api/log")!.body).toMatchObject({ food: { kind: "cache", id: 42 }, treat: true });
  });

  it("without the weekly bank there is no Treat switch, and nothing extra is sent", async () => {
    const server = open(dayJson(), { "POST /api/log": (b) => ({ entry: entryJson({ ...b, id: 3 }) }) });
    const user = userEvent.setup();
    const sheet = await trackBar(user);
    expect(within(sheet).queryByRole("checkbox", { name: /Treat/ })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    expect(server.writes().find((w) => w.path === "/api/log")!.body).not.toHaveProperty("treat");
  });

  it("a treat shows as one in the meal; Edit entry can switch it off", async () => {
    const cookie = entryJson({ id: 7, meal: "snacks", name: "Cookie", treat: true, nutrients: { calories: 300 } });
    const server = open(bankDay({ entries: [cookie] }), { "PATCH /api/log/:id": (b) => ({ entry: { ...cookie, ...b } }) });
    const user = userEvent.setup();
    const row = await screen.findByRole("button", { name: /Cookie/ });
    expect(within(row).getByText("Treat")).toBeInTheDocument();
    await user.click(row);
    const sheet = screen.getByRole("dialog", { name: "Edit portion" });
    const treat = within(sheet).getByRole("checkbox", { name: /Treat/ });
    expect(treat).toBeChecked();
    await user.click(treat);
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(server.writes()[0]).toMatchObject({ method: "PATCH", path: "/api/log/7", body: { treat: false } });
  });

  it("Edit entry on a day without the bank: no Treat switch, and the body is the portion only", async () => {
    const toast = entryJson({ id: 8, meal: "breakfast" });
    const server = open(dayJson({ entries: [toast] }), { "PATCH /api/log/:id": (b) => ({ entry: { ...toast, ...b } }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Toast/ }));
    const sheet = screen.getByRole("dialog", { name: "Edit portion" });
    expect(within(sheet).queryByRole("checkbox", { name: /Treat/ })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(server.writes()[0].body).not.toHaveProperty("treat");
  });
});
