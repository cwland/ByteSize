import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, THEMES, themeById } from "./themes";

describe("themes", () => {
  it("avocado is the default theme", () => {
    expect(themeById(undefined).id).toBe("avocado");
    expect(DEFAULT_THEME).toBe("avocado");
    expect(THEMES[0].colors.brand).toBe("#5aa83c");
  });
});

describe("color mode", () => {
  it("dark mode is the default", async () => {
    localStorage.clear();
    vi.resetModules();
    const t = await import("./themes");
    t.applyTheme(t.currentTheme().id);
    expect(document.documentElement.dataset.mode).toBe("dark");
  });
});
