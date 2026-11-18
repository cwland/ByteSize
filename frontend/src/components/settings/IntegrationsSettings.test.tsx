import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { foodSourcesJson } from "../../test/fixtures";
import IntegrationsSettings from "./IntegrationsSettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

const none = { off: { enabled: true }, usda: { hasKey: false, enabled: false }, spoonacular: { hasKey: false, enabled: false }, fatsecret: { hasKey: false, enabled: false } };
const adminRoutes = {
  "GET /api/settings/ai": () => ({ settings: null }),
  "GET /api/admin/food-sources": () => none,
  "GET /api/settings/culury": () => ({ url: null, hasKey: false, enabled: false }),
};

describe("Settings › Integrations", () => {
  it("admins see the lookup order, six titled cards (AI services, Open Food Facts, USDA, FatSecret, Spoonacular, Culury) and a link to Cached data", async () => {
    const server = fakeServer(adminRoutes);
    renderWithSession(<IntegrationsSettings />, { isAdmin: true });
    expect(await screen.findByRole("switch", { name: "USDA on" })).toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: "Culury on" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["How ByteSize looks foods up", "AI services", "Open Food Facts", "USDA", "FatSecret", "Spoonacular", "Culury"]);
    for (const name of ["AI services", "Open Food Facts", "USDA", "FatSecret", "Spoonacular", "Culury"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Saved barcodes" })).not.toBeInTheDocument(); // moved to Cached data (§32)
    expect(server.sent.some((r) => r.path.includes("saved-barcodes"))).toBe(false);
    // one summary of the food sources for the order table and their four cards
    expect(server.sent.filter((r) => r.path === "/api/admin/food-sources")).toHaveLength(1);
  });

  it("each food-source card that is on has a one-line link to the Cached data tab", async () => {
    fakeServer({ ...adminRoutes, "GET /api/admin/food-sources": () => foodSourcesJson({ usda: { hasKey: true, enabled: true }, fatsecret: { hasKey: true, enabled: true }, spoonacular: { hasKey: true, enabled: true } }) });
    renderWithSession(<IntegrationsSettings />, { isAdmin: true });
    for (const name of ["Open Food Facts", "USDA", "FatSecret", "Spoonacular"]) {
      expect(await within(await screen.findByRole("region", { name })).findByRole("link", { name: "See cached data" })).toHaveAttribute("href", "#/settings/cached-data");
    }
  });

  it("members see only Culury, and no admin route is asked", async () => {
    const server = fakeServer({ "GET /api/settings/culury": () => ({ url: null, hasKey: false, enabled: false }) });
    renderWithSession(<IntegrationsSettings />, { isAdmin: false });
    expect(await screen.findByRole("switch", { name: "Culury on" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Culury"]);
    expect(server.sent.map((r) => r.path)).toEqual(["/api/settings/culury"]);
  });
});
