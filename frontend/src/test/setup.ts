import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetSettingsCache } from "../day";

afterEach(() => {
  cleanup();
  resetSettingsCache();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = "";
  // wideScreen() (src/test/wide.ts): back to no matchMedia, the phone layout
  delete (window as { matchMedia?: unknown }).matchMedia;
});
