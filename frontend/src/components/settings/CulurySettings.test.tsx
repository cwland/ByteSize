import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CulurySettings from "./CulurySettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { restoreClipboard, stubClipboard } from "../../test/clipboard";

afterEach(restoreClipboard);

const linked = { url: "http://culury.lan:4000", hasKey: true };
const unlinked = { url: null, hasKey: false };

describe("Culury settings", () => {
  it("saves the address and key, then only says a key is saved", async () => {
    let link: { url: string | null; hasKey: boolean } = unlinked;
    const server = fakeServer({
      "GET /api/settings/culury": () => link,
      "PUT /api/settings/culury": (b) => (link = { url: b.url, hasKey: true }),
    });
    renderWithSession(<CulurySettings />, { isAdmin: false });
    expect(await screen.findByText(/Not linked yet/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Culury address"), "http://culury.lan:4000");
    await userEvent.type(screen.getByLabelText("API key"), "cul_secret");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes().find((w) => w.method === "PUT")?.body).toEqual({ url: "http://culury.lan:4000", apiKey: "cul_secret" });
    expect(await screen.findByText("Culury linked")).toBeInTheDocument();
    expect(screen.getByText(/A key is saved/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("cul_secret")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Culury address")).toHaveValue("http://culury.lan:4000");
  });

  it("with a saved link, the address shows, the key never does, and Save without a key keeps it", async () => {
    const server = fakeServer({
      "GET /api/settings/culury": () => linked,
      "PUT /api/settings/culury": (b) => ({ url: b.url, hasKey: true }),
    });
    renderWithSession(<CulurySettings />, { isAdmin: false });
    expect(await screen.findByLabelText("Culury address")).toHaveValue("http://culury.lan:4000");
    expect(screen.getByText(/A key is saved/)).toBeInTheDocument();
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.getByLabelText("API key")).toHaveAttribute("autocomplete", "new-password"); // no browser autofill of a saved password
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes().find((w) => w.method === "PUT")?.body).toEqual({ url: "http://culury.lan:4000" });
  });

  it("a refused save shows the server's message", async () => {
    fakeServer({
      "GET /api/settings/culury": () => unlinked,
      "PUT /api/settings/culury": () => ({ status: 400, json: { error: "Enter Culury's API key (Culury › Settings › API keys, Read only)" } }),
    });
    renderWithSession(<CulurySettings />, { isAdmin: false });
    await userEvent.type(await screen.findByLabelText("Culury address"), "http://culury.lan:4000");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter Culury's API key");
  });

  it("Test connection tests the saved link, or what's typed before saving", async () => {
    let answer: unknown = { ok: true, message: "Connected to Culury" };
    const server = fakeServer({
      "GET /api/settings/culury": () => linked,
      "POST /api/settings/culury/test": () => answer,
    });
    renderWithSession(<CulurySettings />, { isAdmin: false });
    await userEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Connected to Culury");
    expect(server.writes()[0].body).toBeUndefined(); // the saved link

    answer = { status: 400, json: { error: "Culury didn't accept the API key" } };
    await userEvent.type(screen.getByLabelText("API key"), "new_key");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Culury didn't accept the API key");
    expect(server.writes()[1].body).toEqual({ url: "http://culury.lan:4000", apiKey: "new_key" });
  });

  it("Remove unlinks Culury", async () => {
    const server = fakeServer({
      "GET /api/settings/culury": () => linked,
      "DELETE /api/settings/culury": () => unlinked,
    });
    renderWithSession(<CulurySettings />, { isAdmin: false });
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(server.writes().map((w) => w.method)).toEqual(["DELETE"]);
    expect(await screen.findByText(/Not linked yet/)).toBeInTheDocument();
    expect(screen.getByLabelText("Culury address")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("the eye shows the saved key (fetched only then) and hides it; Save afterwards keeps the saved key", async () => {
    const server = fakeServer({
      "GET /api/settings/culury": () => linked,
      "GET /api/settings/culury/key": () => ({ key: "cul_saved_key" }),
      "PUT /api/settings/culury": (b) => ({ url: b.url, hasKey: true }),
    });
    renderWithSession(<CulurySettings />, { isAdmin: false });
    const key = await screen.findByLabelText("API key");
    expect(server.sent.some((r) => r.path === "/api/settings/culury/key")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Show Culury key" }));
    expect(await screen.findByDisplayValue("cul_saved_key")).toBe(key);
    expect(key).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes().find((w) => w.method === "PUT")?.body).toEqual({ url: "http://culury.lan:4000" }); // not sent back as a new key
    await userEvent.click(screen.getByRole("button", { name: "Hide Culury key" }));
    expect(key).toHaveValue("");
  });

  it("copy puts the saved key on the clipboard without showing it", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard({ writeText });
    fakeServer({
      "GET /api/settings/culury": () => linked,
      "GET /api/settings/culury/key": () => ({ key: "cul_saved_key" }),
    });
    renderWithSession(<CulurySettings />, { isAdmin: false });
    await userEvent.click(await screen.findByRole("button", { name: "Copy Culury key" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("cul_saved_key");
    expect(screen.queryByDisplayValue("cul_saved_key")).not.toBeInTheDocument();
  });

  it("a saved key that can't be read says so", async () => {
    fakeServer({
      "GET /api/settings/culury": () => linked,
      "GET /api/settings/culury/key": () => ({ status: 409, json: { error: "This key can't be read. Enter it again." } }),
    });
    renderWithSession(<CulurySettings />, { isAdmin: false });
    await userEvent.click(await screen.findByRole("button", { name: "Show Culury key" }));
    expect(await screen.findByText("This key can't be read. Enter it again.")).toBeInTheDocument();
  });
});
