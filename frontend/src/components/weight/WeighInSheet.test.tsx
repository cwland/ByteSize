import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeighInSheet from "./WeighInSheet";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { sampleWeighIns, weightJson } from "../../test/weightFixtures";

const KG = 0.45359237;

// The server answers a one-day window with that day's weigh-in, if any
function server() {
  return fakeServer({
    "GET /api/weight": (_b, path) => {
      const day = new URLSearchParams(path.split("?")[1]).get("from");
      return weightJson({ weighIns: sampleWeighIns.filter((w) => w.day === day).map((w) => (w.day === "2026-11-13" ? { ...w, note: "late" } : w)) });
    },
    "PUT /api/weigh-ins/:day": (b, path) => ({ weighIn: { day: path.split("/").pop(), weightKg: b.weightKg, note: b.note ?? null } }),
  });
}

describe("WeighInSheet", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T20:00:00Z")); // Nov 16 in Denver: no weigh-in that day
  });
  afterEach(() => void vi.useRealTimers());

  it.each([
    ["imperial", "Weight (lb)", "66.1", "66.2", "Enter a weight between 66.2 and 771.6 lb"],
    ["imperial", "Weight (lb)", "771.7", "771.6", "Enter a weight between 66.2 and 771.6 lb"],
    ["metric", "Weight (kg)", "29.9", "30", "Enter a weight between 30 and 350 kg"],
    ["metric", "Weight (kg)", "350.1", "350", "Enter a weight between 30 and 350 kg"],
  ] as const)("%s: %s %s is refused, %s is sent", async (units, label, bad, good, message) => {
    const s = server();
    renderWithSession(<WeighInSheet onClose={() => {}} />, { units });
    const user = userEvent.setup();
    const input = screen.getByLabelText(label);
    await user.type(input, bad);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(s.writes()).toHaveLength(0);
    await user.clear(input);
    await user.type(input, good);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(s.writes()).toHaveLength(1));
    expect(s.writes()[0].body.weightKg).toBeCloseTo(units === "metric" ? Number(good) : Number(good) * KG, 9);
  });

  it("a day that already has a weigh-in prefills its weight and note, and saving it untouched keeps it", async () => {
    const s = server();
    renderWithSession(<WeighInSheet onClose={() => {}} />);
    const weight = screen.getByLabelText("Weight (lb)");
    expect(weight).toHaveValue(null);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-13" } });
    await vi.waitFor(() => expect(weight).toHaveValue(222.4));
    expect(screen.getByLabelText("Note (optional)")).toHaveValue("late");
    expect(screen.getByText("You already weighed in that day — saving replaces it")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(s.writes()).toHaveLength(1));
    expect(s.writes()[0]).toMatchObject({ path: "/api/weigh-ins/2026-11-13", body: { weightKg: sampleWeighIns[5].weightKg, note: "late" } });
  });

  it("a weight already typed is not overwritten by a prefill", async () => {
    server();
    renderWithSession(<WeighInSheet onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Weight (lb)"), "219");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-13" } });
    expect(await screen.findByText("You already weighed in that day — saving replaces it")).toBeInTheDocument();
    expect(screen.getByLabelText("Weight (lb)")).toHaveValue(219);
  });
});
