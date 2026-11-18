import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataSettings from "./DataSettings";
import { fakeServer } from "../../test/fakeServer";
import { backupList } from "../../test/fixtures";
import { renderWithSession } from "../../test/renderWithSession";

const restored = { restored: { schema: 12, users: 2, photos: 5 }, unreadableKeys: [] as string[] };

// The browser's save step is replaced: jsdom has no object URLs
const saved: string[] = [];
function stubSave() {
  saved.length = 0;
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
}
afterEach(() => vi.restoreAllMocks());

// fakeServer only speaks JSON, so a file answer is added on top of it
function withFile(routes: Parameters<typeof fakeServer>[0], files: Record<string, string>) {
  const server = fakeServer(routes);
  const json = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const filename = files[path];
    if (!filename) return json(input, init);
    (server.sent as unknown[]).push({ method: "GET", path, body: undefined, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return new Response("zipbytes", { headers: { "content-disposition": `attachment; filename="${filename}"` } });
  });
  return server;
}

describe("DataSettings", () => {
  it("a member sees only Your data and never asks for backups", async () => {
    const { sent } = fakeServer({});
    renderWithSession(<DataSettings />, { isAdmin: false });
    expect(screen.getByRole("region", { name: "Your data" })).toBeInTheDocument();
    expect(screen.getByText("A zip with your food log, weigh-ins, shots and foods as spreadsheets, plus everything else in one file.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Backups" })).not.toBeInTheDocument();
    expect(sent.filter((s) => s.path.startsWith("/api/admin/backups"))).toEqual([]);
  });

  it("Download my data fetches /api/export with the token and saves it under the server's name", async () => {
    stubSave();
    localStorage.setItem("bytesize.token", "tok");
    const { sent } = withFile({}, { "/api/export": "bytesize-cory-2026-11-17.zip" });
    renderWithSession(<DataSettings />, { isAdmin: false });
    await userEvent.click(screen.getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(saved).toEqual(["bytesize-cory-2026-11-17.zip"]));
    expect(sent.find((s) => s.path === "/api/export")?.headers.authorization).toBe("Bearer tok");
    localStorage.clear();
  });

  it("shows an export error in a notice", async () => {
    fakeServer({});
    renderWithSession(<DataSettings />, { isAdmin: false });
    await userEvent.click(screen.getByRole("button", { name: "Download my data" })); // the fake has no /api/export: 404
    expect(await screen.findByRole("alert")).toHaveTextContent("No fake for GET /api/export");
    expect(screen.getByRole("button", { name: "Download my data" })).toBeEnabled();
  });

  it("an admin sees the backups newest first with sizes and the before-restore tag", async () => {
    fakeServer({ "GET /api/admin/backups": () => backupList });
    renderWithSession(<DataSettings />);
    expect(await screen.findByText("ByteSize backs up everything each night and keeps the newest 14.")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("2.4 MB")).toBeInTheDocument();
    expect(within(rows[1]).getByText("1.0 MB")).toBeInTheDocument();
    expect(within(rows[1]).getByText("before restore")).toBeInTheDocument();
    expect(within(rows[0]).queryByText("before restore")).not.toBeInTheDocument();
    // Boise is UTC-7 in November: 09:00 UTC is 2:00 AM
    expect(within(rows[0]).getByText(/2:00\s?AM/)).toBeInTheDocument();
    for (const name of ["Download", "Restore", "Delete"]) expect(within(rows[0]).getByRole("button", { name })).toBeInTheDocument();
  });

  it("says when there are no backups", async () => {
    fakeServer({ "GET /api/admin/backups": () => ({ backups: [], keep: 14, unreadableKeys: [] }) });
    renderWithSession(<DataSettings />);
    expect(await screen.findByText("No backups yet.")).toBeInTheDocument();
  });

  it("Back up now posts and the new backup appears at the top", async () => {
    const made = { name: "bytesize-2026-11-17-153000.tar.gz", size: 3000000, createdAt: "2026-11-17T22:30:00.000Z" };
    let posted = false;
    const { writes } = fakeServer({
      "GET /api/admin/backups": () => (posted ? { ...backupList, backups: [made, ...backupList.backups] } : backupList),
      "POST /api/admin/backups": () => ((posted = true), { backup: made }),
    });
    renderWithSession(<DataSettings />);
    await screen.findByText("ByteSize backs up everything each night and keeps the newest 14.");
    await userEvent.click(screen.getByRole("button", { name: "Back up now" }));
    expect(await screen.findByText("2.9 MB")).toBeInTheDocument();
    expect(writes().map((w) => `${w.method} ${w.path}`)).toEqual(["POST /api/admin/backups"]);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(within(screen.getAllByRole("listitem")[0]).getByText("2.9 MB")).toBeInTheDocument();
  });

  it("Delete asks first, then sends DELETE", async () => {
    const { writes } = fakeServer({ "GET /api/admin/backups": () => backupList, "DELETE /api/admin/backups/:name": () => ({ status: 204 }) });
    renderWithSession(<DataSettings />);
    const row = (await screen.findAllByRole("listitem"))[2];
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(writes()).toEqual([]);
    expect(within(row).getByText("Delete this backup?")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Keep it" }));
    expect(writes()).toEqual([]);
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    await userEvent.click(within(row).getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(writes().map((w) => `${w.method} ${w.path}`)).toEqual(["DELETE /api/admin/backups/bytesize-2026-11-16-020000.tar.gz"]);
  });

  it("Download on a backup saves it with the token", async () => {
    stubSave();
    const { sent } = withFile({ "GET /api/admin/backups": () => backupList }, { "/api/admin/backups/bytesize-2026-11-17-020000.tar.gz": "bytesize-2026-11-17-020000.tar.gz" });
    renderWithSession(<DataSettings />);
    await userEvent.click(within((await screen.findAllByRole("listitem"))[0]).getByRole("button", { name: "Download" }));
    await waitFor(() => expect(saved).toEqual(["bytesize-2026-11-17-020000.tar.gz"]));
    expect(sent.some((s) => s.path === "/api/admin/backups/bytesize-2026-11-17-020000.tar.gz")).toBe(true);
  });

  it("Restore stays disabled until RESTORE is typed exactly, then posts and asks to sign in again", async () => {
    const { writes } = fakeServer({ "GET /api/admin/backups": () => backupList, "POST /api/admin/backups/restore": () => restored });
    const { session } = renderWithSession(<DataSettings />);
    await userEvent.click(within((await screen.findAllByRole("listitem"))[0]).getByRole("button", { name: "Restore" }));
    expect(screen.getByText(/Restoring replaces everything on this server — every person's data — with this backup\. A safety backup is saved first\. Everyone will need to sign in again\./)).toBeInTheDocument();
    const panel = screen.getByRole("group", { name: "Confirm restore" });
    const go = within(panel).getByRole("button", { name: "Restore" });
    const box = within(panel).getByLabelText("Type RESTORE to confirm");
    expect(go).toBeDisabled();
    await userEvent.type(box, "restore");
    expect(go).toBeDisabled();
    await userEvent.clear(box);
    await userEvent.type(box, "RESTORE");
    expect(go).toBeEnabled();
    await userEvent.click(go);
    expect(await screen.findByText("Restored. Sign in again to continue.")).toBeInTheDocument();
    expect(writes()[0]).toMatchObject({ method: "POST", path: "/api/admin/backups/restore", body: { name: "bytesize-2026-11-17-020000.tar.gz", confirm: "RESTORE" } });
    expect(session.signOut).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(session.signOut).toHaveBeenCalled();
  });

  it("disables everything while restoring", async () => {
    let finish: (v: unknown) => void = () => {};
    fakeServer({ "GET /api/admin/backups": () => backupList, "POST /api/admin/backups/restore": () => new Promise((r) => (finish = r)) });
    renderWithSession(<DataSettings />);
    await userEvent.click(within((await screen.findAllByRole("listitem"))[0]).getByRole("button", { name: "Restore" }));
    await userEvent.type(screen.getByLabelText("Type RESTORE to confirm"), "RESTORE");
    await userEvent.click(within(screen.getByRole("group", { name: "Confirm restore" })).getByRole("button", { name: "Restore" }));
    expect(await screen.findByRole("button", { name: "Restoring…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back up now" })).toBeDisabled();
    for (const b of screen.getAllByRole("button", { name: "Delete" })) expect(b).toBeDisabled();
    finish(restored);
    expect(await screen.findByText("Restored. Sign in again to continue.")).toBeInTheDocument();
  });

  it("restore from a file sends multipart with the confirmation", async () => {
    const { writes } = fakeServer({ "GET /api/admin/backups": () => backupList, "POST /api/admin/backups/restore": () => restored });
    renderWithSession(<DataSettings />);
    await screen.findAllByRole("listitem");
    const file = new File(["x"], "old.tar.gz", { type: "application/gzip" });
    const input = screen.getByLabelText("Restore from a file");
    expect(input).toHaveAttribute("accept", expect.stringContaining(".tar.gz"));
    await userEvent.upload(input, file);
    expect(writes()).toEqual([]); // choosing a file only opens the confirmation
    await userEvent.type(screen.getByLabelText("Type RESTORE to confirm"), "RESTORE");
    await userEvent.click(within(screen.getByRole("group", { name: "Confirm restore" })).getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Restored. Sign in again to continue.")).toBeInTheDocument();
    const form = writes()[0].body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("confirm")).toBe("RESTORE");
    expect((form.get("file") as File).name).toBe("old.tar.gz");
  });

  it("warns about saved keys that can't be read, from the list and from a restore", async () => {
    fakeServer({
      "GET /api/admin/backups": () => ({ ...backupList, unreadableKeys: ["Open Food Facts"] }),
      "POST /api/admin/backups/restore": () => ({ ...restored, unreadableKeys: ["USDA", "Gemini"] }),
    });
    renderWithSession(<DataSettings />);
    expect(await screen.findByText("These saved keys couldn't be read with this server's secret and need entering again: Open Food Facts")).toBeInTheDocument();
    await userEvent.click(within((await screen.findAllByRole("listitem"))[0]).getByRole("button", { name: "Restore" }));
    await userEvent.type(screen.getByLabelText("Type RESTORE to confirm"), "RESTORE");
    await userEvent.click(within(screen.getByRole("group", { name: "Confirm restore" })).getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Restored. Sign in again to continue.")).toBeInTheDocument();
    expect(screen.getByText("These saved keys couldn't be read with this server's secret and need entering again: USDA, Gemini")).toBeInTheDocument();
  });

  it("shows the server's message on a 409", async () => {
    fakeServer({
      "GET /api/admin/backups": () => backupList,
      "POST /api/admin/backups": () => ({ status: 409, json: { error: "A backup or restore is already running. Try again in a minute." } }),
    });
    renderWithSession(<DataSettings />);
    await screen.findAllByRole("listitem");
    await userEvent.click(screen.getByRole("button", { name: "Back up now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A backup or restore is already running. Try again in a minute.");
    expect(screen.getByRole("button", { name: "Back up now" })).toBeEnabled();
  });

  it("a failed restore shows the message and keeps the panel for another try", async () => {
    fakeServer({
      "GET /api/admin/backups": () => backupList,
      "POST /api/admin/backups/restore": () => ({ status: 400, json: { error: "That backup is from a newer version of ByteSize. Update ByteSize first." } }),
    });
    renderWithSession(<DataSettings />);
    await userEvent.click(within((await screen.findAllByRole("listitem"))[0]).getByRole("button", { name: "Restore" }));
    await userEvent.type(screen.getByLabelText("Type RESTORE to confirm"), "RESTORE");
    await userEvent.click(within(screen.getByRole("group", { name: "Confirm restore" })).getByRole("button", { name: "Restore" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("newer version");
    expect(screen.queryByText("Restored. Sign in again to continue.")).not.toBeInTheDocument();
  });

  it("choosing a second file clears the typed confirmation", async () => {
    fakeServer({ "GET /api/admin/backups": () => backupList });
    renderWithSession(<DataSettings />);
    await screen.findAllByRole("listitem");
    const input = screen.getByLabelText("Restore from a file");
    await userEvent.upload(input, new File(["a"], "a.tar.gz"));
    await userEvent.type(screen.getByLabelText("Type RESTORE to confirm"), "RESTORE");
    const go = () => within(screen.getByRole("group", { name: "Confirm restore" })).getByRole("button", { name: "Restore" });
    expect(go()).toBeEnabled();
    await userEvent.upload(input, new File(["b"], "b.tar.gz"));
    expect(screen.getByLabelText("Type RESTORE to confirm")).toHaveValue("");
    expect(go()).toBeDisabled();
  });

  it("a failed restore shows its error inside the confirmation panel", async () => {
    fakeServer({
      "GET /api/admin/backups": () => backupList,
      "POST /api/admin/backups/restore": () => ({ status: 400, json: { error: "That file isn't a ByteSize backup. Choose another." } }),
    });
    renderWithSession(<DataSettings />);
    await userEvent.click(within((await screen.findAllByRole("listitem"))[0]).getByRole("button", { name: "Restore" }));
    await userEvent.type(screen.getByLabelText("Type RESTORE to confirm"), "RESTORE");
    await userEvent.click(within(screen.getByRole("group", { name: "Confirm restore" })).getByRole("button", { name: "Restore" }));
    expect(await within(screen.getByRole("group", { name: "Confirm restore" })).findByRole("alert")).toHaveTextContent("isn't a ByteSize backup");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("Back up now re-reads the list, so backups the server pruned disappear", async () => {
    const made = { name: "bytesize-2026-11-17-153000.tar.gz", size: 3000000, createdAt: "2026-11-17T22:30:00.000Z" };
    let posted = false;
    fakeServer({
      "GET /api/admin/backups": () => (posted ? { ...backupList, backups: [made, ...backupList.backups.slice(0, 2)] } : { ...backupList, backups: [...backupList.backups, { name: "bytesize-2026-11-01-020000.tar.gz", size: 100, createdAt: "2026-11-01T09:00:00.000Z" }] }),
      "POST /api/admin/backups": () => ((posted = true), { backup: made }),
    });
    renderWithSession(<DataSettings />);
    expect(await screen.findAllByRole("listitem")).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: "Back up now" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(screen.queryByText("100 B")).not.toBeInTheDocument();
    expect(screen.getByText("2.9 MB")).toBeInTheDocument();
  });

  it("the Restore button is styled as a warning", async () => {
    fakeServer({ "GET /api/admin/backups": () => backupList });
    renderWithSession(<DataSettings />);
    await userEvent.click(within((await screen.findAllByRole("listitem"))[0]).getByRole("button", { name: "Restore" }));
    const cls = within(screen.getByRole("group", { name: "Confirm restore" })).getByRole("button", { name: "Restore" }).className;
    expect(cls).toContain("bg-error");
    expect(cls).not.toContain("bg-primary");
  });

  it("a stray % in a download's file name doesn't break the download", async () => {
    stubSave();
    withFile({}, { "/api/export": "100%-sure.zip" });
    renderWithSession(<DataSettings />, { isAdmin: false });
    await userEvent.click(screen.getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(saved).toEqual(["100%-sure.zip"]));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
