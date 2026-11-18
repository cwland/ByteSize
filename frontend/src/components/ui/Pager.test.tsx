import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pager, pageList } from "./Pager";

describe("pageList", () => {
  it("shows every page when there are few", () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageList(3, 7)).toEqual([1, 2, 3, 4, "…", 7]);
  });
  it("always keeps the first and last, with an ellipsis where pages are left out", () => {
    expect(pageList(1, 14)).toEqual([1, 2, "…", 14]);
    expect(pageList(2, 14)).toEqual([1, 2, 3, "…", 14]);
    expect(pageList(7, 14)).toEqual([1, "…", 6, 7, 8, "…", 14]);
    expect(pageList(13, 14)).toEqual([1, "…", 12, 13, 14]);
    expect(pageList(14, 14)).toEqual([1, "…", 13, 14]);
  });
  it("never uses an ellipsis for a single missing page", () => {
    expect(pageList(4, 9)).toEqual([1, 2, 3, 4, 5, "…", 9]);
    expect(pageList(6, 9)).toEqual([1, "…", 5, 6, 7, 8, 9]);
  });
});

describe("Pager", () => {
  it("‹ 1 2 3 … › with the current page marked and ‹ › disabled at the ends", async () => {
    const onPage = vi.fn();
    const { rerender } = render(<Pager page={1} pages={14} onPage={onPage} />);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Page 2" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("…")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenLastCalledWith(2);
    await userEvent.click(screen.getByRole("button", { name: "Page 14" }));
    expect(onPage).toHaveBeenLastCalledWith(14);
    rerender(<Pager page={14} pages={14} onPage={onPage} />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPage).toHaveBeenLastCalledWith(13);
  });
});
