import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import SettingsPage from "./SettingsPage";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

describe("SettingsPage", () => {
  it("members don't see admin sections", async () => {
    fakeServer({});
    renderWithSession(<SettingsPage />, { isAdmin: false });
    expect(await screen.findByRole("tab", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Integrations" })).toBeInTheDocument(); // per person
    expect(screen.getByText("Culury meal plan and recipes")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Data" })).toBeInTheDocument(); // everyone can download their own data
    expect(screen.getByText("Download your data")).toBeInTheDocument();
    for (const name of ["Users", "AI services", "Food sources", "Logs"]) {
      expect(screen.queryByRole("tab", { name })).not.toBeInTheDocument();
    }
  });

  it("admins see Users, Integrations and Logs; AI and food sources are inside Integrations", async () => {
    fakeServer({});
    renderWithSession(<SettingsPage />, { isAdmin: true });
    expect((await screen.findAllByRole("tab")).map((t) => t.getAttribute("aria-label"))).toEqual(["Profile", "Security", "Integrations", "Data", "Users", "Logs"]);
    expect(screen.getByText("Your data and backups")).toBeInTheDocument();
    expect(screen.getByText("AI, food data, restaurants, Culury")).toBeInTheDocument();
  });

  it.each(["#/settings/ai", "#/settings/food-sources", "#/settings/integrations"])("%s opens Integrations", async (hash) => {
    window.location.hash = hash;
    fakeServer({
      "GET /api/settings/ai": () => ({ settings: null }),
      "GET /api/admin/food-sources": () => ({ usda: { hasKey: false }, spoonacular: { hasKey: false }, fatsecret: { hasKey: false } }),
      "GET /api/settings/culury": () => ({ url: null, hasKey: false }),
    });
    renderWithSession(<SettingsPage />, { isAdmin: true });
    expect(await screen.findByRole("tabpanel", { name: "Integrations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Integrations");
    expect(await screen.findByRole("region", { name: "Food databases" })).toBeInTheDocument();
    expect(await screen.findByText(/Not linked yet/)).toBeInTheDocument();
  });

  it("an old address opens Integrations for a member too, with only Culury", async () => {
    window.location.hash = "#/settings/ai";
    const server = fakeServer({ "GET /api/settings/culury": () => ({ url: null, hasKey: false }) });
    renderWithSession(<SettingsPage />, { isAdmin: false });
    expect(await screen.findByRole("tabpanel", { name: "Integrations" })).toBeInTheDocument();
    expect(await screen.findByText(/Not linked yet/)).toBeInTheDocument();
    expect(server.sent.map((r) => r.path)).toEqual(["/api/settings/culury"]);
  });
});
