import { describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import Rail from "./Rail";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { settingsMe } from "../test/fixtures";
import userEvent from "@testing-library/user-event";

// §46: the rail's GLP-1 item comes from the settings the app already reads (glp1On), so it doesn't pop in after two
// requests of its own on every mount
const glp1Item = () => within(screen.getByRole("navigation", { name: "Main" })).queryByRole("link", { name: "GLP-1" });

describe("the rail's GLP-1 item (§46)", () => {
  it("comes from the settings: one request, never GLP-1's or the body's", async () => {
    const server = fakeServer({ "GET /api/settings/me": () => ({ ...settingsMe, glp1On: true }) });
    renderWithSession(<Rail page="goals" />);
    expect(await within(screen.getByRole("navigation", { name: "Main" })).findByRole("link", { name: "GLP-1" })).toHaveAttribute("href", "#/glp1");
    const paths = server.sent.map((s) => s.path.split("?")[0]);
    expect(paths).toEqual(["/api/settings/me"]);
  });

  it("drawn again (another page), it's there from the first paint", async () => {
    fakeServer({ "GET /api/settings/me": () => ({ ...settingsMe, glp1On: true }) });
    renderWithSession(<Rail page="goals" />);
    await within(screen.getByRole("navigation", { name: "Main" })).findByRole("link", { name: "GLP-1" });
    cleanup();
    fakeServer({ "GET /api/settings/me": () => new Promise(() => {}) }); // not answered yet
    renderWithSession(<Rail page="settings" />);
    expect(glp1Item()).toBeInTheDocument();
  });

  it("after a reload, the look remembered on this device has it from the first paint", () => {
    localStorage.setItem("bytesize-look:1", JSON.stringify({ dateFormat: "iso", weekStart: 1, glp1On: true }));
    fakeServer({ "GET /api/settings/me": () => new Promise(() => {}) });
    renderWithSession(<Rail page="goals" />, { id: 1 });
    expect(glp1Item()).toBeInTheDocument();
  });

  it("off: no item, and it goes when the settings say so", async () => {
    localStorage.setItem("bytesize-look:1", JSON.stringify({ dateFormat: "iso", weekStart: 1, glp1On: true }));
    fakeServer({ "GET /api/settings/me": () => ({ ...settingsMe, glp1On: false }) });
    renderWithSession(<Rail page="goals" />, { id: 1 });
    expect(glp1Item()).toBeInTheDocument(); // as remembered, until the settings answer
    await waitFor(() => expect(glp1Item()).toBeNull());
    expect(JSON.parse(localStorage.getItem("bytesize-look:1")!)).toMatchObject({ glp1On: false });
  });
});

// SPEC-24 / SPEC-23 / SPEC-18: Settings up with the pages; the avatar opens an account menu; the version sits below it
describe("the rail's bottom (W2)", () => {
  const rail = () => screen.getByRole("navigation", { name: "Main" });

  it("Settings sits with the pages, right after My foods; only the account and the version are at the bottom", () => {
    fakeServer({});
    renderWithSession(<Rail page="dashboard" />);
    const myFoods = within(rail()).getByRole("link", { name: "My foods" });
    const settings = within(rail()).getByRole("link", { name: "Settings" });
    expect(settings.parentElement).toBe(myFoods.parentElement);
    expect(myFoods.nextElementSibling).toBe(settings);
    const bottom = within(rail()).getByRole("button", { name: "Account menu" }).parentElement!.parentElement!; // the menu's own box, then the bottom
    expect(within(bottom).queryByRole("link", { name: "Settings" })).toBeNull();
    expect(within(bottom).getByRole("button", { name: /^What's new in v/ })).toBeInTheDocument();
  });

  it("the avatar opens a menu: name, email, Profile & security, Sign out, Sign out everywhere", async () => {
    fakeServer({});
    const { session } = renderWithSession(<Rail page="dashboard" />, { displayName: "Alex Doe", email: "alex@example.com" });
    const user = userEvent.setup();
    const avatar = within(rail()).getByRole("button", { name: "Account menu" });
    expect(avatar).toHaveAttribute("aria-expanded", "false");
    await user.click(avatar);
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(avatar).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByText("Alex Doe")).toBeInTheDocument();
    expect(within(menu).getByText("alex@example.com")).toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Profile & security", "Sign out", "Sign out everywhere"]);
    expect(within(menu).getByRole("menuitem", { name: "Profile & security" })).toHaveAttribute("href", "#/settings/profile");
    await user.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
    expect(session.signOut).toHaveBeenCalled();
  });

  it("no email: the username shows under the name", async () => {
    fakeServer({});
    renderWithSession(<Rail page="dashboard" />, { displayName: "Alex", username: "alex", email: null });
    await userEvent.setup().click(within(rail()).getByRole("button", { name: "Account menu" }));
    expect(within(screen.getByRole("menu", { name: "Account" })).getByText("alex")).toBeInTheDocument();
  });

  it("Sign out everywhere asks first, then signs out every device", async () => {
    fakeServer({});
    const { session } = renderWithSession(<Rail page="dashboard" />);
    const user = userEvent.setup();
    await user.click(within(rail()).getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out everywhere" }));
    expect(session.signOutEverywhere).not.toHaveBeenCalled();
    const ask = screen.getByRole("alertdialog", { name: "Sign out everywhere?" });
    await user.click(within(ask).getByRole("button", { name: "Sign out everywhere" }));
    expect(session.signOutEverywhere).toHaveBeenCalled();
  });

  it("Escape closes the menu and gives focus back to the avatar", async () => {
    fakeServer({});
    renderWithSession(<Rail page="dashboard" />);
    const user = userEvent.setup();
    const avatar = within(rail()).getByRole("button", { name: "Account menu" });
    await user.click(avatar);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Account" })).toBeNull();
    expect(avatar).toHaveFocus();
  });

  it("a click outside closes it", async () => {
    fakeServer({});
    renderWithSession(<Rail page="dashboard" />);
    const user = userEvent.setup();
    await user.click(within(rail()).getByRole("button", { name: "Account menu" }));
    await user.click(within(rail()).getByRole("link", { name: "Goals" }));
    expect(screen.queryByRole("menu", { name: "Account" })).toBeNull();
  });
});
