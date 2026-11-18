import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinkMyAccount, OAuthSettings } from "./OAuthSettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { restoreClipboard } from "../../test/clipboard";
import { browser } from "../../oauth";

const realGo = browser.go;
afterEach(() => {
  browser.go = realGo;
  restoreClipboard();
});

const off = { enabled: false, providerName: "OAuth", issuerUrl: null, clientId: "", clientSecretSet: false, clientSecretUnreadable: false, oauthOnly: false, ready: false };
const on = { enabled: true, providerName: "Authentik", issuerUrl: "https://auth.lan/application/o/bytesize/", clientId: "bs-client", clientSecretSet: true, clientSecretUnreadable: false, oauthOnly: false, ready: true };

describe("Settings › Security › OAuth sign-in (admin)", () => {
  it("shows the redirect URI to copy, saves the provider, and tests the connection", async () => {
    let current = off;
    const server = fakeServer({
      "GET /api/settings/oauth": () => ({ settings: current }),
      "PUT /api/settings/oauth": (b) => ({ settings: (current = { ...on, providerName: b.providerName, issuerUrl: b.issuerUrl, clientId: b.clientId }) }),
      "POST /api/settings/oauth/test": () => ({ ok: true, issuer: "https://auth.lan/application/o/bytesize/", message: "Reached https://auth.lan/application/o/bytesize/. Next, use Link my account to sign in with it once." }),
    });
    renderWithSession(<OAuthSettings />);
    expect(await screen.findByText(`${window.location.origin}/api/auth/oauth/callback`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "OAuth sign-in" }));
    await userEvent.clear(screen.getByLabelText("Button name"));
    await userEvent.type(screen.getByLabelText("Button name"), "Authentik");
    await userEvent.type(screen.getByLabelText("Issuer URL"), "https://auth.lan/application/o/bytesize/");
    await userEvent.type(screen.getByLabelText("Client ID"), "bs-client");
    await userEvent.type(screen.getByLabelText("Client secret"), "bs-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(server.writes().find((w) => w.method === "PUT")?.body).toEqual({ enabled: true, providerName: "Authentik", issuerUrl: "https://auth.lan/application/o/bytesize/", clientId: "bs-client", clientSecret: "bs-secret", oauthOnly: false });
    expect(screen.getByLabelText("Client secret")).toHaveValue(""); // saved: never shown again unless asked
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Reached https:\/\/auth.lan/)).toBeInTheDocument();
  });

  it("the eye fetches the saved client secret; a blank box keeps it", async () => {
    const server = fakeServer({
      "GET /api/settings/oauth": () => ({ settings: on }),
      "GET /api/settings/oauth/secret": () => ({ key: "bs-secret" }),
      "PUT /api/settings/oauth": (b) => ({ settings: { ...on, ...b } }),
    });
    renderWithSession(<OAuthSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Show client secret" }));
    expect(await screen.findByDisplayValue("bs-secret")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes().find((w) => w.method === "PUT")?.body).not.toHaveProperty("clientSecret");
  });

  it("OAuth only: the server's refusal (link your account first) is shown", async () => {
    fakeServer({
      "GET /api/settings/oauth": () => ({ settings: on }),
      "PUT /api/settings/oauth": () => ({ status: 400, json: { error: "Link your account first (Link my account): that signs in with the provider once, so you know it works before passwords are turned off." } }),
    });
    renderWithSession(<OAuthSettings />);
    await userEvent.click(await screen.findByRole("switch", { name: "OAuth only" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Link your account first");
  });
});

describe("Settings › Security › Link my account (everyone)", () => {
  it("hidden while OAuth is off", async () => {
    const server = fakeServer({ "GET /api/auth/oauth": () => ({ available: false, providerName: "OAuth", linked: null }) });
    const { container } = renderWithSession(<LinkMyAccount />, { isAdmin: false });
    await vi.waitFor(() => expect(server.sent).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("Link my account goes to the provider", async () => {
    const go = vi.fn();
    browser.go = go;
    fakeServer({
      "GET /api/auth/oauth": () => ({ available: true, providerName: "Authentik", linked: null }),
      "POST /api/auth/oauth/link/start": () => ({ url: "https://auth.lan/authorize?state=s1" }),
    });
    renderWithSession(<LinkMyAccount />, { isAdmin: false });
    expect(await screen.findByText(/Not linked/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Link my account" }));
    expect(go).toHaveBeenCalledWith("https://auth.lan/authorize?state=s1");
  });

  it("linked: shows the provider's email, says it worked when coming back, and unlinks", async () => {
    window.location.hash = "#/settings/security?oauth=linked";
    let linked: { email: string } | null = { email: "cory@corp.example" };
    const server = fakeServer({
      "GET /api/auth/oauth": () => ({ available: true, providerName: "Authentik", linked }),
      "POST /api/auth/oauth/unlink": () => {
        linked = null;
        return { ok: true };
      },
    });
    renderWithSession(<LinkMyAccount />, { isAdmin: false });
    expect(await screen.findByText(/Linked to Authentik as cory@corp.example/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Your account is linked");
    expect(window.location.hash).toBe("#/settings/security");
    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(await screen.findByText(/Not linked/)).toBeInTheDocument();
    expect(server.writes().map((w) => w.path)).toEqual(["/api/auth/oauth/unlink"]);
  });

  it("coming back with a problem says what it was", async () => {
    window.location.hash = `#/settings/security?${new URLSearchParams({ oauth_error: "That identity is linked to another account." })}`;
    fakeServer({ "GET /api/auth/oauth": () => ({ available: true, providerName: "Authentik", linked: null }) });
    renderWithSession(<LinkMyAccount />, { isAdmin: false });
    expect(await screen.findByRole("alert")).toHaveTextContent("That identity is linked to another account.");
  });
});
