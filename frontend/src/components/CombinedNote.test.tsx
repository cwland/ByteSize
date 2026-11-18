import { afterEach, describe, expect, it } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CombinedNote, { combinedNote } from "./CombinedNote";
import { announceCombined } from "../combined";
import { Confirm } from "./ui/Confirm";
import FoodHost from "../test/FoodHost";
import { SelectedDayProvider } from "../selectedDay";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { barFood, culuryOff, dayJson, entryJson, restaurantRoutes, settingsMe } from "../test/fixtures";

// §28: the server combines the same food added twice to a meal and says so; the app shows a short note with Undo
const eggWhite = { ...barFood, kind: "user_food", id: 9, name: "Egg white", brand: null, source: "mine", servings: [{ label: "100 g", grams: 100 }] };
const grown = entryJson({ id: 4, name: "Egg white", unit: "g", quantity: 200, servings: eggWhite.servings });
const combined = { id: 31, entry: grown, before: { servingIndex: 0, unit: "g", quantity: 100, fraction: 1 }, added: { servingIndex: 0, unit: "g", quantity: 100, fraction: 1 }, splitTo: { day: "2026-11-16", meal: "breakfast" } };

afterEach(() => {
  combinedNote.showMs = 10000;
});

function open(routes: Record<string, (b: any, path: string) => unknown> = {}) {
  const server = fakeServer({
    ...culuryOff,
    ...restaurantRoutes,
    "GET /api/day/:date": () => dayJson({ entries: [entryJson({ id: 4, name: "Egg white", unit: "g", quantity: 100, servings: eggWhite.servings }), entryJson({ id: 5, meal: "lunch", name: "Egg white", unit: "g", quantity: 50, servings: eggWhite.servings })] }),
    "GET /api/settings/me": () => settingsMe,
    "GET /api/foods/recent": () => ({ foods: [{ ...eggWhite, last: { servingIndex: 0, unit: "g", quantity: 100, fraction: 1 } }] }),
    "POST /api/log": () => ({ entry: grown, combined }),
    "POST /api/log/combines/:id/undo": () => ({ entries: [] }),
    ...routes,
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <FoodHost />
      <CombinedNote />
    </SelectedDayProvider>,
    { units: "metric" },
  );
  return server;
}

describe("adding the same food again", () => {
  it("says it was added to the one already there, and Undo splits it back", async () => {
    const server = open();
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole("region", { name: "Breakfast" })).getByRole("button", { name: "Add Food" }));
    const sheet = screen.getByRole("dialog", { name: "Add food to Breakfast" });
    await user.click(await within(sheet).findByRole("button", { name: "Quick add Egg white" }));
    const note = await screen.findByRole("status", { name: "Combined" });
    expect(note).toHaveTextContent("Added to the Egg white already in Breakfast (now 200 g)");
    await user.click(within(note).getByRole("button", { name: "Undo" }));
    // The server splits back what it recorded: only which combine is sent
    await waitFor(() => expect(server.writes().map((w) => w.path)).toContain("/api/log/combines/31/undo"));
    expect(server.writes().find((w) => w.path === "/api/log/combines/31/undo")!.body).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("status", { name: "Combined" })).not.toBeInTheDocument());
  });

  it("moving into a meal that has the food says so too; several combined are undone last first", async () => {
    const second = { ...combined, id: 32, entry: { ...grown, id: 6, name: "Toast", unit: "serving", quantity: 2, servings: [{ label: "1 slice", grams: 30 }] } };
    const server = open({ "POST /api/log/move": () => ({ entries: [grown], combined: [combined, second] }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Egg white.*50 g/ }));
    await user.click(screen.getByRole("button", { name: "Move to another meal or day" }));
    const sheet = screen.getByRole("dialog", { name: "Move to…" });
    await user.click(within(sheet).getByRole("radio", { name: "Breakfast" }));
    await user.click(within(sheet).getByRole("button", { name: "Move here" }));
    const note = await screen.findByRole("status", { name: "Combined" });
    expect(note).toHaveTextContent("Added to 2 foods already there");
    await user.click(within(note).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.writes().filter((w) => w.path.endsWith("/undo")).map((w) => w.path)).toEqual(["/api/log/combines/32/undo", "/api/log/combines/31/undo"]));
  });

  it("Undo runs once: a double tap while it works doesn't split twice", async () => {
    let finish!: () => void;
    const server = open({ "POST /api/log/combines/:id/undo": () => new Promise((r) => (finish = () => r({ entries: [] }))) });
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole("region", { name: "Breakfast" })).getByRole("button", { name: "Add Food" }));
    await user.click(await within(screen.getByRole("dialog")).findByRole("button", { name: "Quick add Egg white" }));
    const note = await screen.findByRole("status", { name: "Combined" });
    const undo = within(note).getByRole("button", { name: "Undo" });
    expect(undo).toHaveClass("min-h-11");
    expect(within(note).getByRole("button", { name: "Dismiss" })).toHaveClass("size-11");
    await user.dblClick(undo);
    expect(undo).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.queryByRole("status", { name: "Combined" })).not.toBeInTheDocument());
    expect(server.writes().filter((w) => w.path.endsWith("/undo"))).toHaveLength(1);
  });

  it("after a failed Undo only what's left is tried again (a split that worked isn't repeated)", async () => {
    const second = { ...combined, id: 32, entry: { ...grown, id: 6, name: "Toast" } };
    let fail = true;
    const server = open({
      "POST /api/log/move": () => ({ entries: [grown], combined: [combined, second] }),
      "POST /api/log/combines/:id/undo": (_b, path) => (path.includes("/31/") && fail ? { status: 500, json: { error: "Something went wrong" } } : { entries: [] }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Egg white.*50 g/ }));
    await user.click(screen.getByRole("button", { name: "Move to another meal or day" }));
    await user.click(within(screen.getByRole("dialog", { name: "Move to…" })).getByRole("radio", { name: "Breakfast" }));
    await user.click(within(screen.getByRole("dialog", { name: "Move to…" })).getByRole("button", { name: "Move here" }));
    const note = await screen.findByRole("status", { name: "Combined" });
    await user.click(within(note).getByRole("button", { name: "Undo" }));
    expect(await within(note).findByText("Something went wrong")).toBeInTheDocument();
    const undos = () => server.writes().filter((w) => w.path.endsWith("/undo")).map((w) => w.path);
    expect(undos()).toEqual(["/api/log/combines/32/undo", "/api/log/combines/31/undo"]);
    fail = false;
    await user.click(within(note).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Combined" })).not.toBeInTheDocument());
    expect(undos()).toEqual(["/api/log/combines/32/undo", "/api/log/combines/31/undo", "/api/log/combines/31/undo"]); // 32 was done: not again
  });

  it("an Undo that became impossible (409) says so, finishes the rest, then goes away on its own", async () => {
    combinedNote.showMs = 400;
    const second = { ...combined, id: 32, entry: { ...grown, id: 6, name: "Toast" } };
    const server = open({
      "POST /api/log/move": () => ({ entries: [grown], combined: [combined, second] }),
      "POST /api/log/combines/:id/undo": (_b, path) => (path.includes("/32/") ? { status: 409, json: { error: "This entry changed since — undo isn't possible" } } : { entries: [] }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Egg white.*50 g/ }));
    await user.click(screen.getByRole("button", { name: "Move to another meal or day" }));
    await user.click(within(screen.getByRole("dialog", { name: "Move to…" })).getByRole("radio", { name: "Breakfast" }));
    await user.click(within(screen.getByRole("dialog", { name: "Move to…" })).getByRole("button", { name: "Move here" }));
    const note = await screen.findByRole("status", { name: "Combined" });
    await user.click(within(note).getByRole("button", { name: "Undo" }));
    expect(await within(note).findByText("This entry changed since — undo isn't possible")).toBeInTheDocument();
    // the other one was still split back; nothing is left to retry
    expect(server.writes().filter((w) => w.path.endsWith("/undo")).map((w) => w.path)).toEqual(["/api/log/combines/32/undo", "/api/log/combines/31/undo"]);
    expect(within(note).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status", { name: "Combined" })).not.toBeInTheDocument(), { timeout: 2000 });
  });

  it("a note that appears while an are-you-sure is open is inside it, where keyboard and screen readers are", async () => {
    renderWithSession(
      <>
        <CombinedNote />
        <Confirm title="Delete entry?" confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />
      </>,
    );
    act(() => announceCombined({ combined }));
    const sure = screen.getByRole("alertdialog", { name: "Delete entry?" });
    const note = await within(sure).findByRole("status", { name: "Combined" });
    expect(within(note).getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("while Add food is still open, the note (and Undo) is inside it, where keyboard and screen readers are", async () => {
    open();
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole("region", { name: "Breakfast" })).getByRole("button", { name: "Add Food" }));
    const sheet = screen.getByRole("dialog", { name: "Add food to Breakfast" });
    await user.click(await within(sheet).findByRole("button", { name: "Quick add Egg white" }));
    const note = await within(sheet).findByRole("status", { name: "Combined" });
    expect(within(note).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    // closing the sheet keeps the note on screen
    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("status", { name: "Combined" })).toBeInTheDocument();
  });

  it("several foods with the same one combined twice read as that one food", async () => {
    const twice = { ...combined, entry: { ...grown, quantity: 300 }, before: { ...combined.before, quantity: 200 } };
    open({ "POST /api/log/move": () => ({ entries: [grown], combined: [combined, twice] }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Egg white.*50 g/ }));
    await user.click(screen.getByRole("button", { name: "Move to another meal or day" }));
    await user.click(within(screen.getByRole("dialog", { name: "Move to…" })).getByRole("radio", { name: "Breakfast" }));
    await user.click(within(screen.getByRole("dialog", { name: "Move to…" })).getByRole("button", { name: "Move here" }));
    expect(await screen.findByRole("status", { name: "Combined" })).toHaveTextContent("Added to the Egg white already in Breakfast (now 300 g)");
  });

  it("no combine, no note", async () => {
    open({ "POST /api/log": () => ({ entry: grown }) });
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole("region", { name: "Breakfast" })).getByRole("button", { name: "Add Food" }));
    await user.click(await within(screen.getByRole("dialog")).findByRole("button", { name: "Quick add Egg white" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Quick add Egg white" })).toBeInTheDocument());
    expect(screen.queryByRole("status", { name: "Combined" })).not.toBeInTheDocument();
  });
});
