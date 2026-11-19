import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UsersSettings from "./UsersSettings";
import { fakeServer, userJson } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

// A row exactly as GET /api/admin/users sends it
const row = (over: Record<string, unknown> = {}) => ({ ...userJson(over), disabled: false, createdAt: "2026-11-16T12:00:00.000Z", lastSeenAt: null, invited: false, inviteSentAt: null, ...over });
const invitedRow = (over: Record<string, unknown> = {}) => row({ id: 2, username: "dana", displayName: "Dana Smith", email: "dana@example.com", isAdmin: false, setupDone: false, invited: true, inviteSentAt: "2026-11-17T15:00:00.000Z", ...over });

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

  it("Invite by email: name, a username suggested from the email (editable), and the email; the person shows as Invited", async () => {
    const server = fakeServer({
      "GET /api/admin/users": () => ({ users: [row()], canInvite: true }),
      "POST /api/admin/invites": (b) => ({ user: invitedRow({ username: b.username, displayName: b.name, email: b.email }) }),
    });
    renderWithSession(<UsersSettings />);
    await screen.findByText("alex");
    expect(screen.getByRole("button", { name: "Add person" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Invite by email" }));
    const form = screen.getByRole("form", { name: "Invite by email" });
    await userEvent.type(within(form).getByLabelText("Name"), "Dana Smith");
    await userEvent.type(within(form).getByLabelText("Email"), "Dana.Smith@example.com");
    expect(within(form).getByLabelText("Username")).toHaveValue("dana.smith");
    await userEvent.clear(within(form).getByLabelText("Username"));
    await userEvent.type(within(form).getByLabelText("Username"), "dana");
    await userEvent.type(within(form).getByLabelText("Email"), "{backspace}m"); // typing on in the email leaves an edited username alone
    expect(within(form).getByLabelText("Username")).toHaveValue("dana");
    await userEvent.click(within(form).getByRole("button", { name: "Send invite" }));

    const dana = await screen.findByRole("listitem", { name: "dana" });
    expect(within(dana).getByText("Invited")).toBeInTheDocument();
    expect(within(dana).getByText(/Dana\.Smith@example\.com/)).toBeInTheDocument();
    expect(within(dana).getByText(/Sent Nov 17, 2026/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Invite sent to Dana.Smith@example.com");
    expect(server.writes()).toEqual([expect.objectContaining({ method: "POST", path: "/api/admin/invites", body: { name: "Dana Smith", username: "dana", email: "Dana.Smith@example.com" } })]);
  });

  it("without email set up, Invite by email is shown turned off with how to fix it", async () => {
    fakeServer({ "GET /api/admin/users": () => ({ users: [row()], canInvite: false }) });
    renderWithSession(<UsersSettings />);
    await screen.findByText("alex");
    expect(screen.getByRole("button", { name: "Invite by email" })).toBeDisabled();
    expect(screen.getByText("Set up email in Settings › Email to invite people")).toBeInTheDocument();
  });

  it("an invite whose email didn't go through: the person is listed and the admin is told", async () => {
    fakeServer({
      "GET /api/admin/users": () => ({ users: [row()], canInvite: true }),
      "POST /api/admin/invites": () => ({ user: invitedRow(), emailError: "The invite couldn't be emailed: Connection timed out. Press Resend to try again." }),
    });
    renderWithSession(<UsersSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Invite by email" }));
    const form = screen.getByRole("form", { name: "Invite by email" });
    await userEvent.type(within(form).getByLabelText("Name"), "Dana");
    await userEvent.type(within(form).getByLabelText("Email"), "dana@example.com");
    await userEvent.click(within(form).getByRole("button", { name: "Send invite" }));
    expect(await screen.findByRole("listitem", { name: "dana" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The invite couldn't be emailed: Connection timed out. Press Resend to try again.");
  });

  it("an invited person has Resend and Cancel invite (which asks first), not the account controls", async () => {
    const server = fakeServer({
      "GET /api/admin/users": () => ({ users: [row(), invitedRow()], canInvite: true }),
      "POST /api/admin/invites/:id/resend": () => ({ user: invitedRow({ inviteSentAt: "2026-11-18T09:00:00.000Z" }) }),
      "DELETE /api/admin/invites/:id": () => ({ status: 204 }),
    });
    renderWithSession(<UsersSettings />);
    const dana = await screen.findByRole("listitem", { name: "dana" });
    expect(within(dana).queryByRole("button", { name: "Reset password" })).not.toBeInTheDocument();
    expect(within(dana).queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
    await userEvent.click(within(dana).getByRole("button", { name: "Resend" }));
    expect(await within(dana).findByText(/Sent Nov 18, 2026/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("A new invite link went to dana@example.com. The old one no longer works.");
    await userEvent.click(within(dana).getByRole("button", { name: "Cancel invite" }));
    await userEvent.click(within(screen.getByRole("alertdialog", { name: "Cancel dana's invite?" })).getByRole("button", { name: "Cancel invite" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "dana" })).not.toBeInTheDocument());
    expect(server.writes().map((w) => `${w.method} ${w.path}`)).toEqual(["POST /api/admin/invites/2/resend", "DELETE /api/admin/invites/2"]);
  });
});
