import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useWide } from "./wide";
import { wideScreen } from "./test/wide";

function Show() {
  return <p>{useWide() ? "wide" : "phone"}</p>;
}

describe("useWide", () => {
  it("is the phone layout without matchMedia (jsdom)", () => {
    render(<Show />);
    expect(screen.getByText("phone")).toBeInTheDocument();
  });

  it("follows the window across 1024 px", () => {
    const size = wideScreen();
    render(<Show />);
    expect(screen.getByText("wide")).toBeInTheDocument();
    size.set(false);
    expect(screen.getByText("phone")).toBeInTheDocument();
  });

  it("the test helper only answers the wide query", () => {
    wideScreen();
    expect(window.matchMedia("(min-width: 1024px)").matches).toBe(true);
    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(false);
  });
});
