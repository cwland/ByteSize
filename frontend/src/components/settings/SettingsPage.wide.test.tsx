import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "./SettingsPage";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { wideScreen } from "../../test/wide";
import { settingsMe } from "../../test/fixtures";

const routes = {
  "GET /api/settings/me": () => settingsMe,
  "GET /api/settings/ai": () => ({ settings: null }),
  "GET /api/admin/food-sources": () => ({ off: { enabled: true }, usda: { hasKey: false, enabled: false }, spoonacular: { hasKey: false, enabled: false }, fatsecret: { hasKey: false, enabled: false } }),
  "GET /api/settings/culury": () => ({ url: null, hasKey: false, enabled: false }),
  "GET /api/passkeys": () => [],
  "GET /api/auth/sessions": () => [],
  "GET /api/auth/logins": () => [],
};

describe("Settings on a wide screen", () => {
  it("shows the tabs across the top; #/settings opens the first tab", async () => {
    window.location.hash = "#/settings";
    wideScreen();
    fakeServer(routes);
    renderWithSession(<SettingsPage />, { isAdmin: true });
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    const strip = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(strip).queryByRole("tablist")).not.toBeInTheDocument();
    expect(within(strip).getAllByRole("link").map((t) => t.textContent)).toEqual(["Profile", "Security", "Integrations", "Email", "Data", "App info", "Users", "Logs"]);
    expect(within(strip).getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    expect(within(strip).getByRole("link", { name: "Security" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("tabpanel", { name: "Profile" })).toBeInTheDocument();
    // No phone list of rows with chevrons
    expect(screen.queryByRole("link", { name: /‹|Settings$/ })).not.toBeInTheDocument();
  });

  it("a tab opens its panel at its own address", async () => {
    window.location.hash = "#/settings/profile";
    wideScreen();
    fakeServer(routes);
    renderWithSession(<SettingsPage />, { isAdmin: true });
    const tab = within(screen.getByRole("navigation", { name: "Settings sections" })).getByRole("link", { name: "Integrations" });
    expect(tab).toHaveAttribute("href", "#/settings/integrations");
    await userEvent.setup().click(tab);
    await waitFor(() => expect(tab).toHaveAttribute("aria-current", "page"));
    const panel = screen.getByRole("tabpanel", { name: "Integrations" });
    expect(await within(panel).findByRole("region", { name: "USDA" })).toBeInTheDocument();
    // Integrations' cards sit in two columns
    expect(panel).toHaveClass("lg:columns-2");
    expect(screen.queryByRole("tabpanel", { name: "Profile" })).not.toBeInTheDocument();
  });

  it("members don't see the admin tabs", () => {
    window.location.hash = "#/settings/logs";
    wideScreen();
    fakeServer(routes);
    renderWithSession(<SettingsPage />, { isAdmin: false });
    expect(within(screen.getByRole("navigation", { name: "Settings sections" })).getAllByRole("link").map((t) => t.textContent)).toEqual(["Profile", "Security", "Integrations", "Data", "App info"]);
    // An admin tab's address falls back to the first tab
    expect(screen.getByRole("tabpanel", { name: "Profile" })).toBeInTheDocument();
  });

  it("Sign out is at hand", async () => {
    window.location.hash = "#/settings";
    wideScreen();
    fakeServer(routes);
    const { session } = renderWithSession(<SettingsPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    expect(session.signOut).toHaveBeenCalled();
  });
});
