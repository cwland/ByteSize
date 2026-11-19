import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dashboard from "./Dashboard";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { wideScreen } from "../../test/wide";
import { culuryOff, dayJson, m3Routes, settingsMe } from "../../test/fixtures";
import { glp1View } from "../../test/glp1Fixtures";
import { weightJson } from "../../test/weightFixtures";

// §46: a move that changes nothing leaves no focus move waiting for some later, unrelated layout change.
// moveSideways is made a no-op on demand (every real move changes the layout; its buttons are disabled at the ends).
const noOp = vi.hoisted(() => ({ next: false }));
vi.mock("./layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("./layout")>();
  return {
    ...real,
    moveSideways: (cols: string[][], id: string, delta: -1 | 1) => {
      if (noOp.next) {
        noOp.next = false;
        return cols;
      }
      return real.moveSideways(cols, id, delta);
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
  wideScreen();
  fakeServer({
    ...m3Routes,
    ...culuryOff,
    "GET /api/day/:date": () => dayJson({ streak: 2 }),
    "GET /api/settings/me": () => settingsMe,
    "GET /api/weight": () => weightJson(),
    "GET /api/glp1": () => glp1View(),
    "GET /api/layouts/dashboard": () => ({ layout: null }),
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <Dashboard />
    </SelectedDayProvider>,
    { timezone: "America/Boise" },
  );
});
afterEach(() => void vi.useRealTimers());

describe("Dashboard edit: focus after a move", () => {
  it("a move that changes nothing doesn't pull focus back on a later, unrelated change", async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit dashboard" }));
    noOp.next = true;
    await user.click(screen.getByRole("button", { name: "Move Water right" })); // nothing moves
    // Later: something else changes the layout, from another button
    const add = screen.getByRole("button", { name: /Add widget/ });
    await user.click(screen.getByRole("button", { name: "Remove Streak" }));
    expect(screen.queryByRole("button", { name: "Remove Streak" })).not.toBeInTheDocument();
    expect(document.activeElement?.getAttribute("aria-label") ?? "").not.toMatch(/^Move Water/);
    // and a real move still keeps focus
    add.focus();
    await user.click(screen.getByRole("button", { name: "Move Water down" }));
    expect(screen.getByRole("button", { name: "Move Water down" })).toHaveFocus();
  });
});
