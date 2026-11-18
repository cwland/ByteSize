import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { KeyField } from "./KeyField";

// The browser's clipboard: writeText works, is missing (plain http on a LAN address) or refuses
function clipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", { value: writeText ? { writeText: vi.fn(writeText) } : undefined, configurable: true });
  return navigator.clipboard;
}
// The old way: a hidden textarea and execCommand("copy"); records what was selected when it ran
function execCommand(works: boolean) {
  const copied: string[] = [];
  const fn = vi.fn((cmd: string) => {
    const el = document.activeElement as HTMLTextAreaElement | null;
    if (cmd === "copy" && works && el?.tagName === "TEXTAREA") copied.push(el.value.slice(el.selectionStart, el.selectionEnd));
    return works;
  });
  Object.defineProperty(document, "execCommand", { value: fn, configurable: true });
  return { fn, copied };
}
afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  vi.useRealTimers();
});

function Harness({ saved = true, fetchSaved = vi.fn(async () => "saved-key-123"), start = "" }: { saved?: boolean; fetchSaved?: () => Promise<string>; start?: string }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <KeyField label="USDA API key" keyName="USDA key" value={value} onChange={setValue} saved={saved} fetchSaved={fetchSaved} placeholder={saved ? "Saved — enter a new one to replace it" : "Paste it here"} />
      <output data-testid="typed">{value}</output>
    </>
  );
}

describe("KeyField", () => {
  it("the eye shows what is typed without fetching anything, and hides it again", async () => {
    const fetchSaved = vi.fn(async () => "saved-key-123");
    render(<Harness fetchSaved={fetchSaved} />);
    const input = screen.getByLabelText("USDA API key");
    await userEvent.type(input, "typed-1");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show USDA key" }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("typed-1");
    await userEvent.click(screen.getByRole("button", { name: "Hide USDA key" }));
    expect(input).toHaveAttribute("type", "password");
    expect(fetchSaved).not.toHaveBeenCalled();
  });

  it("the eye on a saved key fetches and shows it; again hides it and goes back to the saved placeholder", async () => {
    const fetchSaved = vi.fn(async () => "saved-key-123");
    render(<Harness fetchSaved={fetchSaved} />);
    const input = screen.getByLabelText("USDA API key");
    expect(input).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Show USDA key" }));
    expect(fetchSaved).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("saved-key-123");
    expect(input).toHaveAttribute("type", "text");
    // shown, not typed: nothing new to save
    expect(screen.getByTestId("typed")).toHaveTextContent("");
    await userEvent.click(screen.getByRole("button", { name: "Hide USDA key" }));
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("placeholder", "Saved — enter a new one to replace it");
    expect(screen.queryByDisplayValue("saved-key-123")).not.toBeInTheDocument();
  });

  it("editing a shown saved key makes it a new key", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Show USDA key" }));
    const input = screen.getByLabelText("USDA API key");
    await screen.findByDisplayValue("saved-key-123");
    await userEvent.type(input, "9");
    expect(screen.getByTestId("typed")).toHaveTextContent("saved-key-1239");
    await userEvent.clear(input);
    expect(input).toHaveValue("");
    expect(screen.getByTestId("typed")).toHaveTextContent("");
  });

  it("with no key saved or typed there's nothing to show or copy", () => {
    render(<Harness saved={false} />);
    expect(screen.getByRole("button", { name: "Show USDA key" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy USDA key" })).toBeDisabled();
  });

  it("a saved key that can't be read says so", async () => {
    render(<Harness fetchSaved={async () => Promise.reject(new Error("This key can't be read. Enter it again."))} />);
    await userEvent.click(screen.getByRole("button", { name: "Show USDA key" }));
    expect(await screen.findByText("This key can't be read. Enter it again.")).toBeInTheDocument();
    expect(screen.getByLabelText("USDA API key")).toHaveAttribute("type", "password");
  });

  it("copy puts the saved key on the clipboard without showing it, and reads Copied for two seconds", async () => {
    const cb = clipboard(async () => {});
    const fetchSaved = vi.fn(async () => "saved-key-123");
    render(<Harness fetchSaved={fetchSaved} />);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy USDA key" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(cb.writeText).toHaveBeenCalledWith("saved-key-123");
    expect(screen.queryByDisplayValue("saved-key-123")).not.toBeInTheDocument();
    expect(screen.getByLabelText("USDA API key")).toHaveAttribute("type", "password");
    await act(async () => vi.advanceTimersByTime(2100));
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("copy uses what is typed when there is something", async () => {
    const cb = clipboard(async () => {});
    const fetchSaved = vi.fn(async () => "saved-key-123");
    render(<Harness fetchSaved={fetchSaved} start="typed-2" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy USDA key" }));
    expect(cb.writeText).toHaveBeenCalledWith("typed-2");
    expect(fetchSaved).not.toHaveBeenCalled();
  });

  it("when the browser refuses the clipboard (plain http), copies the old way", async () => {
    clipboard(async () => Promise.reject(new DOMException("not allowed", "NotAllowedError")));
    const exec = execCommand(true);
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Copy USDA key" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(exec.copied).toEqual(["saved-key-123"]);
    expect(document.querySelector("textarea")).toBeNull(); // the temporary box is gone
  });

  it("with no clipboard API at all, copies the old way", async () => {
    clipboard(undefined);
    const exec = execCommand(true);
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Copy USDA key" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(exec.copied).toEqual(["saved-key-123"]);
  });

  it("when copying is impossible, says how to do it by hand", async () => {
    clipboard(undefined);
    execCommand(false);
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Copy USDA key" }));
    expect(await screen.findByText("Couldn't copy. Show the key and copy it by hand.")).toBeInTheDocument();
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("a shown saved key is dropped when the field goes away", async () => {
    const { unmount } = render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Show USDA key" }));
    await screen.findByDisplayValue("saved-key-123");
    unmount();
    render(<Harness fetchSaved={vi.fn(async () => "other")} />);
    expect(screen.getByLabelText("USDA API key")).toHaveValue("");
    expect(screen.getByLabelText("USDA API key")).toHaveAttribute("type", "password");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
