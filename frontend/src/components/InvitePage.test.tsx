import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InvitePage, { inviteTokenFromHash } from "./InvitePage";
import { fakeServer, userJson } from "../test/fakeServer";

const TOKEN = "tok_" + "a".repeat(39);
const EXPIRED = "This invite link has expired or was already used. Ask Cory Landers for a new one.";

describe("the invite page (#/invite/<token>)", () => {
  it("reads the token from the address", () => {
    expect(inviteTokenFromHash(`#/invite/${TOKEN}`)).toBe(TOKEN);
    expect(inviteTokenFromHash("#/invite/")).toBeNull();
    expect(inviteTokenFromHash("#/settings")).toBeNull();
  });

  it("welcomes the person by name, shows the username read-only, and signs them in with the password they choose", async () => {
    const onDone = vi.fn();
    const server = fakeServer({
      "POST /api/invites/check": () => ({ name: "Dana Smith", username: "dana" }),
      "POST /api/invites/accept": () => ({ token: "login-token", user: userJson({ id: 2, username: "dana", isAdmin: false, setupDone: false }) }),
    });
    render(<InvitePage token={TOKEN} onDone={onDone} />);
    expect(await screen.findByRole("heading", { name: "Welcome to ByteSize, Dana Smith" })).toBeInTheDocument();
    const username = screen.getByLabelText("Username");
    expect(username).toHaveValue("dana");
    expect(username).toHaveAttribute("readOnly");
    expect(username).toHaveAttribute("autocomplete", "username");
    const pw = screen.getByLabelText("New password");
    expect(pw).toHaveAttribute("autocomplete", "new-password");
    expect(pw).toHaveAttribute("minLength", "8");
    await userEvent.type(pw, "dana-password-1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "dana-password-1");
    await userEvent.click(screen.getByRole("button", { name: "Set password and sign in" }));
    expect(onDone).toHaveBeenCalledWith("login-token", expect.objectContaining({ username: "dana" }));
    expect(server.sent.filter((s) => s.method === "POST").map((s) => s.body)).toEqual([{ token: TOKEN }, { token: TOKEN, password: "dana-password-1" }]);
  });

  it("the two passwords must match", async () => {
    const server = fakeServer({ "POST /api/invites/check": () => ({ name: "Dana", username: "dana" }) });
    render(<InvitePage token={TOKEN} onDone={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText("New password"), "dana-password-1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "dana-password-2");
    await userEvent.click(screen.getByRole("button", { name: "Set password and sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The passwords don't match");
    expect(server.sent.map((s) => s.path)).not.toContain("/api/invites/accept");
  });

  it("an expired or used link says so, and offers the sign-in screen", async () => {
    fakeServer({ "POST /api/invites/check": () => ({ status: 410, json: { error: EXPIRED } }) });
    render(<InvitePage token={TOKEN} onDone={vi.fn()} />);
    expect(await screen.findByText(EXPIRED)).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "#/");
  });

  it("a link that stops working while the page is open: the answer is shown", async () => {
    fakeServer({ "POST /api/invites/check": () => ({ name: "Dana", username: "dana" }), "POST /api/invites/accept": () => ({ status: 410, json: { error: EXPIRED } }) });
    render(<InvitePage token={TOKEN} onDone={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText("New password"), "dana-password-1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "dana-password-1");
    await userEvent.click(screen.getByRole("button", { name: "Set password and sign in" }));
    expect(await screen.findByText(EXPIRED)).toBeInTheDocument();
  });
});
