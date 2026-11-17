import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SitePicker from "./SitePicker";

describe("SitePicker", () => {
  it("shows the six sites in plain words, marks the last used and the chosen one", async () => {
    const onChange = vi.fn();
    render(<SitePicker value="thigh_left" last="abdomen_right" onChange={onChange} />);
    const group = screen.getByRole("radiogroup", { name: "Injection site" });
    const sites = within(group).getAllByRole("radio");
    expect(sites.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Belly, left",
      "Belly, right",
      "Thigh, left",
      "Thigh, right",
      "Arm, left",
      "Arm, right",
    ]);
    expect(within(group).getByRole("radio", { name: "Thigh, left" })).toHaveAttribute("aria-checked", "true");
    expect(sites.filter((s) => s.getAttribute("aria-checked") === "true")).toHaveLength(1);
    // Last used is marked in words, on that site only
    expect(within(group).getByRole("radio", { name: "Belly, right" })).toHaveTextContent("Last used");
    expect(within(group).getAllByText("Last used")).toHaveLength(1);
    await userEvent.setup().click(within(group).getByRole("radio", { name: "Arm, right" }));
    expect(onChange).toHaveBeenCalledWith("arm_right");
  });

  it("with no shot yet marks nothing as last used", () => {
    render(<SitePicker value="abdomen_left" last={null} onChange={() => {}} />);
    expect(screen.queryByText("Last used")).not.toBeInTheDocument();
  });
});
