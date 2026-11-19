import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import Badges from "./Badges";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

const list = [
  { id: "first_weigh_in", earnedOn: "2026-11-02", seen: true },
  { id: "lost_5", earnedOn: "2026-11-14", seen: false },
  { id: "lost_10", earnedOn: null, seen: false },
  { id: "halfway", earnedOn: null, seen: false },
  { id: "goal_reached", earnedOn: null, seen: false },
  { id: "streak_7", earnedOn: "2025-12-30", seen: true },
  { id: "streak_30", earnedOn: null, seen: false },
  { id: "streak_100", earnedOn: null, seen: false },
  { id: "shots_on_time_4", earnedOn: null, seen: false },
  { id: "goal_met", earnedOn: "2026-11-15", seen: true, count: 3 },
];
const serve = () => fakeServer({ "GET /api/badges": () => ({ badges: list, new: ["lost_5"] }) });
const badge = async (name: string) => within(await screen.findByRole("region", { name: "Badges" })).getByRole("listitem", { name });

describe("Badges", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T18:00:00Z"));
  });
  afterEach(() => void vi.useRealTimers());

  it("shows earned badges with their date and locked ones with what earns them", async () => {
    const server = serve();
    renderWithSession(<Badges />);
    const first = await badge("First weigh-in");
    expect(first).toHaveTextContent("Earned Nov 2");
    expect(first).not.toHaveAttribute("data-locked");
    expect(await badge("5 lb down")).toHaveTextContent("Earned Nov 14");
    expect(await badge("7-day streak")).toHaveTextContent("Earned Dec 30, 2025");

    const ten = await badge("10 lb down");
    expect(ten).toHaveAttribute("data-locked", "true");
    expect(ten).toHaveTextContent("Locked");
    expect(ten).toHaveTextContent("Lose 10 lb from your starting weight");
    expect(await badge("Halfway there")).toHaveTextContent("Get halfway to your goal weight");
    expect(await badge("Goal reached")).toHaveTextContent("Reach your goal weight");
    expect(await badge("30-day streak")).toHaveTextContent("Log food 30 days in a row");
    expect(await badge("100-day streak")).toHaveTextContent("Log food 100 days in a row");
    expect(await badge("4 shots on time")).toHaveTextContent("Take 4 weekly shots on time in a row");
    // Goal met (§40c): earned again with each goal completed — the latest day and how many
    expect(await badge("Goal met")).toHaveTextContent("Earned Nov 15 · 3 goals met");
    // Goals only lists them: the Dashboard celebration is what marks them seen
    expect(server.writes()).toEqual([]);
  });

  it("names the weight-loss badges in kilograms for metric", async () => {
    serve();
    renderWithSession(<Badges />, { units: "metric" });
    expect(await badge("2 kg down")).toHaveTextContent("Earned Nov 14");
    expect(await badge("4.5 kg down")).toHaveTextContent("Lose 4.5 kg from your starting weight");
  });
});
