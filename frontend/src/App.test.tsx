import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import App from "./App";
import userEvent from "@testing-library/user-event";
import { getToken, setToken } from "./api";
import { fakeServer, userJson } from "./test/fakeServer";

describe("App", () => {
  it("first run shows the setup wizard", async () => {
    fakeServer({ "GET /api/auth/status": () => ({ setupRequired: true, passwords: true }) });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Set up ByteSize" })).toBeInTheDocument();
  });

  it("sign-in screen has no sign-up link", async () => {
    fakeServer({ "GET /api/auth/status": () => ({ setupRequired: false, passwords: true }) });
    render(<App />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText(/sign up|create account|register/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign up|create account|register/i })).not.toBeInTheDocument();
  });

  it("signed in shows Dashboard, Goals, My foods and Settings (no Log), and a Log food button", async () => {
    setToken("t0k");
    fakeServer({
      "GET /api/auth/status": () => ({ setupRequired: false, passwords: true }),
      "GET /api/auth/me": () => ({ user: userJson() }),
    });
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(screen.queryByRole("link", { name: "Log" })).not.toBeInTheDocument();
    for (const name of ["Dashboard", "Goals", "My foods", "Settings"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
    // My foods is in the bar too (§28 ruling: the rail's pages, with Log gone)
    expect(screen.getByRole("button", { name: "Log food" })).toBeInTheDocument();
  });

  it("an invite link opens the invite page; accepting signs the person in and starts first-run setup", async () => {
    window.location.hash = "#/invite/abcDEF123_-";
    fakeServer({
      "GET /api/auth/status": () => ({ setupRequired: false, passwords: true }),
      "POST /api/invites/check": () => ({ name: "Dana", username: "dana" }),
      "POST /api/invites/accept": () => ({ token: "dana-token", user: userJson({ id: 2, username: "dana", displayName: "Dana", isAdmin: false, setupDone: false }) }),
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Welcome to ByteSize, Dana" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    const entries = window.history.length;
    await userEvent.type(screen.getByLabelText("New password"), "dana-password-1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "dana-password-1");
    await userEvent.click(screen.getByRole("button", { name: "Set password and sign in" }));
    expect(await screen.findByRole("heading", { name: "Set up ByteSize", level: 1 })).toBeInTheDocument(); // first-run setup
    expect(window.location.hash).toBe("#/");
    expect(getToken()).toBe("dana-token");
    // The used token is gone from the address and from history: replaced, not a new entry Back returns past (§46)
    expect(window.history.length).toBe(entries);
    expect(window.location.href).not.toContain("abcDEF123_-");
  });

  it("a session that expires (401) forgets the remembered date look like signing out (§46)", async () => {
    setToken("t0k");
    localStorage.setItem("bytesize-look:1", JSON.stringify({ dateFormat: "iso", weekStart: 1 }));
    fakeServer({
      "GET /api/auth/status": () => ({ setupRequired: false, passwords: true }),
      "GET /api/auth/me": () => ({ user: userJson() }),
      "GET /api/settings/me": () => ({ status: 401, json: { error: "Not logged in" } }),
    });
    window.location.hash = "#/settings";
    render(<App />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(localStorage.getItem("bytesize-look:1")).toBeNull();
  });

  it("signing out forgets the person's remembered date look on this device", async () => {
    setToken("t0k");
    localStorage.setItem("bytesize-look:1", JSON.stringify({ dateFormat: "iso", weekStart: 1 }));
    fakeServer({
      "GET /api/auth/status": () => ({ setupRequired: false, passwords: true }),
      "GET /api/auth/me": () => ({ user: userJson() }),
      "POST /api/auth/logout": () => ({ ok: true }),
    });
    window.location.hash = "#/settings";
    render(<App />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(localStorage.getItem("bytesize-look:1")).toBeNull();
  });
});
