import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { KeyField } from "./KeyField";
import { FakeClipboardItem, restoreClipboard, stubClipboard, stubClipboardItem } from "../../test/clipboard";

// The browser's clipboard: writeText works, is missing (plain http on a LAN address) or refuses
const clipboard = (writeText: ((text: string) => Promise<void>) | undefined) => stubClipboard(writeText ? { writeText } : undefined)!;
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
  restoreClipboard();
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

  describe("Safari's clipboard (ClipboardItem with a promised key)", () => {
    it("writes in the click itself, before the saved key arrives, and reads Copied", async () => {
      stubClipboardItem();
      let written: FakeClipboardItem[] = [];
      const cb = stubClipboard({ write: async (items) => void (written = items as FakeClipboardItem[]), writeText: async () => {} })!;
      let answer!: (k: string) => void;
      const fetchSaved = vi.fn(() => new Promise<string>((res) => (answer = res)));
      render(<Harness fetchSaved={fetchSaved} />);
      fireEvent.click(screen.getByRole("button", { name: "Copy USDA key" }));
      expect(cb.write).toHaveBeenCalledTimes(1); // synchronously, still inside the click
      expect(fetchSaved).toHaveBeenCalledTimes(1);
      answer("saved-key-123");
      expect(await screen.findByText("Copied")).toBeInTheDocument();
      expect(written).toHaveLength(1);
      expect(written[0]).toBeInstanceOf(FakeClipboardItem);
      expect(await written[0].text()).toBe("saved-key-123");
      expect(cb.writeText).not.toHaveBeenCalled();
      expect(screen.queryByDisplayValue("saved-key-123")).not.toBeInTheDocument();
    });

    it("when that write is refused, falls back to writeText with the fetched key (one fetch)", async () => {
      stubClipboardItem();
      const cb = stubClipboard({ write: async () => Promise.reject(new DOMException("no", "NotAllowedError")), writeText: async () => {} })!;
      const fetchSaved = vi.fn(async () => "saved-key-123");
      render(<Harness fetchSaved={fetchSaved} />);
      await userEvent.click(screen.getByRole("button", { name: "Copy USDA key" }));
      expect(await screen.findByText("Copied")).toBeInTheDocument();
      expect(cb.writeText).toHaveBeenCalledWith("saved-key-123");
      expect(fetchSaved).toHaveBeenCalledTimes(1);
    });

    it("a key that can't be read says so, not Couldn't copy", async () => {
      stubClipboardItem();
      stubClipboard({ write: async (items) => void (await (items[0] as FakeClipboardItem).text()), writeText: async () => {} });
      render(<Harness fetchSaved={async () => Promise.reject(new Error("This key can't be read. Enter it again."))} />);
      await userEvent.click(screen.getByRole("button", { name: "Copy USDA key" }));
      expect(await screen.findByText("This key can't be read. Enter it again.")).toBeInTheDocument();
      expect(screen.queryByText(/Couldn't copy/)).not.toBeInTheDocument();
      expect(screen.queryByText("Copied")).not.toBeInTheDocument();
    });

    it("what is typed is copied with writeText as before", async () => {
      stubClipboardItem();
      const cb = stubClipboard({ write: async () => {}, writeText: async () => {} })!;
      render(<Harness start="typed-3" />);
      await userEvent.click(screen.getByRole("button", { name: "Copy USDA key" }));
      expect(cb.writeText).toHaveBeenCalledWith("typed-3");
      expect(cb.write).not.toHaveBeenCalled();
    });
  });

  it("the label names the box without holding the buttons", () => {
    render(<Harness />);
    const label = screen.getByText("USDA API key", { selector: "label" });
    expect(label.querySelector("button")).toBeNull();
    expect(label).toHaveAttribute("for", screen.getByLabelText("USDA API key").id);
  });

  it("tells the parent while a saved key is shown", async () => {
    const onRevealChange = vi.fn();
    render(<KeyField label="K" keyName="K key" value="" onChange={() => {}} saved fetchSaved={async () => "abc"} onRevealChange={onRevealChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Show K key" }));
    await screen.findByDisplayValue("abc");
    expect(onRevealChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Hide K key" }));
    expect(onRevealChange).toHaveBeenLastCalledWith(false);
  });

  it("readOnly and defaultShown: a key to look at and copy (a new API key), shown at once and not editable", async () => {
    const clip = clipboard(async () => {});
    render(<KeyField label="Your new key" keyName="new key" value="bs_new" onChange={() => {}} saved={false} fetchSaved={async () => ""} readOnly defaultShown />);
    const input = screen.getByLabelText("Your new key");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("readOnly");
    expect(input).toHaveValue("bs_new");
    await userEvent.click(screen.getByRole("button", { name: "Copy new key" }));
    expect(clip.writeText).toHaveBeenCalledWith("bs_new");
    await userEvent.click(screen.getByRole("button", { name: "Hide new key" }));
    expect(input).toHaveAttribute("type", "password");
  });
});
