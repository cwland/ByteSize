import { act } from "@testing-library/react";

// jsdom has no matchMedia, so every screen renders the phone layout (useWide() is false). wideScreen()
// puts in a pretend one that says the window is at least 1024 px wide; the returned set() resizes it,
// telling listeners the way a browser does. src/test/setup.ts takes it away after each test.
export function wideScreen(on = true) {
  let matches = on;
  const listeners = new Set<(e: { matches: boolean }) => void>();
  window.matchMedia = ((media: string) => ({
    get matches() {
      return matches;
    },
    media,
    onchange: null,
    addEventListener: (_type: string, l: (e: { matches: boolean }) => void) => listeners.add(l),
    removeEventListener: (_type: string, l: (e: { matches: boolean }) => void) => listeners.delete(l),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      matches = next;
      act(() => listeners.forEach((l) => l({ matches: next })));
    },
  };
}
