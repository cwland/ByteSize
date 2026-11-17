import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeightChart from "./WeightChart";
import { sampleWeighIns } from "../../test/weightFixtures";

const goalKg = 180 * 0.45359237;

describe("WeightChart", () => {
  it("draws weigh-in dots, a trend path, a goal line and a text summary in lb", () => {
    const { container } = render(<WeightChart weighIns={sampleWeighIns} goalKg={goalKg} units="imperial" from="2026-10-20" to="2026-11-17" />);
    const chart = screen.getByRole("img", { name: "Weight from Oct 20 to Nov 17: 226 lb to 221.4 lb, trend 222.1 lb, goal 180 lb" });
    expect(chart).toBeInTheDocument();
    expect(container.querySelectorAll("[data-testid=weigh-in-dot]")).toHaveLength(7);
    expect(container.querySelector("[data-testid=trend-path]")!.getAttribute("d")).toMatch(/^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+){6}$/);
    const goal = container.querySelector("[data-testid=goal-line]")!;
    expect(goal).toHaveAttribute("stroke-dasharray");
    // y labels in lb, a few x dates
    expect(screen.getAllByTestId("y-label").map((l) => l.textContent)).toContain("220");
    expect(screen.getAllByTestId("x-label").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByTestId("x-label")[0]).toHaveTextContent("Oct 20");
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("labels in kg for metric", () => {
    render(<WeightChart weighIns={sampleWeighIns} goalKg={null} units="metric" from="2026-10-20" to="2026-11-17" />);
    expect(screen.getByRole("img", { name: "Weight from Oct 20 to Nov 17: 102.5 kg to 100.4 kg, trend 100.7 kg" })).toBeInTheDocument();
    expect(screen.queryByTestId("goal-line")).not.toBeInTheDocument();
  });

  it("a single weigh-in and an empty range draw without NaN", () => {
    const one = render(<WeightChart weighIns={[sampleWeighIns[0]]} goalKg={null} units="imperial" from="2026-10-20" to="2026-10-20" />);
    expect(screen.getByRole("img", { name: "Weight on Oct 20: 226 lb, trend 226 lb" })).toBeInTheDocument();
    expect(one.container.innerHTML).not.toMatch(/NaN|Infinity/);
    one.unmount();
    const none = render(<WeightChart weighIns={[]} goalKg={goalKg} units="imperial" from="2026-10-20" to="2026-11-17" />);
    expect(screen.getByRole("img", { name: "No weigh-ins from Oct 20 to Nov 17, goal 180 lb" })).toBeInTheDocument();
    expect(none.container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("draws labelled markers inside the range", () => {
    const { container } = render(
      <WeightChart
        weighIns={sampleWeighIns}
        goalKg={goalKg}
        units="imperial"
        from="2026-10-20"
        to="2026-11-17"
        markers={[
          { day: "2026-11-01", label: "5 mg" },
          { day: "2026-09-01", label: "2.5 mg" },
        ]}
      />,
    );
    const marks = container.querySelectorAll("[data-testid=marker]");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("5 mg");
  });

  it("tapping a dot selects that weigh-in", async () => {
    const onSelect = vi.fn();
    const { container } = render(<WeightChart weighIns={sampleWeighIns} goalKg={goalKg} units="imperial" from="2026-10-20" to="2026-11-17" onSelect={onSelect} />);
    await userEvent.setup().click(container.querySelectorAll("[data-testid=weigh-in-dot]")[2]);
    expect(onSelect).toHaveBeenCalledWith(sampleWeighIns[2]);
  });
});
