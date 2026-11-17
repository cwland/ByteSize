import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeeklyTrends from "./WeeklyTrends";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

const empty = { calories: null, protein_g: null, fiber_g: null, water_ml: null };
const week = (start: string, end: string, over: object = {}) => ({ start, end, daysLogged: 0, avg: empty, status: empty, weightChangeKg: null, ...over });
const weeks = [
  week("2026-11-15", "2026-11-21", {
    daysLogged: 6,
    avg: { calories: 1850, protein_g: 98.4, fiber_g: 31.2, water_ml: 2366 },
    status: { calories: "in", protein_g: "below", fiber_g: "in", water_ml: "above" },
    weightChangeKg: -0.635,
  }),
  week("2026-11-08", "2026-11-14"),
  week("2026-11-01", "2026-11-07", { daysLogged: 1, avg: { ...empty, calories: 2400 }, status: { ...empty, calories: "above" }, weightChangeKg: 0.272 }),
  week("2026-10-25", "2026-10-31"),
  week("2026-10-18", "2026-10-24"),
  week("2026-10-11", "2026-10-17"),
  week("2026-10-04", "2026-10-10"),
  week("2026-09-27", "2026-10-03", { daysLogged: 2, avg: { ...empty, calories: 1700 }, status: { ...empty, calories: "in" } }),
];
const older = Array.from({ length: 8 }, (_, i) => week(`2026-09-${String(20 - i * 2).padStart(2, "0")}`, "2026-09-26", { daysLogged: i === 0 ? 3 : 0 }));

function serve() {
  return fakeServer({
    "GET /api/trends/weekly": (_b, path) => {
      const n = Number(new URL(path, "http://x").searchParams.get("weeks"));
      return { weeks: [...weeks, ...older].slice(0, n) };
    },
  });
}
const rows = async () => within(await screen.findByRole("region", { name: "Weekly trends" })).getAllByRole("listitem");
const cell = (row: HTMLElement, name: string) => within(row).getByRole("group", { name });

describe("Weekly trends", () => {
  it("shows each week newest first with averages, range marks and weight change in pounds", async () => {
    const server = serve();
    renderWithSession(<WeeklyTrends />);
    const [first, second, third] = await rows();
    expect(server.sent[0].path).toBe("/api/trends/weekly?weeks=8");

    expect(first).toHaveTextContent("Nov 15–21 · 6 days logged");
    expect(cell(first, "Calories")).toHaveTextContent("1,850");
    expect(within(cell(first, "Calories")).getByRole("img", { name: "in range" })).toHaveTextContent("✓");
    expect(cell(first, "Protein")).toHaveTextContent("98 g");
    expect(within(cell(first, "Protein")).getByRole("img", { name: "below range" })).toHaveTextContent("↓");
    expect(cell(first, "Fiber")).toHaveTextContent("31 g");
    expect(cell(first, "Water")).toHaveTextContent("80 fl oz");
    expect(within(cell(first, "Water")).getByRole("img", { name: "above range" })).toHaveTextContent("↑");
    expect(cell(first, "Weight")).toHaveTextContent("−1.4 lb");

    // A week with nothing logged is empty, not zeros
    expect(second).toHaveTextContent("Nov 8–14 · Nothing logged");
    for (const name of ["Calories", "Protein", "Fiber", "Water", "Weight"]) expect(cell(second, name)).toHaveTextContent("—");
    expect(within(second).queryByRole("img")).toBeNull();
    expect(second).not.toHaveTextContent("0");

    expect(third).toHaveTextContent("Nov 1–7 · 1 day logged");
    expect(cell(third, "Protein")).toHaveTextContent("—");
    expect(cell(third, "Weight")).toHaveTextContent("+0.6 lb");
  });

  it("labels a week across two months and shows kilograms and millilitres for metric", async () => {
    serve();
    renderWithSession(<WeeklyTrends />, { units: "metric" });
    const list = await rows();
    expect(cell(list[0], "Weight")).toHaveTextContent("−0.6 kg");
    expect(cell(list[0], "Water")).toHaveTextContent("2,366 ml");
    expect(list[7]).toHaveTextContent("Sep 27–Oct 3 · 2 days logged");
  });

  it("shows 8 weeks, then 8 more with Show more", async () => {
    const server = serve();
    renderWithSession(<WeeklyTrends />);
    expect(await rows()).toHaveLength(8);
    await userEvent.setup().click(screen.getByRole("button", { name: "Show more" }));
    expect(server.sent.at(-1)!.path).toBe("/api/trends/weekly?weeks=16");
    expect(await screen.findByText(/Sep 20–26/)).toBeInTheDocument();
    expect(await rows()).toHaveLength(16);
  });

  it("keeps Show more after 8 empty weeks, so history before a long gap stays reachable", async () => {
    const gap = (n: number) => Array.from({ length: n }, (_, i) => week(`2026-10-${String(1 + i).padStart(2, "0")}`, "2026-10-31"));
    const server = fakeServer({
      "GET /api/trends/weekly": (_b, path) => {
        const n = Number(new URL(path, "http://x").searchParams.get("weeks"));
        return { weeks: n === 8 ? gap(8) : [...gap(8), week("2026-08-02", "2026-08-08", { daysLogged: 4 })] };
      },
    });
    renderWithSession(<WeeklyTrends />);
    expect(await rows()).toHaveLength(8);
    await userEvent.setup().click(screen.getByRole("button", { name: "Show more" }));
    expect(server.sent.at(-1)!.path).toBe("/api/trends/weekly?weeks=16");
    expect(await screen.findByText(/Aug 2–8 · 4 days logged/)).toBeInTheDocument();
    // the server had fewer weeks than asked: that's all of them
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("stops offering Show more at 104 weeks", async () => {
    const all = Array.from({ length: 104 }, (_, i) => week(`2024-${String(1 + (i % 12)).padStart(2, "0")}-01`, "2024-12-31", { daysLogged: 1 }));
    fakeServer({ "GET /api/trends/weekly": (_b, path) => ({ weeks: all.slice(0, Number(new URL(path, "http://x").searchParams.get("weeks"))) }) });
    renderWithSession(<WeeklyTrends />);
    const user = userEvent.setup();
    for (let shown = 8; shown < 104; shown = Math.min(shown + 8, 104)) {
      await user.click(await screen.findByRole("button", { name: "Show more" }));
      await waitFor(async () => expect(await rows()).toHaveLength(Math.min(shown + 8, 104)));
    }
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("clears the error after a later load works", async () => {
    let fail = true;
    fakeServer({
      "GET /api/trends/weekly": (_b, path) => {
        const n = Number(new URL(path, "http://x").searchParams.get("weeks"));
        if (n === 16 && fail) {
          fail = false;
          return { status: 500, json: { error: "Trends are down" } };
        }
        return { weeks: [...weeks, ...older].slice(0, n) };
      },
    });
    renderWithSession(<WeeklyTrends />);
    expect(await rows()).toHaveLength(8);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Trends are down");
    await user.click(screen.getByRole("button", { name: "Show more" })); // try again
    await waitFor(async () => expect(await rows()).toHaveLength(16));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a week whose weight didn't change reads 0 lb, and the weight change is announced once", async () => {
    fakeServer({ "GET /api/trends/weekly": () => ({ weeks: [week("2026-11-15", "2026-11-21", { daysLogged: 3, weightChangeKg: 0 })] }) });
    renderWithSession(<WeeklyTrends />);
    const [row] = await rows();
    const weight = cell(row, "Weight");
    expect(weight).toHaveTextContent(/^0 lb$/); // the group's name says "Weight"; its text doesn't repeat it
  });
});
