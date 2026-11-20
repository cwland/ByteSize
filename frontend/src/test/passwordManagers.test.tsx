import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuthScreen from "../components/AuthScreen";
import SetupWizard from "../components/SetupWizard";
import Dashboard from "../components/dashboard/Dashboard";
import FoodHost from "./FoodHost";
import GoalsPage from "../components/goals/GoalsPage";
import SettingsPage from "../components/settings/SettingsPage";
import MyFoodsPage from "../components/myfoods/MyFoodsPage";
import Glp1Page from "../components/glp1/Glp1Page";
import { SelectedDayProvider } from "../selectedDay";
import { fakeServer } from "./fakeServer";
import { renderWithSession } from "./renderWithSession";
import { barFood, culuryOff, dayJson, entryJson, foodSourcesJson, m3Routes, restaurantRoutes, settingsMe, steadyTargets } from "./fixtures";
import { afterEnough, glp1View } from "./glp1Fixtures";
import { weightJson } from "./weightFixtures";
import { breakfastMeal, chili } from "./myFoodsFixtures";

// §26: password managers (1Password, LastPass, Bitwarden) only on the sign-in fields. Every other text,
// number, search and textarea field in the main screens tells them to leave it alone.

const NOT_TEXT = new Set(["checkbox", "radio", "file", "hidden", "range", "color", "submit", "button", "image", "reset"]);
const textFields = () => [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter((el) => el.tagName === "TEXTAREA" || !NOT_TEXT.has((el as HTMLInputElement).type));
const nameOf = (el: Element) => el.getAttribute("aria-label") || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || el.closest("label")?.textContent || el.outerHTML.slice(0, 80);
const ignored = (el: Element) => el.hasAttribute("data-1p-ignore") && el.getAttribute("data-lpignore") === "true" && el.hasAttribute("data-bwignore");

// Every text field on screen now is left alone by password managers, with an autocomplete value; returns their names
function expectAllIgnored(where: string) {
  const fields = textFields();
  const wrong = fields.filter((el) => !ignored(el) || !el.getAttribute("autocomplete")).map((el) => `${nameOf(el)} (autocomplete=${el.getAttribute("autocomplete")})`);
  expect(wrong, `${where}: fields password managers would fill`).toEqual([]);
  return fields.map(nameOf);
}
// A sign-in field: the given autocomplete, and none of the ignore attributes
function expectSignIn(el: HTMLElement, autocomplete: string) {
  expect(el).toHaveAttribute("autocomplete", autocomplete);
  expect(el).not.toHaveAttribute("data-1p-ignore");
  expect(el).not.toHaveAttribute("data-lpignore");
  expect(el).not.toHaveAttribute("data-bwignore");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
});
afterEach(() => void vi.useRealTimers());

const dayRoutes = {
  ...m3Routes,
  ...culuryOff,
  ...restaurantRoutes,
  "GET /api/day/:date": () => dayJson({ entries: [entryJson()] }),
  "GET /api/settings/me": () => settingsMe,
  "GET /api/weight": () => weightJson(),
  "GET /api/foods/recent": () => ({ foods: [] }),
  "GET /api/foods/search": () => ({ groups: [{ source: "off", label: "Open Food Facts", foods: [barFood] }], errors: [] }),
  "GET /api/ai/status": () => ({ ready: true, photos: true }),
  "GET /api/days/logged": () => ({ days: [] }),
};
const inDay = (ui: ReactNode) => <SelectedDayProvider timeZone="America/Boise">{ui}</SelectedDayProvider>;

