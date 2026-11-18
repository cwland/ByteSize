import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet } from "./Sheet";
import { wideScreen } from "../../test/wide";

describe("Sheet on a wide screen", () => {
  it("is a centred window (about 640 px wide, 85% tall) over a dimmed backdrop", () => {
    wideScreen();
    render(
      <Sheet tall label="Add food to Lunch" onClose={() => {}}>
        <p>Search</p>
      </Sheet>,
    );
    const panel = screen.getByRole("dialog", { name: "Add food to Lunch" });
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel).toHaveClass("lg:max-w-[640px]", "lg:h-[85vh]", "lg:rounded-3xl");
    expect(panel.parentElement).toHaveClass("lg:items-center", "bg-black/60");
  });

  it("Escape and the backdrop close it; a click inside doesn't", async () => {
    wideScreen();
    const onClose = vi.fn();
    render(
      <Sheet label="Edit entry" onClose={onClose}>
        <p>Nutrition facts</p>
      </Sheet>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("Nutrition facts"));
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
