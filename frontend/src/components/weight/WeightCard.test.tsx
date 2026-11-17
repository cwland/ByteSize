import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeightCard from "./WeightCard";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { emptyWeightJson, weightJson } from "../../test/weightFixtures";

const KG = 0.45359237;

describe("WeightCard", () => {
  afterEach(() => void vi.useRealTimers());

  it("shows the latest weight and trend in lb for imperial", async () => {
    fakeServer({ "GET /api/weight": () => weightJson() });
    renderWithSession(<WeightCard />);
    const card = await screen.findByRole("region", { name: "Weight" });
    expect(await within(card).findByText("221.4 lb")).toBeInTheDocument();
    expect(within(card).getByText("Trend 222.1 lb")).toBeInTheDocument();
    expect(within(card).getByText("3.9 lb lost so far")).toBeInTheDocument();
  });

  it("shows kg for metric", async () => {
    fakeServer({ "GET /api/weight": () => weightJson() });
    renderWithSession(<WeightCard />, { units: "metric" });
    expect(await screen.findByText("100.4 kg")).toBeInTheDocument();
  });

  it("with no weigh-ins invites the first", async () => {
    fakeServer({ "GET /api/weight": () => emptyWeightJson });
    renderWithSession(<WeightCard />);
    expect(await screen.findByText("No weigh-ins yet")).toBeInTheDocument();
  });

  it("Weigh in opens the sheet and saving sends kg for today, then the card reloads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T03:00:00Z")); // still Nov 17 in Boise
    let latest = 221.4 * KG;
    const server = fakeServer({
      "GET /api/weight": () => weightJson({ weighIns: [], latest: { day: "2026-11-16", weightKg: latest } }),
      "PUT /api/weigh-ins/:day": (b, path) => {
        latest = b.weightKg;
        return { weighIn: { day: path.split("/").pop(), weightKg: b.weightKg, note: b.note ?? null } };
      },
    });
    renderWithSession(<WeightCard />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Weigh in" }));
    const sheet = screen.getByRole("dialog", { name: "Weigh in" });
    expect(within(sheet).getByLabelText("Date")).toHaveValue("2026-11-17");
    await user.type(within(sheet).getByLabelText("Weight (lb)"), "220.6");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));

    const put = server.writes().find((w) => w.method === "PUT")!;
    expect(put.path).toBe("/api/weigh-ins/2026-11-17");
    expect(put.body.weightKg).toBeCloseTo(220.6 * KG, 9);
    expect(put.body.note).toBeNull();
    expect(await screen.findByText("220.6 lb")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("metric weigh-ins are sent as typed, and a weight out of range is caught before sending", async () => {
    const server = fakeServer({
      "GET /api/weight": () => weightJson({ weighIns: [] }),
      "PUT /api/weigh-ins/:day": (b, path) => ({ weighIn: { day: path.split("/").pop(), weightKg: b.weightKg, note: null } }),
    });
    renderWithSession(<WeightCard />, { units: "metric" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Weigh in" }));
    const input = screen.getByLabelText("Weight (kg)");
    await user.type(input, "5");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a weight between 30 and 350 kg");
    expect(server.writes()).toHaveLength(0);
    await user.clear(input);
    await user.type(input, "100.2");
    await user.type(screen.getByLabelText("Note (optional)"), "after travel");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes()[0].body).toEqual({ weightKg: 100.2, note: "after travel" });
  });
});