describe("password managers leave data fields alone", () => {
  it("Dashboard and its Food widget", async () => {
    fakeServer(dayRoutes);
    const { unmount } = renderWithSession(inDay(<Dashboard />));
    await screen.findByRole("region", { name: "Budget" });
    expectAllIgnored("Dashboard");
    unmount();
    renderWithSession(inDay(<FoodHost />));
    await screen.findByRole("region", { name: "Snacks" });
    expectAllIgnored("Food widget");
  });

  it("Add food: search, barcode, describe it, create food", async () => {
    fakeServer(dayRoutes);
    renderWithSession(inDay(<FoodHost />));
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole("region", { name: "Snacks" })).getByRole("button", { name: "Add Food" }));
    const sheet = screen.getByRole("dialog", { name: "Add food to Snacks" });
    await user.click(within(sheet).getByRole("button", { name: "Barcode" }));
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "peanut");
    await within(sheet).findByText("Peanut butter bar");
    expect(expectAllIgnored("Add food search")).toEqual(expect.arrayContaining(["Search foods", "Barcode number"]));

    await user.click(within(sheet).getByRole("button", { name: "Describe it" }));
    expect(expectAllIgnored("Describe it")).toContain("Describe the food");
    await user.click(within(sheet).getByRole("button", { name: "‹ Back" }));
    await user.click(within(sheet).getByRole("button", { name: "Create food" }));
    expect(expectAllIgnored("Create food")).toEqual(expect.arrayContaining(["Name", "Brand", "Barcode", "Serving size", "Grams", "Calories"]));
  });

  it("Goals: targets and vacation mode", async () => {
    fakeServer({ ...dayRoutes, "GET /api/targets": () => ({ targets: steadyTargets }), "GET /api/vacations": () => ({ vacations: [] }) });
    renderWithSession(inDay(<GoalsPage />));
    await screen.findByText("Steady plan");
    await userEvent.setup().click(screen.getByRole("button", { name: "Edit targets" }));
    expect(expectAllIgnored("Goals").length).toBeGreaterThan(4);
  });

  it("My foods: search, a recipe, a quick meal, a new food", async () => {
    fakeServer({
      "GET /api/my-foods": () => ({ foods: [chili, breakfastMeal] }),
      "GET /api/my-foods/:id": (_b, path) => (path.endsWith(`/${chili.id}`) ? { food: chili } : { food: breakfastMeal }),
      ...dayRoutes,
    });
    renderWithSession(<MyFoodsPage />);
    const user = userEvent.setup();
    await screen.findByText(chili.name);
    expect(expectAllIgnored("My foods")).toContain("Search my foods");
    await user.click(screen.getByRole("button", { name: /New recipe/ }));
    expect(expectAllIgnored("New recipe")).toEqual(expect.arrayContaining(["Name", "Number of servings"]));
    await user.click(screen.getByRole("button", { name: "‹ My Foods" }));
    await user.click(await screen.findByRole("button", { name: /New quick meal/ }));
    expectAllIgnored("New quick meal");
    await user.click(screen.getByRole("button", { name: "‹ My Foods" }));
    await user.click(await screen.findByRole("button", { name: /New food/ }));
    expect(expectAllIgnored("New food")).toContain("Calories");
  });

  it("GLP-1", async () => {
    fakeServer({ "GET /api/glp1": () => glp1View(), "GET /api/glp1/after-injection": () => afterEnough, "GET /api/side-effects": () => ({ days: [] }) });
    renderWithSession(inDay(<Glp1Page />));
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole("region", { name: "Setup" })).getByRole("button", { name: "Edit" }));
    // a brand has only selects (W1); Compounded's typed fields are the ones password managers must leave alone
    await user.selectOptions(screen.getByLabelText("Medication"), "Compounded");
    expect(expectAllIgnored("GLP-1 setup")).toEqual(expect.arrayContaining(["Medication / compound name", "Dose"]));
    await user.click(screen.getByRole("button", { name: "Log shot" }));
    expect(expectAllIgnored("Log shot")).toEqual(expect.arrayContaining(["Date", "Note"]));
  });

  it("every Settings tab, as an admin", async () => {
    const svc = { id: "s1", name: "", provider: "openrouter", model: "small", baseUrl: null, quick: true, photos: true, hasKey: true, apiKeyUnreadable: false };
    fakeServer({
      ...dayRoutes,
      "GET /api/settings/ai": () => ({ settings: { enabled: true, timeoutSec: 15, services: [svc] } }),
      "GET /api/admin/food-sources": () => foodSourcesJson(),
      "GET /api/settings/email": () => ({ enabled: true, host: "smtp.example.com", port: 587, security: "starttls", username: "me", passwordSet: true, fromAddress: "me@example.com", fromName: "ByteSize", appUrl: "https://b.example.com", ready: true }),
      "GET /api/settings/oauth": () => ({ settings: { enabled: true, providerName: "Authentik", issuerUrl: "https://auth.lan", clientId: "c", clientSecretSet: true, clientSecretUnreadable: false, oauthOnly: false, ready: true } }),
      "GET /api/auth/oauth": () => ({ available: false, providerName: null, linked: null }),
      "GET /api/passkeys": () => [],
      "GET /api/auth/sessions": () => [],
      "GET /api/auth/logins": () => [],
      "GET /api/admin/users": () => ({ users: [{ id: 1, username: "cory", displayName: "Cory", email: null, isAdmin: true, disabled: false, lastLoginAt: null, createdAt: "2026-11-01T00:00:00Z" }] }),
      "GET /api/logs": () => [],
      "GET /api/backups": () => ({ backups: [], schedule: null }),
      "GET /api/saved-barcodes": () => ({ barcodes: [], total: 0 }),
    });
    renderWithSession(<SettingsPage />, { isAdmin: true });
    const user = userEvent.setup();
    for (const tab of ["profile", "security", "integrations", "email", "data", "users", "logs"]) {
      window.location.hash = `#/settings/${tab}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      await screen.findByRole("tabpanel");
      await new Promise((r) => setTimeout(r, 50)); // its data loaded
      if (tab === "integrations") {
        const ai = await screen.findByRole("listitem", { name: /OpenRouter/ });
        await user.click(within(ai).getByRole("button", { expanded: false }));
      }
      if (tab === "users") await user.click(await screen.findByRole("button", { name: "Add person" }));
      if (tab === "security") {
        // Changing your own password is the password manager's: current and new
        expectSignIn(screen.getByLabelText("Current password"), "current-password");
        expectSignIn(screen.getByLabelText("New password"), "new-password");
        expectSignIn(screen.getByLabelText("Confirm new password"), "new-password");
        for (const el of [screen.getByLabelText("Current password"), screen.getByLabelText("New password"), screen.getByLabelText("Confirm new password")]) el.remove();
      }
      if (tab === "users") {
        // A new person's password is set here (new-password); the other fields are data
        const form = screen.getByRole("form", { name: "Add person" });
        const pw = within(form).getByLabelText("Password");
        expectSignIn(pw, "new-password");
        pw.remove();
      }
      const names = expectAllIgnored(`Settings › ${tab}`);
      if (tab === "integrations") expect(names).toEqual(expect.arrayContaining(["Service name", "Model"]));
      if (tab === "profile") expect(names).toEqual(expect.arrayContaining(["Name", "Email"]));
    }
  });
});

describe("password managers keep the sign-in fields", () => {
  it("sign in: username and current password", async () => {
    fakeServer({ "GET /api/auth/status": () => ({ setupRequired: false, passwords: true, forgotPassword: true, oauth: null }) });
    render(<AuthScreen onDone={vi.fn()} />);
    await screen.findByRole("button", { name: "Sign in" });
    const username = screen.getByLabelText("Username");
    expect(username.getAttribute("autocomplete")).toMatch(/^username\b/);
    expect(username).not.toHaveAttribute("data-1p-ignore");
    expectSignIn(screen.getByLabelText("Password"), "current-password");
  });

  it("forgot password: the email, the 6-digit code and the new password", async () => {
    fakeServer({
      "GET /api/auth/status": () => ({ setupRequired: false, passwords: true, forgotPassword: true, oauth: null }),
      "POST /api/auth/forgot": () => ({ ok: true, message: "Sent." }),
    });
    render(<AuthScreen onDone={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Forgot password?" }));
    expectSignIn(screen.getByLabelText("Email"), "email");
    await user.type(screen.getByLabelText("Email"), "cory@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByText("Sent.");
    expectSignIn(screen.getByLabelText("6-digit code"), "one-time-code");
    expectSignIn(screen.getByLabelText("New password"), "new-password");
    expectSignIn(screen.getByLabelText("Confirm new password"), "new-password");
  });

  it("first-run setup: the new account's username and password", async () => {
    fakeServer({});
    render(<SetupWizard onAccount={vi.fn()} onDone={vi.fn()} />);
    expectSignIn(await screen.findByLabelText("Username"), "username");
    expectSignIn(screen.getByLabelText("Password"), "new-password");
    expectSignIn(screen.getByLabelText("Confirm password"), "new-password");
  });
});
