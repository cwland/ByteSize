import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import FoodRow from "./FoodRow";
import MealCard from "./MealCard";
import EditEntrySheet from "./EditEntrySheet";
import { fakeServer } from "../../test/fakeServer";
import type { LogEntry } from "../../types";

// Restaurant tags (2026-11-25 §3, Option B): a restaurant's name shows as a teal tag with a fork, in search
// results and the food log; other brands stay plain grey text.
const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  id: 1, day: "2026-11-25", meal: "dinner", name: "Kung Pao Chicken", brand: "Panda Express", icon: "🍗", imageUrl: null,
  servingIndex: 0, unit: "serving", quantity: 2, fraction: 1, servings: [{ label: "1 serving", grams: 160 }],
  nutrients: { calories: 640 }, aiEstimated: false, source: "cache", sourceRef: "cache:5", restaurant: true, ...over,
});
const meal = (entries: LogEntry[]) => (
  <MealCard meal="dinner" entries={entries} totals={{ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 } as never} units="imperial"
    selecting={false} selected={new Set()} onAdd={() => {}} onOpen={() => {}} onToggle={() => {}} onLongPress={() => {}} />
);

describe("restaurant tag", () => {
  it("a search result from a restaurant shows its name as a tag", () => {
    render(<ul><FoodRow name="Kung Pao Chicken" icon="🍗" amount="1 serving" brand="Panda Express" restaurant nutrients={{ calories: 290 }} onOpen={() => {}} onQuickAdd={async () => {}} /></ul>);
    const tag = screen.getByTitle("Restaurant: Panda Express");
    expect(tag).toHaveTextContent("Panda Express");
  });

  it("a grocery brand stays plain text", () => {
    render(<ul><FoodRow name="Kung Pao Bowl" icon="🥡" amount="1 cup" brand="Trader Joe's" restaurant={false} nutrients={{ calories: 280 }} onOpen={() => {}} onQuickAdd={async () => {}} /></ul>);
    expect(screen.queryByTitle(/^Restaurant:/)).toBeNull();
    expect(screen.getByText(/Trader Joe's/)).toBeInTheDocument();
  });

  it("food log rows show the brand: a tag for a restaurant, plain for others", () => {
    render(meal([entry(), entry({ id: 2, name: "Light Sour Cream", brand: "Daisy", restaurant: false }), entry({ id: 3, name: "Cucumber Salad", brand: null, restaurant: false })]));
    expect(screen.getByTitle("Restaurant: Panda Express")).toBeInTheDocument();
    expect(screen.getByText(/Daisy/)).toBeInTheDocument();
    expect(screen.getAllByTitle(/^Restaurant:/)).toHaveLength(1);
  });
});

describe("marking a brand from Edit entry", () => {
  it("offers 'Treat … as a restaurant' for a plain brand and saves it", async () => {
    const server = fakeServer({ "PUT /api/restaurant-brands": (b) => ({ ...b, key: "joes diner" }) });
    render(<EditEntrySheet entry={entry({ name: "Smash Burger", brand: "Joe's Diner", restaurant: false })} onClose={() => {}} onMove={() => {}} onDelete={() => {}} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Treat Joe's Diner as a restaurant" }));
    expect(server.writes().find((w) => w.path === "/api/restaurant-brands")).toMatchObject({ method: "PUT", body: { brand: "Joe's Diner", restaurant: true } });
    expect(await screen.findByText("Joe's Diner is a restaurant")).toBeInTheDocument();
  });

  it("offers 'Not a restaurant' on a restaurant", async () => {
    const server = fakeServer({ "PUT /api/restaurant-brands": (b) => ({ ...b, key: "pf changs" }) });
    render(<EditEntrySheet entry={entry({ name: "Frozen Potstickers", brand: "P.F. Chang's", restaurant: true })} onClose={() => {}} onMove={() => {}} onDelete={() => {}} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "P.F. Chang's is not a restaurant" }));
    expect(server.writes().find((w) => w.path === "/api/restaurant-brands")).toMatchObject({ body: { brand: "P.F. Chang's", restaurant: false } });
  });

  it("no brand, no option", () => {
    render(<EditEntrySheet entry={entry({ brand: null, restaurant: false })} onClose={() => {}} onMove={() => {}} onDelete={() => {}} />);
    expect(screen.queryByRole("button", { name: /restaurant/ })).toBeNull();
  });
});

describe("review fixes", () => {
  it("Edit entry shows the restaurant tag under the food's name", () => {
    render(<EditEntrySheet entry={entry()} onClose={() => {}} onMove={() => {}} onDelete={() => {}} />);
    expect(screen.getByTitle("Restaurant: Panda Express")).toBeInTheDocument();
  });

  it("the light teal reads at 4.5:1 or better on its 15% tint over the lightest backgrounds", () => {
    const css = readFileSync("src/index.css", "utf8") // tests run from frontend/;
    const light = /--color-restaurant:\s*light-dark\((#[0-9a-f]{6})/i.exec(css)![1];
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lum = (c: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    for (const bg of ["#ffffff", "#f4f4f6", "#ececf0"]) {
      const tint = rgb(light).map((v, i) => v * 0.15 + rgb(bg)[i] * 0.85);
      const [a, b] = [lum(rgb(light)), lum(tint)].sort((x, y) => y - x);
      expect((a + 0.05) / (b + 0.05), bg).toBeGreaterThanOrEqual(4.5);
    }
  });
});
