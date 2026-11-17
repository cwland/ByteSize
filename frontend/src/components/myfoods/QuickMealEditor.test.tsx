import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuickMealEditor from "./QuickMealEditor";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { banana, breakfastDetail, breakfastMeal, chili, yogurt } from "../../test/myFoodsFixtures";

const search = (_b: unknown, path: string) => {
  const q = decodeURIComponent(path.split("q=")[1] ?? "").toLowerCase();
  const hits = [yogurt, banana, chili, breakfastMeal].filter((f) => f.name.toLowerCase().includes(q));
  return { groups: hits.length ? [{ source: "mine", label: "My foods", foods: hits }] : [], errors: [] };
};
const total = (label: string) => within(screen.getByRole("region", { name: "Total" })).getByText(label, { exact: true }).parentElement!;

async function addItem(user: ReturnType<typeof userEvent.setup>, query: string, name: RegExp) {
  await user.click(screen.getByRole("button", { name: "Add food" }));
  const sheet = screen.getByRole("dialog", { name: "Add food" });
  await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), query);
  await user.click(await within(sheet).findByRole("button", { name }));
  await user.click(within(sheet).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add food" })).toBeNull());
}

describe("Quick meal editor", () => {
  it("new quick meal: add items, live total, Save posts name and items", async () => {
    const server = fakeServer({
      "GET /api/foods/search": search,
      "POST /api/my-foods/meals": (b) => ({ food: { ...breakfastDetail, name: b.name } }),
    });
    const done = vi.fn();
    renderWithSession(<QuickMealEditor onDone={done} onBack={() => {}} />);
    const user = userEvent.setup();
    expect(screen.getByRole("heading", { level: 1, name: "New quick meal" })).toBeInTheDocument();
    expect(total("Calories")).toHaveTextContent("—");
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Usual breakfast");
    await addItem(user, "yogurt", /^Greek yogurt/);
    await addItem(user, "banana", /^Banana/);
    expect(total("Calories")).toHaveTextContent("325");
    expect(total("Protein")).toHaveTextContent("21.3 g");

    // A quick meal can't hold another quick meal; a recipe is fine
    await user.click(screen.getByRole("button", { name: "Add food" }));
    const sheet = screen.getByRole("dialog", { name: "Add food" });
    const box = within(sheet).getByRole("searchbox", { name: "Search foods" });
    await user.type(box, "usual");
    expect(await within(sheet).findByText(/No foods found/)).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /^Usual breakfast/ })).toBeNull();
    await user.clear(box);
    await user.type(box, "chili");
    expect(await within(sheet).findByRole("button", { name: /^Chili.*Recipe/ })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Save meal" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(server.writes().map((w) => [w.method, w.path, w.body])).toEqual([
      [
        "POST",
        "/api/my-foods/meals",
        {
          name: "Usual breakfast",
          items: [
            { food: { kind: "cache", id: 20 }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 },
            { food: { kind: "cache", id: 21 }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 },
          ],
        },
      ],
    ]);
  });

  it("edit: opens the saved meal, change an amount, Save puts it", async () => {
    const server = fakeServer({
      "GET /api/my-foods/:id": () => ({ food: breakfastDetail }),
      "PUT /api/my-foods/meals/:id": (b) => ({ food: { ...breakfastDetail, ...b } }),
    });
    const done = vi.fn();
    renderWithSession(<QuickMealEditor id={31} onDone={done} onBack={() => {}} />);
    const user = userEvent.setup();
    expect(screen.getByRole("heading", { level: 1, name: "Edit quick meal" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("Usual breakfast");
    const items = screen.getByRole("list", { name: "Foods in this meal" });
    await user.click(within(items).getByRole("button", { name: "1 medium" }));
    await user.selectOptions(within(items).getByRole("combobox", { name: "Whole number" }), "2");
    expect(total("Calories")).toHaveTextContent("430");
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(server.writes()[0].path).toBe("/api/my-foods/meals/31");
    expect(server.writes()[0].method).toBe("PUT");
    expect(server.writes()[0].body.items[1]).toEqual({ food: { kind: "cache", id: 21 }, servingIndex: 0, unit: "serving", quantity: 2, fraction: 1 });
  });
});
