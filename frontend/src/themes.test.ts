import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEMES, themeById } from "./themes";

describe("themes", () => {
  it("avocado is the default theme", () => {
    expect(themeById(undefined).id).toBe("avocado");
    expect(DEFAULT_THEME).toBe("avocado");
    expect(THEMES[0].colors.brand).toBe("#5aa83c");
  });
});
