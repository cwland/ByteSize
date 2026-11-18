import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import IntegrationsSettings from "./IntegrationsSettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

const none = { usda: { hasKey: false }, spoonacular: { hasKey: false }, fatsecret: { hasKey: false } };
const adminRoutes = {
  "GET /api/settings/ai": () => ({ settings: null }),
  "GET /api/admin/food-sources": () => none,
  "GET /api/settings/culury": () => ({ url: null, hasKey: false }),
};

describe("Settings › Integrations", () => {
  it("admins see four titled sections, in order: AI services, Food databases, Restaurant menus, Culury", async () => {
    fakeServer(adminRoutes);
    renderWithSession(<IntegrationsSettings />, { isAdmin: true });
    expect(await screen.findByText(/No USDA key yet/)).toBeInTheDocument();
    expect(await screen.findByText(/Not linked yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["AI services", "Food databases", "Restaurant menus", "Culury"]);
    for (const name of ["AI services", "Food databases", "Restaurant menus", "Culury"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
  });

  it("members see only Culury, and no admin route is asked", async () => {
    const server = fakeServer({ "GET /api/settings/culury": () => ({ url: null, hasKey: false }) });
    renderWithSession(<IntegrationsSettings />, { isAdmin: false });
    expect(await screen.findByText(/Not linked yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Culury"]);
    expect(server.sent.map((r) => r.path)).toEqual(["/api/settings/culury"]);
  });
});
