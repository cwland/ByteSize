import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FoodHost from "../../test/FoodHost";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { culuryOff, dayJson, restaurantRoutes, settingsMe } from "../../test/fixtures";

// Describe it with several foods (2026-11-22 design): One meal (opens first) or Separate items, every food's
// amount changeable, removable, more added; the totals follow and survive the switch.

const ai = (name: string, label: string, grams: number, calories: number, protein_g: number) => ({
  name,
  brand: null,
  icon: "🍽️",
  barcode: null,
  servings: [{ label, grams }],
  nutrients: { calories, protein_g },
  aiFields: ["calories", "protein_g"],
  imageUrl: null,
  override: false,
  source: "ai",
  category: "",
});
const egg = { food: ai("Egg, fried", "1 large egg", 46, 90, 6.3), servingIndex: 0, quantity: 2 };
const muffin = { food: ai("English muffin, light", "1 muffin", 57, 100, 6), servingIndex: 0, quantity: 1 };
const mayo = { food: ai("Mayonnaise, light", "1 tbsp", 15, 35, 0), servingIndex: 0, quantity: 1 };
const sandwich = { items: [egg, muffin, mayo], mealName: "Breakfast sandwich", assumed: false };

function open(estimate: (b: any) => unknown) {
  const server = fakeServer({
    ...culuryOff,
    "GET /api/day/:date": () => dayJson(),
    "GET /api/settings/me": () => settingsMe,
    "GET /api/foods/recent": () => ({ foods: [] }),
    "GET /api/foods/search": () => ({ groups: [], errors: [] }),
    ...restaurantRoutes,
    "POST /api/ai/estimate-items": estimate,
    "POST /api/log/estimates": () => ({ entries: [] }),
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Denver">
      <FoodHost />
    </SelectedDayProvider>,
  );
  return server;
}

async function describeIt(user: ReturnType<typeof userEvent.setup>, text: string) {
  const card = await screen.findByRole("region", { name: "Snacks" });
  await user.click(within(card).getByRole("button", { name: "Add Food" }));
  const sheet = screen.getByRole("dialog", { name: "Add food to Snacks" });
  await user.click(within(sheet).getByRole("button", { name: "Describe it" }));
  await user.type(within(sheet).getByRole("textbox", { name: "Describe the food" }), text);
  await user.click(within(sheet).getByRole("button", { name: "Estimate" }));
  return sheet;
}
const logged = (server: ReturnType<typeof fakeServer>) => server.writes().filter((w) => w.path === "/api/log/estimates").map((w) => w.body);

describe("Describe it: one meal or separate items", () => {
  it("several foods open on One meal: the name, the total and every ingredient; Log sends them as one meal", async () => {
    const server = open(() => sandwich);
    const user = userEvent.setup();
    const sheet = await describeIt(user, "2 fried eggs, 1 lite English muffin, 1 tbsp lite mayo");
    expect(await within(sheet).findByRole("radio", { name: "One meal" })).toBeChecked();
    expect(within(sheet).getByRole("radio", { name: "Separate items" })).not.toBeChecked();
    expect(within(sheet).getByRole("textbox", { name: "Meal name" })).toHaveValue("Breakfast sandwich");
    expect(within(sheet).getByTestId("describe-total")).toHaveTextContent("315");
    for (const n of ["Egg, fried", "English muffin, light", "Mayonnaise, light"]) expect(within(sheet).getByText(n)).toBeInTheDocument();
    expect(within(sheet).getByRole("checkbox", { name: "Save to My foods" })).not.toBeChecked();

    await user.click(within(sheet).getByRole("button", { name: "Log Breakfast sandwich" }));
    await waitFor(() => expect(logged(server)).toHaveLength(1));
    const body = logged(server)[0];
    expect(body).toMatchObject({ meal: "snacks", combine: { name: "Breakfast sandwich", save: false } });
    expect(body.items.map((i: any) => [i.name, i.quantity])).toEqual([["Egg, fried", 2], ["English muffin, light", 1], ["Mayonnaise, light", 1]]);
    expect(body.items[0]).toMatchObject({ servings: [{ label: "1 large egg", grams: 46 }], nutrients: { calories: 90, protein_g: 6.3 }, servingIndex: 0, fraction: 1 });
  });

  it("Separate items: each food its own line with a checkbox; Log sends only the checked ones, one entry each", async () => {
    const server = open(() => sandwich);
    const user = userEvent.setup();
    const sheet = await describeIt(user, "eggs, muffin, mayo");
    await user.click(await within(sheet).findByRole("radio", { name: "Separate items" }));
    expect(within(sheet).queryByRole("textbox", { name: "Meal name" })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("checkbox", { name: "Include Mayonnaise, light" }));
    expect(within(sheet).getByTestId("describe-total")).toHaveTextContent("280");
    await user.click(within(sheet).getByRole("button", { name: "Log 2 items" }));
    await waitFor(() => expect(logged(server)).toHaveLength(1));
    expect(logged(server)[0].combine).toBeUndefined();
    expect(logged(server)[0].items.map((i: any) => i.name)).toEqual(["Egg, fried", "English muffin, light"]);
  });

  it("changing an amount or removing a food changes the totals, and the changes stay across the switch", async () => {
    open(() => sandwich);
    const user = userEvent.setup();
    const sheet = await describeIt(user, "eggs, muffin, mayo");
    const eggs = await within(sheet).findByRole("spinbutton", { name: "Amount of Egg, fried" });
    await user.clear(eggs);
    await user.type(eggs, "3");
    expect(within(sheet).getByTestId("describe-total")).toHaveTextContent("405");
    await user.click(within(sheet).getByRole("button", { name: "Remove Mayonnaise, light" }));
    expect(within(sheet).queryByText("Mayonnaise, light")).not.toBeInTheDocument();
    expect(within(sheet).getByTestId("describe-total")).toHaveTextContent("370");
    await user.click(within(sheet).getByRole("radio", { name: "Separate items" }));
    expect(within(sheet).getByRole("spinbutton", { name: "Amount of Egg, fried" })).toHaveValue(3);
    expect(within(sheet).queryByText("Mayonnaise, light")).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("radio", { name: "One meal" }));
    expect(within(sheet).getByTestId("describe-total")).toHaveTextContent("370");
  });

  it("Save to My foods and a new name are sent with the meal", async () => {
    const server = open(() => sandwich);
    const user = userEvent.setup();
    const sheet = await describeIt(user, "eggs, muffin, mayo");
    const name = await within(sheet).findByRole("textbox", { name: "Meal name" });
    await user.clear(name);
    await user.type(name, "My egg muffin");
    await user.click(within(sheet).getByRole("checkbox", { name: "Save to My foods" }));
    await user.click(within(sheet).getByRole("button", { name: "Log My egg muffin" }));
    await waitFor(() => expect(logged(server)).toHaveLength(1));
    expect(logged(server)[0].combine).toEqual({ name: "My egg muffin", save: true });
  });

  it("Add a food asks the AI and adds what it finds to the list", async () => {
    let call = 0;
    const server = open(() => (++call === 1 ? sandwich : { items: [{ food: ai("Coffee, black", "1 cup", 240, 2, 0.3), servingIndex: 0, quantity: 1 }], mealName: null, assumed: false }));
    const user = userEvent.setup();
    const sheet = await describeIt(user, "eggs, muffin, mayo");
    await user.type(await within(sheet).findByRole("textbox", { name: "Add a food" }), "a black coffee");
    await user.click(within(sheet).getByRole("button", { name: "Add" }));
    expect(await within(sheet).findByText("Coffee, black")).toBeInTheDocument();
    expect(within(sheet).getByTestId("describe-total")).toHaveTextContent("317");
    expect(server.sent.filter((s) => s.path === "/api/ai/estimate-items").at(-1)!.body).toEqual({ text: "a black coffee" });
  });

  it("one food at an amount other than 1: its line with the amount, and no switch", async () => {
    open(() => ({ items: [{ ...egg, quantity: 3 }], mealName: null, assumed: false }));
    const user = userEvent.setup();
    const sheet = await describeIt(user, "3 fried eggs");
    expect(await within(sheet).findByRole("spinbutton", { name: "Amount of Egg, fried" })).toHaveValue(3);
    expect(within(sheet).queryByRole("radio", { name: "One meal" })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Log 1 item" })).toBeInTheDocument();
  });
});
