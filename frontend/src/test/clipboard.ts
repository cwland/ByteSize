import { vi } from "vitest";

// The browser's clipboard for tests (jsdom has none). Call restoreClipboard() in afterEach.

/** navigator.clipboard with writeText (and write, when given); undefined = no clipboard API (plain http). */
export function stubClipboard(api: { writeText?: (text: string) => Promise<void>; write?: (items: unknown[]) => Promise<void> } | undefined) {
  const value = api && { ...(api.writeText ? { writeText: vi.fn(api.writeText) } : {}), ...(api.write ? { write: vi.fn(api.write) } : {}) };
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
  return value as { writeText: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> } | undefined;
}

/** Safari's way: ClipboardItem whose data may be a promise of a Blob. Undo with vi.unstubAllGlobals(). */
export class FakeClipboardItem {
  constructor(public items: Record<string, Blob | Promise<Blob>>) {}
  async text(type = "text/plain") {
    return (await this.items[type]).text();
  }
}
export function stubClipboardItem() {
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
}

export function restoreClipboard() {
  delete (navigator as { clipboard?: unknown }).clipboard;
}
