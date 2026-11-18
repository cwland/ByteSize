import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ApiKeysSettings from "./ApiKeysSettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { restoreClipboard, stubClipboard } from "../../test/clipboard";
import { todayIn } from "../../selectedDay";

// A key exactly as GET /api/keys lists it (never the key itself)
const keyRow = (over: Record<string, unknown> = {}) => ({ id: 1, name: "Home Assistant", prefix: "bs_3f9aK2xQ", access: "read", createdAt: "2026-11-10T15:00:00.000Z", lastUsedAt: null, ...over });
const NEW_KEY = "bs_" + "Z".repeat(43);
afterEach(() => restoreClipboard());

describe("Settings › API keys", () => {
  it("lists the person's keys: name, first characters, access, created and last used", async () => {
    fakeServer({ "GET /api/keys": () => ({ keys: [keyRow(), keyRow({ id: 2, name: "n8n", prefix: "bs_77aaBBcc", access: "log", lastUsedAt: "2026-11-17T09:30:00.000Z" })] }) });
    renderWithSession(<ApiKeysSettings />);
    const ha = await screen.findByRole("listitem", { name: "Home Assistant" });
    expect(within(ha).getByText("bs_3f9aK2xQ…")).toBeInTheDocument();
    expect(within(ha).getByText("Read only")).toBeInTheDocument();
    expect(within(ha).getByText(/Made Nov 10, 2026/)).toBeInTheDocument();
    expect(within(ha).getByText(/Last used Never/)).toBeInTheDocument();
    const n8n = screen.getByRole("listitem", { name: "n8n" });
    expect(within(n8n).getByText("Read and log")).toBeInTheDocument();
    expect(within(n8n).queryByText(/Last used Never/)).not.toBeInTheDocument();
  });

  it("says so when there are no keys yet", async () => {
    fakeServer({ "GET /api/keys": () => ({ keys: [] }) });
    renderWithSession(<ApiKeysSettings />);
    expect(await screen.findByText("No keys yet.")).toBeInTheDocument();
  });

  it("New key: a name and Read only by default; the key is shown right away with copy, and the list gains it", async () => {
    const clip = stubClipboard({ writeText: async () => {} })!;
    const server = fakeServer({
      "GET /api/keys": () => ({ keys: [] }),
      "POST /api/keys": (b) => ({ status: 201, json: { ...keyRow({ id: 7, name: b.name, access: b.access, prefix: NEW_KEY.slice(0, 11) }), key: NEW_KEY } }),
    });
    renderWithSession(<ApiKeysSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "New key" }));
    const form = screen.getByRole("form", { name: "New key" });
    const name = within(form).getByLabelText("Name");
    expect(name).toBeRequired();
    expect(name).toHaveAttribute("maxLength", "60");
    expect(within(form).getByRole("radio", { name: "Read only" })).toHaveAttribute("aria-checked", "true");
    await userEvent.type(name, "Shortcuts");
    await userEvent.click(within(form).getByRole("button", { name: "Make key" }));

    const shown = await screen.findByLabelText("Your new key");
    expect(shown).toHaveValue(NEW_KEY);
    expect(shown).toHaveAttribute("type", "text");
    expect(shown).toHaveAttribute("readOnly");
    expect(screen.getByText(/Copy it into your tool now/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy new key" }));
    expect(clip.writeText).toHaveBeenCalledWith(NEW_KEY);
    expect(server.writes()).toEqual([expect.objectContaining({ method: "POST", path: "/api/keys", body: { name: "Shortcuts", access: "read" } })]);
    expect(screen.getByRole("listitem", { name: "Shortcuts" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Your new key")).not.toBeInTheDocument();
  });

  it("New key can be Read and log", async () => {
    const server = fakeServer({
      "GET /api/keys": () => ({ keys: [] }),
      "POST /api/keys": (b) => ({ status: 201, json: { ...keyRow({ name: b.name, access: b.access }), key: NEW_KEY } }),
    });
    renderWithSession(<ApiKeysSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "New key" }));
    const form = screen.getByRole("form", { name: "New key" });
    await userEvent.type(within(form).getByLabelText("Name"), "Logger");
    await userEvent.click(within(form).getByRole("radio", { name: "Read and log" }));
    expect(within(form).getByText(/add, edit and delete log entries, weigh-ins, water and shots/)).toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Make key" }));
    await screen.findByLabelText("Your new key");
    expect(server.writes()[0].body).toEqual({ name: "Logger", access: "log" });
  });

  it("shows the server's answer when a key can't be made (20 already)", async () => {
    fakeServer({
      "GET /api/keys": () => ({ keys: [] }),
      "POST /api/keys": () => ({ status: 409, json: { error: "You can have up to 20 keys. Delete one to make another." } }),
    });
    renderWithSession(<ApiKeysSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "New key" }));
    await userEvent.type(screen.getByLabelText("Name"), "One more");
    await userEvent.click(screen.getByRole("button", { name: "Make key" }));
    expect(await screen.findByText("You can have up to 20 keys. Delete one to make another.")).toBeInTheDocument();
  });

  it("the eye on a key fetches it from the owner's reveal route and shows it", async () => {
    const server = fakeServer({ "GET /api/keys": () => ({ keys: [keyRow()] }), "GET /api/keys/:id/key": () => ({ key: NEW_KEY }) });
    renderWithSession(<ApiKeysSettings />);
    const row = await screen.findByRole("listitem", { name: "Home Assistant" });
    await userEvent.click(within(row).getByRole("button", { name: "Show Home Assistant key" }));
    expect(await within(row).findByDisplayValue(NEW_KEY)).toBeInTheDocument();
    expect(server.sent.map((s) => s.path)).toContain("/api/keys/1/key");
  });

  it("renames a key", async () => {
    const server = fakeServer({ "GET /api/keys": () => ({ keys: [keyRow()] }), "PATCH /api/keys/:id": (b) => ({ key: keyRow({ name: b.name }) }) });
    renderWithSession(<ApiKeysSettings />);
    const row = await screen.findByRole("listitem", { name: "Home Assistant" });
    await userEvent.click(within(row).getByRole("button", { name: "Rename" }));
    const box = within(row).getByLabelText("New name");
    await userEvent.clear(box);
    await userEvent.type(box, "Kitchen HA");
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("listitem", { name: "Kitchen HA" })).toBeInTheDocument();
    expect(server.writes()).toEqual([expect.objectContaining({ method: "PATCH", path: "/api/keys/1", body: { name: "Kitchen HA" } })]);
  });

  it("changes a key's access", async () => {
    const server = fakeServer({ "GET /api/keys": () => ({ keys: [keyRow()] }), "PATCH /api/keys/:id": (b) => ({ key: keyRow({ access: b.access }) }) });
    renderWithSession(<ApiKeysSettings />);
    const row = await screen.findByRole("listitem", { name: "Home Assistant" });
    await userEvent.click(within(row).getByRole("button", { name: "Change access" }));
    await userEvent.click(within(row).getByRole("radio", { name: "Read and log" }));
    await waitFor(() => expect(within(row).getByText("Read and log", { selector: "span" })).toBeInTheDocument());
    expect(server.writes()).toEqual([expect.objectContaining({ method: "PATCH", path: "/api/keys/1", body: { access: "log" } })]);
  });

  it("Delete asks first, then the key is gone", async () => {
    const server = fakeServer({ "GET /api/keys": () => ({ keys: [keyRow()] }), "DELETE /api/keys/:id": () => ({ status: 204 }) });
    renderWithSession(<ApiKeysSettings />);
    const row = await screen.findByRole("listitem", { name: "Home Assistant" });
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    const ask = screen.getByRole("alertdialog", { name: "Delete Home Assistant?" });
    expect(within(ask).getByText(/stops working at once/)).toBeInTheDocument();
    expect(server.writes()).toEqual([]);
    await userEvent.click(within(ask).getByRole("button", { name: "Delete key" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Home Assistant" })).not.toBeInTheDocument());
    expect(server.writes()).toEqual([expect.objectContaining({ method: "DELETE", path: "/api/keys/1" })]);
  });

  it("How to use a key: the header line and two copyable curl examples with this server's address", async () => {
    const clip = stubClipboard({ writeText: async () => {} })!;
    fakeServer({ "GET /api/keys": () => ({ keys: [] }) });
    renderWithSession(<ApiKeysSettings />, { timezone: "America/Boise" });
    const help = await screen.findByRole("region", { name: "How to use a key" });
    expect(within(help).getByText("Authorization: Bearer <your key>")).toBeInTheDocument();
    const origin = window.location.origin;
    const today = todayIn("America/Boise");
    const day = `curl -H "Authorization: Bearer <your key>" ${origin}/api/day/${today}`;
    const water = `curl -X POST -H "Authorization: Bearer <your key>" -H "Content-Type: application/json" -d '{"water_ml": 250}' ${origin}/api/log`;
    expect(within(help).getByText(day)).toBeInTheDocument();
    expect(within(help).getByText(water)).toBeInTheDocument();
    await userEvent.click(within(help).getByRole("button", { name: "Copy the example for today's day" }));
    expect(clip.writeText).toHaveBeenLastCalledWith(day);
    await userEvent.click(within(help).getByRole("button", { name: "Copy the example for logging water" }));
    expect(clip.writeText).toHaveBeenLastCalledWith(water);
  });
});
