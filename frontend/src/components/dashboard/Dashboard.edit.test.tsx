import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dashboard from "./Dashboard";
import { WIDGETS } from "./widgets";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { wideScreen } from "../../test/wide";
import { culuryOff, dayJson, m3Routes, settingsMe } from "../../test/fixtures";
import { glp1View } from "../../test/glp1Fixtures";
import { weightJson } from "../../test/weightFixtures";

// §28: the Dashboard is widgets in columns, arranged in an edit mode and saved per person
type Layout = { version: number; columns: string[][] } | null;
function show({ layout = null as Layout, wide = true, over = {} as Record<string, (b: any) => unknown> } = {}) {
  if (wide) wideScreen();
  const server = fakeServer({
    ...m3Routes,
    ...culuryOff,
    "GET /api/day/:date": () => dayJson({ streak: 2 }),
    "GET /api/settings/me": () => settingsMe,
    "GET /api/weight": () => weightJson(),
    "GET /api/glp1": () => glp1View(),
    "GET /api/dashboard/layout": () => ({ layout }),
    "PUT /api/dashboard/layout": (b) => ({ layout: b }),
    ...over,
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <Dashboard />
    </SelectedDayProvider>,
    { timezone: "America/Boise" },
  );
  return server;
}
const columns = () => screen.getAllByTestId("dashboard-column");
// The widgets shown in each column (live: their regions; editing: their cards)
const names = (col: HTMLElement) => [...col.querySelectorAll(":scope > section")].map((s) => s.getAttribute("aria-label") ?? document.getElementById(s.getAttribute("aria-labelledby")!)?.textContent?.trim());
const editCards = (col: HTMLElement) => [...col.querySelectorAll("[data-widget]")].map((s) => s.getAttribute("data-widget"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
});
afterEach(() => void vi.useRealTimers());

describe("Dashboard widgets", () => {
  // (That the ids match the server's is checked in backend/tests/widgets-sync.test.ts)
  it("one registry: every widget has a title and a description", () => {
    expect(new Set(WIDGETS.map((w) => w.id)).size).toBe(WIDGETS.length);
    for (const w of WIDGETS) expect(w.title && w.description).toBeTruthy();
  });

  it("default layout (Cory's order): Food; Budget, Water; Day totals, Weight, Next shot, Streak", async () => {
    show();
    await screen.findByRole("region", { name: "Day totals" });
    await screen.findByRole("region", { name: "GLP-1" });
    const [left, middle, right] = columns();
    expect(within(left).getByRole("region", { name: "Today's food" })).toBeInTheDocument();
    expect(names(middle)).toEqual(["Budget", "Water"]);
    expect(names(right)).toEqual(["Day totals", "Weight", "GLP-1", "Streak"]);
  });

  it("shows the person's saved layout", async () => {
    show({ layout: { version: 1, columns: [["streak", "budget"], ["food"], []] } });
    await screen.findByRole("region", { name: "Streak" });
    const cols = columns();
    expect(cols).toHaveLength(2); // an empty column takes no room outside edit mode
    expect(names(cols[0])).toEqual(["Streak", "Budget"]);
    expect(within(cols[1]).getByRole("region", { name: "Today's food" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Water" })).not.toBeInTheDocument();
  });

  it("phones: one column in reading order (left top to bottom, then middle, then right)", async () => {
    show({ wide: false, layout: { version: 1, columns: [["streak"], ["budget"], ["water"]] } });
    await screen.findByRole("region", { name: "Streak" });
    const order = [...document.querySelectorAll("section[aria-label]")].map((s) => s.getAttribute("aria-label"));
    expect(order).toEqual(["Streak", "Budget", "Water"]);
  });

  it("edit mode: widgets become cards with a handle, moves and remove; they don't load while editing; Save stores the layout", async () => {
    const server = show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit dashboard" }));
    expect(screen.queryByRole("region", { name: "Budget" })).not.toBeInTheDocument(); // not the live card
    const budget = screen.getByRole("group", { name: "Budget" });
    expect(within(budget).getByText("Calories left in your range, with protein, fiber and water rings")).toBeInTheDocument();
    expect(within(budget).getByRole("button", { name: "Drag Budget" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Next shot" })).getByText("Shows when GLP-1 is on")).toBeInTheDocument();
    const before = server.sent.length;
    await user.click(within(budget).getByRole("button", { name: "Move Budget left" }));
    await user.click(within(screen.getByRole("group", { name: "Streak" })).getByRole("button", { name: "Move Streak up" }));
    expect(editCards(columns()[0])).toEqual(["budget", "food"]); // beside it, at the same height
    expect(editCards(columns()[2])).toEqual(["day-totals", "weight", "streak", "next-shot"]);
    expect(server.sent.slice(before).filter((s) => s.method === "GET")).toEqual([]); // nothing fetched while editing
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes()).toEqual([expect.objectContaining({ method: "PUT", path: "/api/dashboard/layout", body: { version: 1, columns: [["budget", "food"], ["water"], ["day-totals", "weight", "streak", "next-shot"]] } })]);
    // back to the live widgets, in the new places
    expect(names(columns()[0])).toEqual(["Budget", "Today's food"]);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("Cancel puts it back; Reset to default restores Cory's order", async () => {
    const server = show({ layout: { version: 1, columns: [["streak"], ["food", "budget"], []] } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit dashboard" }));
    await user.click(screen.getByRole("button", { name: "Move Streak right" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(names(columns()[0])).toEqual(["Streak"]);
    await user.click(screen.getByRole("button", { name: "Edit dashboard" }));
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(columns().map(editCards)).toEqual([["food"], ["budget", "water"], ["day-totals", "weight", "next-shot", "streak"]]);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes()[0].body.columns).toEqual([["food"], ["budget", "water"], ["day-totals", "weight", "next-shot", "streak"]]);
  });

  it("remove a widget, then add it back from the Add widget list (to the bottom of the shortest column)", async () => {
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit dashboard" }));
    await user.click(screen.getByRole("button", { name: "Remove Water" }));
    await user.click(screen.getByRole("button", { name: "Remove Budget" }));
    expect(screen.queryByRole("group", { name: "Water" })).not.toBeInTheDocument();
    expect(editCards(columns()[1])).toEqual([]); // an empty column stays, to drop into
    await user.click(screen.getByRole("button", { name: "Add widget" }));
    const list = screen.getByRole("dialog", { name: "Add widget" });
    expect(within(list).getByText("Add a glass of water in one tap")).toBeInTheDocument();
    expect(within(list).getAllByRole("button", { name: /^Add / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Add Budget", "Add Water"]);
    await user.click(within(list).getByRole("button", { name: "Add Water" }));
    expect(screen.queryByRole("dialog", { name: "Add widget" })).not.toBeInTheDocument();
    expect(editCards(columns()[1])).toEqual(["water"]);
    // every widget placed: the list says so
    await user.click(screen.getByRole("button", { name: "Add widget" }));
    await user.click(within(screen.getByRole("dialog", { name: "Add widget" })).getByRole("button", { name: "Add Budget" }));
    await user.click(screen.getByRole("button", { name: "Add widget" }));
    expect(within(screen.getByRole("dialog", { name: "Add widget" })).getByText("Every widget is on your dashboard")).toBeInTheDocument();
  });

  it("drag a widget by its handle into another column, with a drop line where it will land", async () => {
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit dashboard" }));
    // jsdom has no layout: give the columns and cards places on screen (columns 300 px wide, cards 100 px tall)
    columns().forEach((col, c) => {
      col.getBoundingClientRect = () => ({ left: c * 320, right: c * 320 + 300, top: 0, bottom: 800, width: 300, height: 800, x: c * 320, y: 0, toJSON() {} }) as DOMRect;
      col.querySelectorAll<HTMLElement>("[data-widget]").forEach((card, i) => {
        card.getBoundingClientRect = () => ({ left: c * 320, right: c * 320 + 300, top: i * 116, bottom: i * 116 + 100, width: 300, height: 100, x: c * 320, y: i * 116, toJSON() {} }) as DOMRect;
      });
    });
    const handle = screen.getByRole("button", { name: "Drag Streak" });
    fireEvent.pointerDown(handle, { clientX: 700, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 60, pointerId: 1 }); // the middle column, above Water's middle
    expect(within(columns()[1]).getByTestId("drop-line")).toBeInTheDocument();
    fireEvent.pointerUp(window, { clientX: 400, clientY: 60, pointerId: 1 });
    expect(screen.queryByTestId("drop-line")).not.toBeInTheDocument();
    expect(editCards(columns()[1])).toEqual(["budget", "streak", "water"]);
    expect(editCards(columns()[2])).toEqual(["day-totals", "weight", "next-shot"]);
  });

  it("keyboard focus stays on the moved widget's button after a move across columns, or the nearest sensible one (§37)", async () => {
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit dashboard" }));
    const button = (name: string) => screen.getByRole("button", { name });
    // Water (middle) right: still able to go right? No (the last column): the Move right button turns
    // disabled, so focus goes to the opposite move, Move left
    button("Move Water right").focus();
    await user.keyboard("{Enter}");
    expect(editCards(columns()[2])).toContain("water");
    expect(button("Move Water right")).toBeDisabled();
    expect(button("Move Water left")).toHaveFocus();
    // Water left (from the right column to the middle): Move left is still enabled, so it keeps focus
    await user.keyboard("{Enter}");
    expect(editCards(columns()[1])).toContain("water");
    expect(button("Move Water left")).toHaveFocus();
    // and again into the first column: Move left disabled → Move right
    await user.keyboard("{Enter}");
    expect(editCards(columns()[0])).toContain("water");
    expect(button("Move Water right")).toHaveFocus();
    // a move within a column keeps focus too
    button("Move Streak up").focus();
    await user.keyboard("{Enter}");
    expect(button("Move Streak up")).toHaveFocus();
  });

  it("phones: a move up past the top of a column keeps focus on the moved widget", async () => {
    show({ wide: false });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit dashboard" }));
    screen.getByRole("button", { name: "Move Budget up" }).focus();
    await user.keyboard("{Enter}"); // Budget goes from the middle column to the first: the top, so up is disabled
    expect(screen.getByRole("button", { name: "Move Budget up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Budget down" })).toHaveFocus();
  });

  it("phones: edit mode moves widgets up and down (no left/right) in reading order", async () => {
    const server = show({ wide: false });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit dashboard" }));
    expect(screen.queryByRole("button", { name: "Move Budget left" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move Food up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move Budget up" }));
    const order = [...document.querySelectorAll("[data-widget]")].map((s) => s.getAttribute("data-widget"));
    expect(order).toEqual(["budget", "food", "water", "day-totals", "weight", "next-shot", "streak"]);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes()[0].body.columns).toEqual([["budget", "food"], ["water"], ["day-totals", "weight", "next-shot", "streak"]]);
  });

  it("Edit dashboard waits for the saved layout, so Save never writes an edit of the default over it", async () => {
    let answer!: (v: unknown) => void;
    const server = show({ over: { "GET /api/dashboard/layout": () => new Promise((r) => (answer = r)) } });
    const edit = await screen.findByRole("button", { name: "Edit dashboard" });
    expect(edit).toBeDisabled();
    answer({ layout: { version: 1, columns: [["streak"], ["food"], []] } });
    await waitFor(() => expect(edit).toBeEnabled());
    const user = userEvent.setup();
    await user.click(edit);
    expect(columns().map(editCards)).toEqual([["streak"], ["food"], []]);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes()[0].body.columns).toEqual([["streak"], ["food"], []]);
  });

  it("if the saved layout can't be loaded, editing starts from the default", async () => {
    show({ over: { "GET /api/dashboard/layout": () => ({ status: 500, json: { error: "down" } }) } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit dashboard" })).toBeEnabled());
  });

  it("a failed save says why and stays in edit mode", async () => {
    show({ over: { "PUT /api/dashboard/layout": () => ({ status: 500, json: { error: "Couldn't save" } }) } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit dashboard" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
