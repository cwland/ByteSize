import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import FoodRow, { ADDED_MS } from "./FoodRow";

describe("FoodRow quick add", () => {
  it("shows ✓ after adding even under React's StrictMode (npm run dev double-mounts)", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <ul>
          <FoodRow name="Banana" icon="🍌" amount="1 medium" nutrients={{ calories: 105 }} onOpen={() => {}} onQuickAdd={async () => {}} />
        </ul>
      </StrictMode>,
    );
    await user.click(screen.getByRole("button", { name: "Quick add Banana" }));
    expect(await screen.findByRole("img", { name: "Added" })).toBeInTheDocument();
  });

  it("the ✓ stays about two seconds", () => {
    expect(ADDED_MS).toBe(2000);
  });
});
