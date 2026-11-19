import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderSwiftTokens } from "../../scripts/gen-ios-theme";

// The iPhone app's colors are generated from themes.ts. If this fails, run:
//   cd frontend && npx tsx ../scripts/gen-ios-theme.ts
const swiftFile = resolve(process.cwd(), "../ios/ByteSizeKit/Sources/ByteSizeKit/Theme/ThemeTokens.swift") // tests run from frontend/;

describe("iOS theme tokens", () => {
  it("ThemeTokens.swift matches the web themes", () => {
    expect(readFileSync(swiftFile, "utf8")).toBe(renderSwiftTokens());
  });
});
