import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UsersSettings from "./UsersSettings";
import { fakeServer, userJson } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

// A row exactly as GET /api/admin/users sends it
const row = (over: Record<string, unknown> = {}) => ({ ...userJson(over), disabled: false, createdAt: "2026-11-16T12:00:00.000Z", lastSeenAt: null, ...over });

describe("UsersSettings", () => {
  it("admin adds a person", async () => {
    const server = fakeServer({
      "GET /api/admin/users": () => ({ users: [row()] }),
      "POST /api/admin/users": (b) => ({ user: row({ id: 2, username: b.username, displayName: null, isAdmin: b.isAdmin }) }),
    });
    renderWithSession(<UsersSettings />);
    await screen.findByText("alex");

    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    const form = screen.getByRole("form", { name: "Add person" });
    await userEvent.type(within(form).getByLabelText("Username"), "sam");
    await userEvent.type(within(form).getByLabelText("Password"), "password123");
    await userEvent.click(within(form).getByRole("button", { name: "Add" }));

    expect(await screen.findByText("sam")).toBeInTheDocument();
    expect(server.writes()).toEqual([expect.objectContaining({ method: "POST", path: "/api/admin/users", body: { username: "sam", password: "password123", isAdmin: false } })]);
  });

  it("server's last-admin error is shown", async () => {
    fakeServer({
      "GET /api/admin/users": () => ({ users: [row()] }),
      "PATCH /api/admin/users/:id": () => ({ status: 409, json: { error: "ByteSize needs at least one admin" } }),
    });
    renderWithSession(<UsersSettings />);
    const alex = await screen.findByRole("listitem", { name: "alex" });
    await userEvent.click(within(alex).getByRole("button", { name: "Turn off" }));
    expect(await screen.findByText("ByteSize needs at least one admin")).toBeInTheDocument();
  });
});
