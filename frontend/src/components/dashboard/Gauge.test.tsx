import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Gauge from "./Gauge";

describe("Gauge", () => {
  it("a treat paid by the bank doesn't push a day that's in range below it: the minimum counts all the food (§40b)", () => {
    // 1,600 eaten, 400 of it a treat paid from the bank, range 1,400–2,000: in range, so no "to reach your range"
    render(<Gauge food={1600} min={1400} max={2000} bankPaid={400} />);
    expect(screen.queryByText(/to reach your range/)).not.toBeInTheDocument();
    expect(screen.getByTestId("gauge-centre")).toHaveAttribute("data-state", "left");
  });

  it("still says how far there is to go when all the food is under the minimum", () => {
    render(<Gauge food={1000} min={1400} max={2000} />);
    expect(screen.getByText("400 to reach your range")).toBeInTheDocument();
  });
});
