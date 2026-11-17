import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppShell from "./AppShell";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";

describe("AppShell day switcher", () => {
  afterEach(() => void vi.useRealTimers());

  it("starts on today in the user's time zone and steps a day back and forward", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T03:00:00Z")); // still Mon, Nov 16 in Denver
    fakeServer({});
    renderWithSession(<AppShell />, { timezone: "America/Denver" });
    expect(screen.getByRole("button", { name: "Go to today" })).toHaveTextContent("Mon, Nov 16");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.getByRole("button", { name: "Go to today" })).toHaveTextContent("Sun, Nov 15");
    await user.click(screen.getByRole("button", { name: "Next day" }));
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByRole("button", { name: "Go to today" })).toHaveTextContent("Tue, Nov 17");
    await user.click(screen.getByRole("button", { name: "Go to today" }));
    expect(screen.getByRole("button", { name: "Go to today" })).toHaveTextContent("Mon, Nov 16");
  });
});
