import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmailSettings from "./EmailSettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { restoreClipboard } from "../../test/clipboard";

afterEach(restoreClipboard);

const nothing = { source: "none", active: false, settings: null, env: { available: false, host: null }, accountEmail: "cory@example.com" };
const saved = {
  source: "app",
  active: true,
  settings: { enabled: true, host: "smtp.gmail.com", port: 587, security: "starttls", username: "cory@gmail.com", passwordSet: true, passwordUnreadable: false, fromName: "ByteSize", fromAddress: "cory@gmail.com", appUrl: "https://bytesize.example.com" },
  env: { available: false, host: null },
  accountEmail: "cory@example.com",
};

describe("Settings › Email", () => {
  it("set up from a preset: Send test email first, then Save", async () => {
    let current: unknown = nothing;
    const server = fakeServer({
      "GET /api/settings/email": () => current,
      "POST /api/settings/email/test": (b) => ({ ok: true, to: b.to ?? "cory@example.com" }),
      "PUT /api/settings/email": () => {
        current = saved;
        return { ok: true };
      },
    });
    renderWithSession(<EmailSettings />);
    expect(await screen.findByText(/Not set up yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Send email from ByteSize" }));
    await userEvent.selectOptions(screen.getByLabelText("Provider"), "gmail");
    expect(screen.getByText(/app password/)).toBeInTheDocument(); // the preset's hint
    await userEvent.type(screen.getByLabelText("From address"), "cory@gmail.com");
    await userEvent.type(screen.getByLabelText("Username"), "cory@gmail.com");
    await userEvent.type(screen.getByLabelText("Password"), "app-password-123");
    // Save waits for a test that went through
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Send a test email first/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send test email" }));
    expect(await screen.findByText(/Test email sent to cory@example.com/)).toBeInTheDocument();
    const test = server.sent.find((s) => s.path === "/api/settings/email/test")!.body;
    expect(test.settings).toMatchObject({ enabled: true, host: "smtp.gmail.com", port: 587, security: "starttls", username: "cory@gmail.com", password: "app-password-123", fromAddress: "cory@gmail.com", appUrl: window.location.origin });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved. Email is on.")).toBeInTheDocument();
    expect(server.writes().find((w) => w.method === "PUT")?.body).toMatchObject({ enabled: true, host: "smtp.gmail.com", password: "app-password-123" });
  });

  it("changing the connection after a test needs a new test", async () => {
    fakeServer({
      "GET /api/settings/email": () => nothing,
      "POST /api/settings/email/test": () => ({ ok: true, to: "cory@example.com" }),
    });
    renderWithSession(<EmailSettings />);
    await userEvent.click(await screen.findByRole("switch", { name: "Send email from ByteSize" }));
    await userEvent.selectOptions(screen.getByLabelText("Provider"), "fastmail");
    await userEvent.type(screen.getByLabelText("From address"), "me@fastmail.com");
    await userEvent.click(screen.getByRole("button", { name: "Send test email" }));
    await screen.findByText(/Test email sent/);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await userEvent.type(screen.getByLabelText("Password"), "x");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a failed test says why, and Save stays off", async () => {
    fakeServer({
      "GET /api/settings/email": () => nothing,
      "POST /api/settings/email/test": () => ({ status: 502, json: { error: "Couldn't send: Invalid login: 535" } }),
    });
    renderWithSession(<EmailSettings />);
    await userEvent.click(await screen.findByRole("switch", { name: "Send email from ByteSize" }));
    await userEvent.selectOptions(screen.getByLabelText("Provider"), "gmail");
    await userEvent.type(screen.getByLabelText("From address"), "cory@gmail.com");
    await userEvent.click(screen.getByRole("button", { name: "Send test email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't send: Invalid login: 535");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saved settings: the password never shows until the eye fetches it; server, port and security are under More options", async () => {
    const server = fakeServer({
      "GET /api/settings/email": () => saved,
      "GET /api/settings/email/password": () => ({ key: "app-password-123" }),
      "PUT /api/settings/email": () => ({ ok: true }),
    });
    renderWithSession(<EmailSettings />);
    expect(await screen.findByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Provider")).toHaveValue("gmail");
    expect(screen.queryByLabelText("Email server")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByLabelText("Email server")).toHaveValue("smtp.gmail.com");
    expect(screen.getByLabelText("Port")).toHaveValue("587");
    expect(screen.getByLabelText("Security")).toHaveValue("starttls");
    await userEvent.click(screen.getByRole("button", { name: "Show email password" }));
    expect(await screen.findByDisplayValue("app-password-123")).toBeInTheDocument();
    expect(server.sent.some((s) => s.path === "/api/settings/email/password")).toBe(true);
    // the connection works already: changing the app's address saves without a new test, and keeps the password
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await userEvent.clear(screen.getByLabelText("ByteSize's address"));
    await userEvent.type(screen.getByLabelText("ByteSize's address"), "https://food.example.com");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const put = server.writes().find((w) => w.method === "PUT")!.body;
    expect(put.appUrl).toBe("https://food.example.com");
    expect(put).not.toHaveProperty("password");
  });

  it("turning email off saves at once", async () => {
    const server = fakeServer({
      "GET /api/settings/email": () => saved,
      "PUT /api/settings/email": () => ({ ok: true }),
    });
    renderWithSession(<EmailSettings />);
    await userEvent.click(await screen.findByRole("switch", { name: "Send email from ByteSize" }));
    expect(server.writes().find((w) => w.method === "PUT")?.body).toMatchObject({ enabled: false });
  });

  it("says when .env provides email", async () => {
    fakeServer({ "GET /api/settings/email": () => ({ ...nothing, source: "env", active: true, env: { available: true, host: "mail.lan:25" } }) });
    renderWithSession(<EmailSettings />);
    expect(await screen.findByText(/mail\.lan:25/)).toBeInTheDocument();
  });
});
