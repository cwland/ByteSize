import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FoodHost from "../../test/FoodHost";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { barFood, culuryChili, culuryOff, dayJson, restaurantRoutes, settingsMe } from "../../test/fixtures";

// Add food: a pill per source searched (§22). FatSecret, USDA and Open Food Facts start on; Basic and RecipeHub off.
const food = (id: number, name: string, source: string) => ({ ...barFood, id, name, brand: null, barcode: null, source });
const mine = { ...food(5, "My peanut shake", "mine"), kind: "user_food" };
const group = (source: string, label: string, foods: unknown[]) => ({ source, label, foods });
const GROUPS = [
  group("mine", "My foods", [mine]),
  group("culury", "RecipeHub", [{ ...culuryChili, name: "RecipeHub chili" }]),
  group("basic", "Basic foods", [food(10, "Basic peanuts", "usda"), food(11, "Basic almonds", "usda")]),
  group("fatsecret", "FatSecret", [food(20, "FatSecret peanut bar", "fatsecret")]),
  group("usda", "USDA branded", [food(30, "USDA peanut butter", "usda"), food(31, "USDA peanut oil", "usda")]),
  group("off", "Open Food Facts", [food(40, "OFF peanut snack", "off")]),
];
const ALL = ["mine", "fatsecret", "basic", "usda", "off", "culury"];
const answer = (over: Record<string, unknown> = {}) => ({ groups: GROUPS, errors: [], searched: ALL, ...over });

function open(search: () => unknown = () => answer(), user = {}) {
  const server = fakeServer({
    ...culuryOff,
    "GET /api/day/:date": () => dayJson(),
    "GET /api/settings/me": () => settingsMe,
    "GET /api/foods/recent": () => ({ foods: [] }),
    "GET /api/foods/search": search,
    "GET /api/foods/barcode/:code": () => ({ code: "0012345678905", food: barFood, errors: [] }),
    ...restaurantRoutes,
  });
  const r = renderWithSession(
    <SelectedDayProvider timeZone="America/Denver">
      <FoodHost />
    </SelectedDayProvider>,
    user,
  );
  return { server, ...r };
}

