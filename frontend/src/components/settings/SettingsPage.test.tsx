import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import SettingsPage from "./SettingsPage";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { wideScreen } from "../../test/wide";

describe("SettingsPage", () => {
  it("phones: an Insights row (lightbulb) opens the Insights page, whatever the Dashboard holds (§43); wide screens have the rail", async () => {
    fakeServer({});
    const { unmount } = renderWithSession(<SettingsPage />, { isAdmin: false });
    const link = await screen.findByRole("link", { name: "Insights" });
    expect(link).toHaveAttribute("href", "#/insights");
    expect(link.querySelector("svg.lucide-lightbulb")).not.toBeNull();
    expect(screen.queryByRole("tab", { name: "Insights" })).not.toBeInTheDocument(); // a way to a page, not a section
    unmount();
    wideScreen();
    fakeServer({});
    renderWithSession(<SettingsPage />, { isAdmin: false });
    await screen.findByRole("heading", { name: "Settings" });
    expect(screen.queryByRole("link", { name: "Insights" })).not.toBeInTheDocument();
  });

  it("members don't see admin sections", async () => {
    fakeServer({});
    renderWithSession(<SettingsPage />, { isAdmin: false });
    expect(await screen.findByRole("tab", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "API keys" })).toBeInTheDocument(); // everyone's own keys
    expect(screen.getByText("Keys for your own tools and scripts")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Integrations" })).toBeInTheDocument(); // per person
    expect(screen.getByText("Culury meal plan and recipes")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Data" })).toBeInTheDocument(); // everyone can download their own data
    expect(screen.getByText("Download your data")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "App info" })).toBeInTheDocument(); // everyone's own numbers
    for (const name of ["Users", "AI services", "Food sources", "Logs", "Email", "Cached data"]) {
      expect(screen.queryByRole("tab", { name })).not.toBeInTheDocument();
    }
  });

  it("admins see Users, Integrations and Logs; AI and food sources are inside Integrations", async () => {
    fakeServer({});
    renderWithSession(<SettingsPage />, { isAdmin: true });
    expect((await screen.findAllByRole("tab")).map((t) => t.getAttribute("aria-label"))).toEqual(["Profile", "API keys", "Security", "Integrations", "Cached data", "Email", "Data", "App info", "Users", "Logs"]);
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

  it("Cached data is an admin-only row after Integrations, and opens the saved barcodes list", async () => {
    window.location.hash = "#/settings/cached-data";
    fakeServer({ "GET /api/admin/saved-barcodes": () => ({ total: 0, page: 1, pageSize: 10, sources: {}, items: [] }) });
    renderWithSession(<SettingsPage />, { isAdmin: true });
    expect(screen.getByRole("heading", { level: 1, name: "Cached data" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Saved barcodes" })).toBeInTheDocument();
  });

  it("API keys opens the person's keys", async () => {
    window.location.hash = "#/settings/api-keys";
    fakeServer({ "GET /api/keys": () => ({ keys: [] }) });
    renderWithSession(<SettingsPage />, { isAdmin: false });
    expect(screen.getByRole("heading", { level: 1, name: "API keys" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "New key" })).toBeInTheDocument();
  });

  it("App info is a row in the phone list, between Data and the admin sections, and opens its numbers", async () => {
    window.location.hash = "#/settings/app-info";
    fakeServer({ "GET /api/app-info": () => ({ you: { daysLogged: 12, foodsLogged: 0, differentFoods: 0, myFoods: 0, weighIns: 0, weightLost: null, shots: null, longestStreak: 0, memberSince: "2026-03-04", barcodesScanned: 0, photosRead: 0, aiEstimates: 0, lookupsSaved: 0, outsideLookups: { total: 0, off: 0, usda: 0, fatsecret: 0, spoonacular: 0, culury: 0 } }, countingSince: "2026-11-18", version: "0.1.0" }) });
    renderWithSession(<SettingsPage />, { isAdmin: false });
    expect(screen.getByRole("heading", { level: 1, name: "App info" })).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "Days logged" })).toBeInTheDocument();
  });
});
