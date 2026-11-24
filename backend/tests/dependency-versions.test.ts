import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Libraries with published security holes in older versions: the installed copy must be at least the first
// fixed release. sharp reads every uploaded photo, nodemailer sends reset codes and invites, and
// @fastify/static serves the web app.
const require = createRequire(import.meta.url);
// The installed version, read from the package's own folder (some packages, like sharp, don't export package.json)
function installed(name: string): string {
  for (let dir = path.dirname(require.resolve(name)); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const file = path.join(dir, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version: string };
    if (pkg.name === name) return pkg.version;
  }
  throw new Error(`Can't find ${name}'s package.json`);
}

const atLeast = (version: string, min: string) => {
  const a = version.split(/[.-]/).slice(0, 3).map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

const MINIMUM: Record<string, string> = {
  sharp: "0.35.5", // libvips, libheif and librsvg fixes
  nodemailer: "10.1.4", // addressparser and SMTP fixes
  "@fastify/static": "10.1.12", // path traversal and route guard bypass fixes
};

describe("security fixes in dependencies", () => {
  for (const [name, min] of Object.entries(MINIMUM)) {
    it(`${name} is at least ${min}`, () => {
      expect(atLeast(installed(name), min), `${name} ${installed(name)}`).toBe(true);
    });
  }

  it("compares versions by number, not text", () => {
    expect(atLeast("0.35.10", "0.35.5")).toBe(true);
    expect(atLeast("0.34.5", "0.35.5")).toBe(false);
    expect(atLeast("10.1.4", "10.1.4")).toBe(true);
    expect(atLeast("9.9.9", "10.1.4")).toBe(false);
  });
});
