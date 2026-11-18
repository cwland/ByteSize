import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";
import { Confirm } from "./Confirm";

// A sheet with a text box, open until onClose
function Harness() {
  const [open, setOpen] = useState(true);
  return open ? (
    <Sheet label="New food" onClose={() => setOpen(false)}>
      <input aria-label="Name" />
    </Sheet>
  ) : (
    <p>closed</p>
  );
}

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

  it("a tap outside it (on the dimmed backdrop) leaves it open with what was typed; the X closes it", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Banana bread");
    await user.click(screen.getByRole("dialog").parentElement!);
    expect(screen.getByRole("dialog", { name: "New food" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Banana bread");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("closed")).toBeInTheDocument();
  });

  it("Escape closes it", async () => {
    render(<Harness />);
    await userEvent.setup().keyboard("{Escape}");
    expect(screen.getByText("closed")).toBeInTheDocument();
  });

  it("an are-you-sure doesn't go away on a tap outside it either", async () => {
    const onCancel = vi.fn();
    render(<Confirm title="Delete entry?" confirmLabel="Delete" onConfirm={vi.fn()} onCancel={onCancel} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("alertdialog").parentElement!);
    expect(onCancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
