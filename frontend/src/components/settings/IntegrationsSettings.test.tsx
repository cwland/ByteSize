import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import IntegrationsSettings from "./IntegrationsSettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

const none = { off: { enabled: true }, usda: { hasKey: false, enabled: false }, spoonacular: { hasKey: false, enabled: false }, fatsecret: { hasKey: false, enabled: false } };
const adminRoutes = {
  "GET /api/settings/ai": () => ({ settings: null }),
  "GET /api/admin/food-sources": () => none,
  "GET /api/admin/saved-barcodes": () => ({ total: 0, page: 1, pageSize: 50, items: [] }),
  "GET /api/settings/culury": () => ({ url: null, hasKey: false, enabled: false }),
};

describe("Settings › Integrations", () => {
  it("admins see the lookup order, six titled cards (AI services, Open Food Facts, USDA, FatSecret, Spoonacular, Culury) and Saved barcodes", async () => {
    const server = fakeServer(adminRoutes);
    renderWithSession(<IntegrationsSettings />, { isAdmin: true });
    expect(await screen.findByRole("switch", { name: "USDA on" })).toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: "Culury on" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["How ByteSize looks foods up", "AI services", "Open Food Facts", "USDA", "FatSecret", "Spoonacular", "Saved barcodes", "Culury"]);
    for (const name of ["AI services", "Open Food Facts", "USDA", "FatSecret", "Spoonacular", "Culury"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    // one summary of the food sources for the order table and their four cards
    expect(server.sent.filter((r) => r.path === "/api/admin/food-sources")).toHaveLength(1);
  });

  it("members see only Culury, and no admin route is asked", async () => {
    const server = fakeServer({ "GET /api/settings/culury": () => ({ url: null, hasKey: false, enabled: false }) });
    renderWithSession(<IntegrationsSettings />, { isAdmin: false });
    expect(await screen.findByRole("switch", { name: "Culury on" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Culury"]);
    expect(server.sent.map((r) => r.path)).toEqual(["/api/settings/culury"]);
  });
});
