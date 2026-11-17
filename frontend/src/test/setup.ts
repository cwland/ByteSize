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
});