async function openSheet(u: ReturnType<typeof userEvent.setup>) {
  const card = await screen.findByRole("region", { name: "Snacks" });
  await u.click(within(card).getByRole("button", { name: "Add Food" }));
  return screen.getByRole("dialog", { name: "Add food to Snacks" });
}
async function search(u: ReturnType<typeof userEvent.setup>, sheet: HTMLElement, q = "peanut") {
  await u.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), q);
}
const pill = (sheet: HTMLElement, name: RegExp | string) => within(within(sheet).getByRole("group", { name: "Sources" })).getByRole("button", { name });
const pills = (sheet: HTMLElement) => within(within(sheet).getByRole("group", { name: "Sources" })).getAllByRole("button");
const searchCalls = (server: ReturnType<typeof fakeServer>) => server.sent.filter((s) => s.path.startsWith("/api/foods/search"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("source pills", () => {
  it("one pill per source searched, in order, each with its count", async () => {
    open();
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    expect(pills(sheet).map((p) => p.textContent)).toEqual(["My foods (1)", "FatSecret (1)", "Basic (2)", "USDA (2)", "Open Food Facts (1)", "RecipeHub (1)"]);
  });

  it("starts with FatSecret, USDA and Open Food Facts on, Basic and RecipeHub off: their groups are hidden", async () => {
    open();
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    expect(pills(sheet).map((p) => p.getAttribute("aria-pressed"))).toEqual(["true", "true", "false", "true", "true", "false"]);
    expect(within(sheet).getByText("FatSecret peanut bar")).toBeInTheDocument();
    expect(within(sheet).getByText("USDA peanut butter")).toBeInTheDocument();
    expect(within(sheet).queryByText("Basic peanuts")).toBeNull();
    expect(within(sheet).queryByText("RecipeHub chili")).toBeNull();
    expect(within(sheet).queryByRole("heading", { name: "Basic foods" })).toBeNull();
    expect(within(sheet).queryByRole("heading", { name: "RecipeHub" })).toBeNull();
  });

  it("My foods is a pill too: on by default, and turning it off hides its group", async () => {
    open();
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    expect(pills(sheet)[0]).toHaveTextContent("My foods (1)");
    expect(within(sheet).getByText("My peanut shake")).toBeInTheDocument();
    await u.click(pill(sheet, /^My foods/));
    expect(within(sheet).queryByText("My peanut shake")).toBeNull();
    await u.click(pill(sheet, /^My foods/));
    expect(within(sheet).getByText("My peanut shake")).toBeInTheDocument();
  });

  it("Recents (before typing) are not filtered by the pills", async () => {
    localStorage.setItem("bytesize.searchSources.1", JSON.stringify({ mine: false }));
    open();
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    expect(within(sheet).queryByRole("group", { name: "Sources" })).toBeNull();
  });

  it("a saved choice with no My foods entry treats it as on", async () => {
    localStorage.setItem("bytesize.searchSources.1", JSON.stringify({ fatsecret: true, basic: false, usda: true, off: true, culury: false }));
    open();
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    expect(pill(sheet, /^My foods/)).toHaveAttribute("aria-pressed", "true");
    expect(within(sheet).getByText("My peanut shake")).toBeInTheDocument();
  });

  it("a kept food of a pill source that wasn't searched (off, or no key) stays hidden", async () => {
    open(() => answer({ searched: ["mine", "off"], groups: [GROUPS[0], GROUPS[2], GROUPS[3], GROUPS[5]] }));
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    expect(within(sheet).queryByText("Basic peanuts")).toBeNull();
    expect(within(sheet).queryByText("FatSecret peanut bar")).toBeNull();
  });

  it("turning a pill on shows its group, off hides it, with no extra search", async () => {
    const { server } = open();
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    const before = searchCalls(server).length;
    await u.click(pill(sheet, /^RecipeHub/));
    expect(pill(sheet, /^RecipeHub/)).toHaveAttribute("aria-pressed", "true");
    expect(within(sheet).getByText("RecipeHub chili")).toBeInTheDocument();
    await u.click(pill(sheet, /^Basic/));
    expect(within(sheet).getByText("Basic almonds")).toBeInTheDocument();
    await u.click(pill(sheet, /^Open Food Facts/));
    expect(within(sheet).queryByText("OFF peanut snack")).toBeNull();
    expect(searchCalls(server)).toHaveLength(before);
  });

  it("pills are small (28 px) buttons that wrap", async () => {
    open();
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    const group = within(sheet).getByRole("group", { name: "Sources" });
    expect(group).toHaveClass("flex-wrap");
    for (const p of pills(sheet)) expect(p).toHaveClass("h-7");
  });

  it("a source with no results keeps its pill with (0)", async () => {
    open(() => answer({ groups: [GROUPS[0], GROUPS[3]] }));
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("FatSecret peanut bar");
    expect(pills(sheet).map((p) => p.textContent)).toEqual(["My foods (1)", "FatSecret (1)", "Basic (0)", "USDA (0)", "Open Food Facts (0)", "RecipeHub (0)"]);
  });

  it("a source that wasn't searched (switched off, or no key) has no pill", async () => {
    open(() => answer({ searched: ["mine", "off"], groups: [GROUPS[0], GROUPS[5]] }));
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    expect(pills(sheet).map((p) => p.textContent)).toEqual(["My foods (1)", "Open Food Facts (1)"]);
  });

  it("no sources searched: no pills at all", async () => {
    open(() => answer({ searched: [], groups: [] }));
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText(/No foods found/);
    expect(within(sheet).queryByRole("group", { name: "Sources" })).toBeNull();
  });

  it("a source that failed shows its pill with ! and its error line while on", async () => {
    open(() =>
      answer({
        groups: [GROUPS[0], GROUPS[3]],
        errors: [
          { source: "usda", message: "USDA couldn't be searched" },
          { source: "culury", message: "RecipeHub didn't answer" },
        ],
      }),
    );
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("FatSecret peanut bar");
    expect(pill(sheet, /^USDA/)).toHaveTextContent("USDA !");
    expect(pill(sheet, /^RecipeHub/)).toHaveTextContent("RecipeHub !");
    expect(within(sheet).getByText("USDA couldn't be searched")).toBeInTheDocument();
    expect(within(sheet).queryByText("RecipeHub didn't answer")).toBeNull(); // RecipeHub is off
    await u.click(pill(sheet, /^RecipeHub/));
    expect(within(sheet).getByText("RecipeHub didn't answer")).toBeInTheDocument();
  });

  it("when every pill that is on has nothing, says so and names the first pill with results", async () => {
    open(() => answer({ groups: [GROUPS[2], GROUPS[1]] }));
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    expect(await within(sheet).findByText("Nothing from My foods, FatSecret, USDA and Open Food Facts. Tap Basic (2) to see those.")).toBeInTheDocument();
    await u.click(pill(sheet, /^Basic/));
    expect(within(sheet).queryByText(/^Nothing from/)).toBeNull();
    expect(within(sheet).getByText("Basic peanuts")).toBeInTheDocument();
  });

  it("with one pill on and nothing from it: 'Nothing from My foods and FatSecret.'", async () => {
    open(() => answer({ searched: ["mine", "fatsecret", "basic"], groups: [GROUPS[2]] }));
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    expect(await within(sheet).findByText("Nothing from My foods and FatSecret. Tap Basic (2) to see those.")).toBeInTheDocument();
  });

  it("no 'Nothing from' line when nothing was found anywhere", async () => {
    open(() => answer({ groups: [] }));
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText(/No foods found/);
    expect(within(sheet).queryByText(/^Nothing from/)).toBeNull();
  });

  it("is remembered when the sheet is opened again", async () => {
    open();
    const u = userEvent.setup();
    let sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    await u.click(pill(sheet, /^RecipeHub/));
    await u.click(pill(sheet, /^Open Food Facts/));
    await u.click(within(sheet).getByRole("button", { name: "Close" }));
    sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("FatSecret peanut bar");
    expect(pills(sheet).map((p) => p.getAttribute("aria-pressed"))).toEqual(["true", "true", "false", "true", "false", "true"]);
    expect(within(sheet).getByText("RecipeHub chili")).toBeInTheDocument();
  });

  it("another person on the same browser starts from the defaults", async () => {
    const first = open();
    const u = userEvent.setup();
    let sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    await u.click(pill(sheet, /^RecipeHub/));
    first.unmount();
    open(() => answer(), { id: 2, username: "sam" });
    sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    expect(pills(sheet).map((p) => p.getAttribute("aria-pressed"))).toEqual(["true", "true", "false", "true", "true", "false"]);
  });

  it("a browser without storage still works, on the defaults", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((k) => {
      if (k.includes("source")) throw new Error("denied");
      return null;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((k) => {
      if (k.includes("source")) throw new Error("denied");
    });
    open();
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    expect(pill(sheet, /^FatSecret/)).toHaveAttribute("aria-pressed", "true");
    await u.click(pill(sheet, /^RecipeHub/));
    expect(within(sheet).getByText("RecipeHub chili")).toBeInTheDocument();
  });

  it("garbage in storage is ignored", async () => {
    localStorage.setItem("bytesize.searchSources.1", "{nope");
    open();
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet);
    await within(sheet).findByText("OFF peanut snack");
    expect(pill(sheet, /^FatSecret/)).toHaveAttribute("aria-pressed", "true");
  });

  it("a barcode match shows no pills", async () => {
    open();
    const u = userEvent.setup();
    const sheet = await openSheet(u);
    await search(u, sheet, "0012345678905");
    await within(sheet).findByText("Peanut butter bar");
    expect(within(sheet).queryByRole("group", { name: "Sources" })).toBeNull();
  });
});
