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
    for (const name of ["Users", "AI services", "Food sources", "Logs"]) {
      expect(screen.queryByRole("tab", { name })).not.toBeInTheDocument();
    }
  });

  it("admins see Users, AI services and Logs", async () => {
    fakeServer({});
    renderWithSession(<SettingsPage />, { isAdmin: true });
    for (const name of ["Profile", "Security", "Integrations", "Users", "AI services", "Food sources", "Logs"]) {
      expect(await screen.findByRole("tab", { name })).toBeInTheDocument();
    }
  });
});
