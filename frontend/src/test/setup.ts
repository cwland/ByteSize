import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetSettingsCache } from "../day";
import { iconOnlyOffenders } from "./iconAudit";

afterEach(() => {
  // §44: whatever screen a test ended on, every icon-only button or link in it has an accessible name and hover text
  const offenders = iconOnlyOffenders();
  cleanup();
  if (offenders.length) throw new Error(`Icon-only controls without an aria-label and a title (use IconButton):\n${offenders.join("\n")}`);
  resetSettingsCache();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = "";
  // wideScreen() (src/test/wide.ts): back to no matchMedia, the phone layout
  delete (window as { matchMedia?: unknown }).matchMedia;
});
