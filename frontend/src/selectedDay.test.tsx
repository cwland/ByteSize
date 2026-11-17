import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SelectedDayProvider, useSelectedDay } from "./selectedDay";

function Probe() {
  const s = useSelectedDay();
  return (
    <div>
      <p data-testid="day">{s.day}</p>
      <p data-testid="is-today">{String(s.isToday)}</p>
      <button type="button" onClick={s.prev}>
        Back
      </button>
    </div>
  );
}

const show = () =>
  render(
    <SelectedDayProvider timeZone="America/Denver">
      <Probe />
    </SelectedDayProvider>,
  );
const comeBack = () => act(() => void document.dispatchEvent(new Event("visibilitychange")));

describe("selected day across midnight", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T06:50:00Z")); // 11:50 pm Mon, Nov 16 in Denver
  });
  afterEach(() => vi.useRealTimers());

  it("an app left open on today moves to the new today after midnight", () => {
    show();
    expect(screen.getByTestId("day")).toHaveTextContent("2026-11-16");
    vi.setSystemTime(new Date("2026-11-17T07:10:00Z")); // 12:10 am Tue, Nov 17
    comeBack();
    expect(screen.getByTestId("day")).toHaveTextContent("2026-11-17");
    expect(screen.getByTestId("is-today")).toHaveTextContent("true");
  });

  it("a day picked on purpose stays put, but is no longer called today", () => {
    show();
    act(() => screen.getByRole("button", { name: "Back" }).click()); // Nov 15
    vi.setSystemTime(new Date("2026-11-17T07:10:00Z"));
    comeBack();
    expect(screen.getByTestId("day")).toHaveTextContent("2026-11-15");
    expect(screen.getByTestId("is-today")).toHaveTextContent("false");
  });
});
