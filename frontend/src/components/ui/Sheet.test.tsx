import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  it("scrolls inside, never the rounded panel itself (a scrollbar on the panel squares its right corners)", () => {
    render(
      <Sheet label="Edit entry" onClose={() => {}}>
        <p>Nutrition facts</p>
      </Sheet>,
    );
    const panel = screen.getByRole("dialog", { name: "Edit entry" });
    expect(panel).toHaveClass("overflow-hidden");
    expect(panel).not.toHaveClass("overflow-y-auto");
    const body = screen.getByText("Nutrition facts").parentElement!;
    expect(body).toHaveClass("overflow-y-auto");
    expect(panel).toContainElement(body);
  });
});
