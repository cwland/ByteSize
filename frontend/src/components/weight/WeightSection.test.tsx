import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeightSection from "./WeightSection";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { sampleWeighIns, weightJson } from "../../test/weightFixtures";

const KG = 0.45359237;

describe("WeightSection (Goals)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T20:00:00Z"));
  });
  afterEach(() => void vi.useRealTimers());

  it("shows start, now, goal, lost so far, the projection and the chart for the last month", async () => {
    const server = fakeServer({ "GET /api/weight": () => weightJson() });
    renderWithSession(<WeightSection onReplan={() => {}} />);
    const section = await screen.findByRole("region", { name: "Weight" });
    expect(await within(section).findByTestId("weight-start")).toHaveTextContent("226 lb");
    expect(within(section).getByTestId("weight-now")).toHaveTextContent("221.4 lb");
    expect(within(section).getByTestId("weight-goal")).toHaveTextContent("180 lb");
    expect(within(section).getByTestId("weight-lost")).toHaveTextContent("3.9 lb");
    expect(within(section).getByText("Losing 1.2 lb a week — goal around Jun 29, 2027")).toBeInTheDocument();
    expect(within(section).getByRole("img", { name: /^Weight from Oct 20 to Nov 17/ })).toBeInTheDocument();
    expect(server.sent[0].path).toBe("/api/weight?from=2026-10-18&to=2026-11-17");
    expect(within(section).getByRole("button", { name: "1 month" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Your weight has changed — check your plan")).not.toBeInTheDocument();
  });

  it.each([
    [{ status: "not_enough" }, "Not enough weigh-ins yet"],
    [{ status: "not_losing", kgPerWeek: -0.2 }, "Not losing right now"],
    [{ status: "reached" }, "You've reached your goal"],
    [{ status: "ok", kgPerWeek: 0.5 }, "Losing 1.1 lb a week"],
    [{ status: "ok", kgPerWeek: 0.01 }, "Losing slowly"],
  ])("projection %o reads %s", async (projection, text) => {
    fakeServer({ "GET /api/weight": () => weightJson({ projection, ...(projection.status === "ok" ? { goalKg: null } : {}) }) });
    renderWithSession(<WeightSection onReplan={() => {}} />);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("a gain reads as gained so far", async () => {
    fakeServer({ "GET /api/weight": () => weightJson({ lostKg: -1.2 * KG }) });
    renderWithSession(<WeightSection onReplan={() => {}} />);
    expect(await screen.findByText("Gained so far")).toBeInTheDocument();
    expect(screen.getByTestId("weight-lost")).toHaveTextContent("1.2 lb");
  });

  it("the re-plan hint shows and opens the plan picker", async () => {
    fakeServer({ "GET /api/weight": () => weightJson({ replanHint: true }) });
    const onReplan = vi.fn();
    renderWithSession(<WeightSection onReplan={onReplan} />);
    expect(await screen.findByText("Your weight has changed — check your plan")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Check your plan" }));
    expect(onReplan).toHaveBeenCalled();
  });

  it("range chips ask for 3 months and for all", async () => {
    const server = fakeServer({ "GET /api/weight": () => weightJson() });
    renderWithSession(<WeightSection onReplan={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "3 months" }));
    await vi.waitFor(() => expect(server.sent.at(-1)!.path).toBe("/api/weight?from=2026-08-18&to=2026-11-17"));
    expect(screen.getByRole("button", { name: "3 months" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "All" }));
    await vi.waitFor(() => expect(server.sent.at(-1)!.path).toBe("/api/weight"));
  });

  it("edits a past weigh-in from the list", async () => {
    const server = fakeServer({
      "GET /api/weight": () => weightJson(),
      "PUT /api/weigh-ins/:day": (b, path) => ({ weighIn: { day: path.split("/").pop(), weightKg: b.weightKg, note: b.note ?? null } }),
    });
    renderWithSession(<WeightSection onReplan={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Fri, Nov 13, 222.4 lb" }));
    const sheet = screen.getByRole("dialog", { name: "Edit weigh-in" });
    expect(within(sheet).getByLabelText("Date")).toHaveValue("2026-11-13");
    expect(within(sheet).getByLabelText("Date")).toBeDisabled();
    const input = within(sheet).getByLabelText("Weight (lb)");
    expect(input).toHaveValue(222.4);
    await user.clear(input);
    await user.type(input, "222");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    const put = server.writes()[0];
    expect(put.path).toBe("/api/weigh-ins/2026-11-13");
    expect(put.body.weightKg).toBeCloseTo(222 * KG, 9);
    // the list reloads after the save
    await vi.waitFor(() => expect(server.sent.filter((s) => s.method === "GET")).toHaveLength(2));
  });

  it("saving an untouched weight keeps the exact stored kg", async () => {
    const server = fakeServer({
      "GET /api/weight": () => weightJson(),
      "PUT /api/weigh-ins/:day": (b, path) => ({ weighIn: { day: path.split("/").pop(), weightKg: b.weightKg, note: b.note ?? null } }),
    });
    renderWithSession(<WeightSection onReplan={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Fri, Nov 13, 222.4 lb" }));
    await user.type(screen.getByLabelText("Note (optional)"), "late");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes()[0].body).toEqual({ weightKg: sampleWeighIns[5].weightKg, note: "late" });
  });

  it("deletes a weigh-in after confirming, via a dot on the chart", async () => {
    const server = fakeServer({
      "GET /api/weight": () => weightJson(),
      "DELETE /api/weigh-ins/:day": () => ({ status: 204 }),
    });
    const { container } = renderWithSession(<WeightSection onReplan={() => {}} />);
    const user = userEvent.setup();
    await screen.findByRole("img", { name: /^Weight from/ });
    await user.click(container.querySelectorAll("[data-testid=weigh-in-dot]")[1]);
    const sheet = screen.getByRole("dialog", { name: "Edit weigh-in" });
    expect(within(sheet).getByLabelText("Date")).toHaveValue("2026-10-25");
    await user.click(within(sheet).getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Delete this weigh-in?" })).getByRole("button", { name: "Delete" }));
    expect(server.writes()[0]).toMatchObject({ method: "DELETE", path: "/api/weigh-ins/2026-10-25" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("lists the latest 7 weigh-ins, with Show all for the rest", async () => {
    const more = [
      { day: "2026-10-18", weightKg: 227 * KG, trendKg: 227 * KG, note: null },
      { day: "2026-10-19", weightKg: 226.4 * KG, trendKg: 226.8 * KG, note: null },
      ...sampleWeighIns,
    ];
    fakeServer({ "GET /api/weight": () => weightJson({ weighIns: more }) });
    renderWithSession(<WeightSection onReplan={() => {}} />);
    const list = await screen.findByRole("list", { name: "Weigh-ins" });
    const rows = within(list).getAllByRole("button");
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveAccessibleName("Edit Tue, Nov 17, 221.4 lb");
    await userEvent.setup().click(screen.getByRole("button", { name: "Show all (9)" }));
    expect(within(list).getAllByRole("button")).toHaveLength(9);
    expect(within(list).getByRole("button", { name: "Edit Sun, Oct 18, 227 lb" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("no weigh-ins in the range shows a short empty state", async () => {
    fakeServer({ "GET /api/weight": () => weightJson({ weighIns: [] }) });
    renderWithSession(<WeightSection onReplan={() => {}} />);
    expect(await screen.findByText("No weigh-ins in this range")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
