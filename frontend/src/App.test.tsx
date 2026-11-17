import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import App from "./App";
import { setToken } from "./api";
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

  it("signed in shows Dashboard, Log, Goals and Settings, and a Log food button", async () => {
    setToken("t0k");
    fakeServer({
      "GET /api/auth/status": () => ({ setupRequired: false, passwords: true }),
      "GET /api/auth/me": () => ({ user: userJson() }),
    });
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    for (const name of ["Dashboard", "Log", "Goals", "Settings"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole("link", { name: "My foods" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log food" })).toBeInTheDocument();
  });
});
