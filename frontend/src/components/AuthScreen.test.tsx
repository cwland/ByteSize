import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuthScreen from "./AuthScreen";
import { fakeServer, userJson } from "../test/fakeServer";
import { browser } from "../oauth";

const status = (over: object = {}) => ({ setupRequired: false, passwords: true, forgotPassword: false, oauth: null, ...over });
const realGo = browser.go;
afterEach(() => {
  browser.go = realGo;
});

describe("sign-in screen", () => {
  it("no Forgot password when email isn't set up", async () => {
    fakeServer({ "GET /api/auth/status": () => status() });
    render(<AuthScreen onDone={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Forgot password?" })).not.toBeInTheDocument();
  });

  it("Forgot password: email, then the code and a new password, then signed in", async () => {
    const onDone = vi.fn();
    const server = fakeServer({
      "GET /api/auth/status": () => status({ forgotPassword: true }),
      "POST /api/auth/forgot": () => ({ ok: true, message: "If an account uses that email, we've sent a 6-digit code." }),
      "POST /api/auth/reset": (b) => (b.code === "123456" ? { token: "new-token", user: userJson() } : { status: 400, json: { error: "That code is wrong or has expired. Ask for a new one." } }),
    });
    render(<AuthScreen onDone={onDone} />);
    await userEvent.click(await screen.findByRole("button", { name: "Forgot password?" }));
    expect(screen.getByRole("heading", { name: "Forgot password" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText("If an account uses that email, we've sent a 6-digit code.")).toBeInTheDocument();
    expect(server.sent.find((s) => s.path === "/api/auth/forgot")?.body).toEqual({ email: "alex@example.com" });
    // a wrong code says so and keeps the form
    await userEvent.type(screen.getByLabelText("6-digit code"), "999999");
    await userEvent.type(screen.getByLabelText("New password"), "brand-new-pass");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "brand-new-pass");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is wrong or has expired");
    await userEvent.clear(screen.getByLabelText("6-digit code"));
    await userEvent.type(screen.getByLabelText("6-digit code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith("new-token", expect.objectContaining({ username: "alex" })));
    expect(server.sent.filter((s) => s.path === "/api/auth/reset").at(-1)?.body).toEqual({ email: "alex@example.com", code: "123456", newPassword: "brand-new-pass" });
  });

  it("Forgot password: the new passwords must match; Back returns to sign in", async () => {
    const server = fakeServer({
      "GET /api/auth/status": () => status({ forgotPassword: true }),
      "POST /api/auth/forgot": () => ({ ok: true, message: "If an account uses that email, we've sent a 6-digit code." }),
    });
    render(<AuthScreen onDone={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Forgot password?" }));
    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await userEvent.type(await screen.findByLabelText("6-digit code"), "123456");
    await userEvent.type(screen.getByLabelText("New password"), "brand-new-pass");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "other-pass-123");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The new passwords don't match");
    expect(server.sent.some((s) => s.path === "/api/auth/reset")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("a Sign in with … button when OAuth is on; it goes to the provider", async () => {
    const go = vi.fn();
    browser.go = go;
    const server = fakeServer({
      "GET /api/auth/status": () => status({ oauth: { label: "Authentik" } }),
      "POST /api/auth/oauth/start": () => ({ url: "https://idp.example.com/authorize?state=abc" }),
    });
    render(<AuthScreen onDone={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in with Authentik" }));
    expect(server.sent.some((s) => s.method === "POST" && s.path === "/api/auth/oauth/start")).toBe(true);
    expect(go).toHaveBeenCalledWith("https://idp.example.com/authorize?state=abc");
    expect(screen.getByLabelText("Password")).toBeInTheDocument(); // passwords still offered
  });

  it("OAuth only: no password form and no Forgot password", async () => {
    fakeServer({ "GET /api/auth/status": () => status({ passwords: false, oauth: { label: "Authentik" } }) });
    render(<AuthScreen onDone={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Sign in with Authentik" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Forgot password?" })).not.toBeInTheDocument();
  });

  it("back from the provider with a ticket: swaps it for a sign-in", async () => {
    window.location.hash = "#/oauth?ticket=tkt-1";
    const onDone = vi.fn();
    const server = fakeServer({
      "GET /api/auth/status": () => status({ oauth: { label: "Authentik" } }),
      "POST /api/auth/oauth/finish": () => ({ token: "oauth-token", user: userJson() }),
    });
    render(<AuthScreen onDone={onDone} />);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith("oauth-token", expect.objectContaining({ username: "alex" })));
    expect(server.sent.find((s) => s.path === "/api/auth/oauth/finish")?.body).toEqual({ ticket: "tkt-1" });
  });

  it("back from the provider with a problem: says what it was", async () => {
    window.location.hash = `#/?${new URLSearchParams({ oauth_error: "This Authentik account isn't linked to ByteSize." })}`;
    fakeServer({ "GET /api/auth/status": () => status({ oauth: { label: "Authentik" } }) });
    render(<AuthScreen onDone={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This Authentik account isn't linked to ByteSize.");
  });
});
