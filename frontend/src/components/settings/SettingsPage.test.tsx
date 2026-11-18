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
    for (const name of ["Users", "AI services", "Food sources", "Logs", "Email"]) {
      expect(screen.queryByRole("tab", { name })).not.toBeInTheDocument();
    }
  });

  it("admins see Users, Integrations and Logs; AI and food sources are inside Integrations", async () => {
    fakeServer({});
    renderWithSession(<SettingsPage />, { isAdmin: true });
    expect((await screen.findAllByRole("tab")).map((t) => t.getAttribute("aria-label"))).toEqual(["Profile", "Security", "Integrations", "Email", "Data", "Users", "Logs"]);
    expect(screen.getByText("Your data and backups")).toBeInTheDocument();
    expect(screen.getByText("Sending email, forgot password")).toBeInTheDocument();
    expect(screen.getByText("AI, food data, restaurants, Culury")).toBeInTheDocument();
  });

  it.each(["#/settings/ai", "#/settings/food-sources", "#/settings/integrations"])("%s opens Integrations", async (hash) => {
    window.location.hash = hash;
    fakeServer({
      "GET /api/settings/ai": () => ({ settings: null }),
      "GET /api/admin/food-sources": () => ({ off: { enabled: true }, usda: { hasKey: false, enabled: false }, spoonacular: { hasKey: false, enabled: false }, fatsecret: { hasKey: false, enabled: false } }),
      "GET /api/settings/culury": () => ({ url: null, hasKey: false, enabled: false }),
    });
    renderWithSession(<SettingsPage />, { isAdmin: true });
    expect(await screen.findByRole("tabpanel", { name: "Integrations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Integrations");
    expect(await screen.findByRole("region", { name: "USDA" })).toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: "Culury on" })).toBeInTheDocument();
  });

  it("Security: an admin sets up OAuth sign-in there; everyone can link their account when it's on", async () => {
    window.location.hash = "#/settings/security";
    fakeServer({
      "GET /api/passkeys": () => [],
      "GET /api/auth/sessions": () => [],
      "GET /api/auth/logins": () => [],
      "GET /api/auth/oauth": () => ({ available: true, providerName: "Authentik", linked: null }),
      "GET /api/settings/oauth": () => ({ settings: { enabled: true, providerName: "Authentik", issuerUrl: "https://auth.lan", clientId: "c", clientSecretSet: true, clientSecretUnreadable: false, oauthOnly: false, ready: true } }),
    });
    renderWithSession(<SettingsPage />, { isAdmin: true });
    expect(await screen.findByRole("region", { name: "OAuth sign-in" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Link my account" })).toBeInTheDocument();
  });

  it("Security for a member: Link my account, never the OAuth settings", async () => {
    window.location.hash = "#/settings/security";
    const server = fakeServer({
      "GET /api/passkeys": () => [],
      "GET /api/auth/sessions": () => [],
      "GET /api/auth/logins": () => [],
      "GET /api/auth/oauth": () => ({ available: true, providerName: "Authentik", linked: null }),
    });
    renderWithSession(<SettingsPage />, { isAdmin: false });
    expect(await screen.findByRole("region", { name: "Link my account" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "OAuth sign-in" })).not.toBeInTheDocument();
    expect(server.sent.some((s) => s.path === "/api/settings/oauth")).toBe(false);
  });

  it("an old address opens Integrations for a member too, with only Culury", async () => {
    window.location.hash = "#/settings/ai";
    const server = fakeServer({ "GET /api/settings/culury": () => ({ url: null, hasKey: false, enabled: false }) });
    renderWithSession(<SettingsPage />, { isAdmin: false });
    expect(await screen.findByRole("tabpanel", { name: "Integrations" })).toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: "Culury on" })).toBeInTheDocument();
    expect(server.sent.map((r) => r.path)).toEqual(["/api/settings/culury"]);
  });
});
