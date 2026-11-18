// §32 Settings › Cached data (admin): the kept barcodes, filtered by source and shown a page at a time.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CachedDataSettings from "./CachedDataSettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

const savedRow = (i: number, over: Record<string, unknown> = {}) => ({
  cacheId: 100 + i,
  barcode: String(4000000000000 + i * 10),
  name: `Snack ${i}`,
  brand: "Acme",
  source: "off",
  savedAt: "2026-11-17T12:00:00.000Z",
  deletesAt: "2027-12-01T12:00:00.000Z",
  inUse: false,
  ...over,
});
const SOURCES = { off: 100, usda: 24, fatsecret: 10 };
const answer = (items: unknown[], total = items.length, over: Record<string, unknown> = {}) => ({ total, page: 1, pageSize: 10, sources: SOURCES, items, ...over });
const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => savedRow(from + i));
const lastGet = (s: ReturnType<typeof fakeServer>) => s.sent.filter((x) => x.method === "GET").at(-1)!.path;
const pill = (name: RegExp | string) => within(screen.getByRole("group", { name: "Sources" })).getByRole("button", { name });
const show = () => screen.getByRole("combobox", { name: "Show" }) as HTMLSelectElement;

beforeEach(() => localStorage.clear());

describe("Settings › Cached data", () => {
  it("lists kept barcodes with source, saved date and when each goes (or Kept — in use), 10 to a page", async () => {
    const items = rows(10).map((r, i) => (i === 1 ? { ...r, inUse: true, deletesAt: null, source: "fatsecret" } : r));
    const s = fakeServer({ "GET /api/admin/saved-barcodes": () => answer(items, 134) });
    renderWithSession(<CachedDataSettings />, { isAdmin: true });
    const card = await screen.findByRole("region", { name: "Saved barcodes" });
    expect(await within(card).findByText("134 saved barcodes")).toBeInTheDocument();
    expect(lastGet(s)).toBe("/api/admin/saved-barcodes?page=1&pageSize=10");
    const list = within(card).getAllByRole("listitem");
    expect(list).toHaveLength(10);
    expect(list[0]).toHaveTextContent("Snack 0");
    expect(list[0]).toHaveTextContent("4000000000000");
    expect(list[0]).toHaveTextContent("Open Food Facts");
    expect(list[0]).toHaveTextContent("Saved Nov 17, 2026");
    expect(list[0]).toHaveTextContent("Deletes Dec 1, 2027");
    expect(list[1]).toHaveTextContent("FatSecret");
    expect(list[1]).toHaveTextContent("Kept — in use");
    expect(within(list[1]).getByRole("button", { name: "Delete Snack 1" })).toBeDisabled();
  });

  it("source pills, one per source that has kept barcodes, each with its count; tapping one off filters the list and goes to page 1", async () => {
    const s = fakeServer({ "GET /api/admin/saved-barcodes": (_b, path) => (path.includes("sources=") ? answer(rows(2), 34) : answer(rows(10), 134)) });
    renderWithSession(<CachedDataSettings />, { isAdmin: true });
    await screen.findByText("134 saved barcodes");
    const names = within(screen.getByRole("group", { name: "Sources" })).getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["Open Food Facts (100)", "USDA (24)", "FatSecret (10)"]);
    for (const b of within(screen.getByRole("group", { name: "Sources" })).getAllByRole("button")) expect(b).toHaveAttribute("aria-pressed", "true");
    expect(pill(/Open Food Facts/).className).toMatch(/h-7/); // the same small pills as the search's
    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(lastGet(s)).toBe("/api/admin/saved-barcodes?page=2&pageSize=10");
    await userEvent.click(pill(/Open Food Facts/));
    await waitFor(() => expect(lastGet(s)).toBe("/api/admin/saved-barcodes?page=1&pageSize=10&sources=usda,fatsecret,spoonacular"));
    expect(pill(/Open Food Facts/)).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByText("34 saved barcodes")).toBeInTheDocument();
    await userEvent.click(pill(/Open Food Facts/));
    await waitFor(() => expect(lastGet(s)).toBe("/api/admin/saved-barcodes?page=1&pageSize=10"));
  });

  it("with every pill off the list is empty: the real \"none\" (an empty sources) is sent", async () => {
    const s = fakeServer({ "GET /api/admin/saved-barcodes": (_b, path) => (path.endsWith("sources=") ? answer([], 0) : answer(rows(3), 134)) });
    renderWithSession(<CachedDataSettings />, { isAdmin: true });
    await screen.findByText("134 saved barcodes");
    for (const n of [/Open Food Facts/, /USDA/, /FatSecret/]) await userEvent.click(pill(n));
    await waitFor(() => expect(lastGet(s)).toBe("/api/admin/saved-barcodes?page=1&pageSize=10&sources="));
    expect(await screen.findByText("0 saved barcodes")).toBeInTheDocument();
    expect(pill(/USDA/)).toBeInTheDocument(); // the pills stay so they can be turned back on
  });

  it("Show: 10, 20, 30, 40, 50 (10 to start), back to page 1, remembered on this device", async () => {
    const s = fakeServer({ "GET /api/admin/saved-barcodes": (_b, path) => answer(rows(10), 134, { pageSize: Number(/pageSize=(\d+)/.exec(path)![1]) }) });
    const first = renderWithSession(<CachedDataSettings />, { isAdmin: true });
    await screen.findByText("134 saved barcodes");
    expect(within(show()).getAllByRole("option").map((o) => o.textContent)).toEqual(["10", "20", "30", "40", "50"]);
    expect(show().value).toBe("10");
    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    await userEvent.selectOptions(show(), "30");
    await waitFor(() => expect(lastGet(s)).toBe("/api/admin/saved-barcodes?page=1&pageSize=30"));
    expect(localStorage.getItem("bytesize.cachedPerPage")).toBe("30");
    first.unmount();
    const again = fakeServer({ "GET /api/admin/saved-barcodes": () => answer(rows(10), 134, { pageSize: 30 }) });
    renderWithSession(<CachedDataSettings />, { isAdmin: true });
    await screen.findByText("134 saved barcodes");
    expect(show().value).toBe("30");
    expect(lastGet(again)).toBe("/api/admin/saved-barcodes?page=1&pageSize=30");
  });

  it("junk in the remembered number falls back to 10", async () => {
    localStorage.setItem("bytesize.cachedPerPage", "7");
    const s = fakeServer({ "GET /api/admin/saved-barcodes": () => answer(rows(2)) });
    renderWithSession(<CachedDataSettings />, { isAdmin: true });
    await screen.findByText("2 saved barcodes");
    expect(lastGet(s)).toBe("/api/admin/saved-barcodes?page=1&pageSize=10");
  });

  it("pages at the bottom: ‹ 1 2 3 … 14 › and the range, e.g. 11–20 of 134", async () => {
    const s = fakeServer({ "GET /api/admin/saved-barcodes": (_b, path) => { const n = Number(/page=(\d+)/.exec(path)![1]); return answer(rows(10, (n - 1) * 10), 134, { page: n }); } });
    renderWithSession(<CachedDataSettings />, { isAdmin: true });
    await screen.findByText("1–10 of 134");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("11–20 of 134")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    expect(lastGet(s)).toBe("/api/admin/saved-barcodes?page=2&pageSize=10");
    await userEvent.click(screen.getByRole("button", { name: "Page 14" }));
    expect(await screen.findByText("131–134 of 134")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("the range and the current page follow the list on screen, not the page just asked for", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fakeServer({
      "GET /api/admin/saved-barcodes": async (_b, path) => {
        const n = Number(/page=(\d+)/.exec(path)![1]);
        if (n === 2) await gate;
        return answer(rows(10, (n - 1) * 10), 134, { page: n });
      },
    });
    renderWithSession(<CachedDataSettings />, { isAdmin: true });
    await screen.findByText("1–10 of 134");
    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(screen.getByText("1–10 of 134")).toBeInTheDocument(); // page 1's rows are still showing
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    release();
    expect(await screen.findByText("11–20 of 134")).toBeInTheDocument();
  });

  it("no pager when everything fits on one page", async () => {
    fakeServer({ "GET /api/admin/saved-barcodes": () => answer(rows(4)) });
    renderWithSession(<CachedDataSettings />, { isAdmin: true });
    await screen.findByText("4 saved barcodes");
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
  });

  it("after deleting the last row of the last page, the list goes back a page", async () => {
    let items = rows(11);
    fakeServer({
      "GET /api/admin/saved-barcodes": (_b, path) => {
        const n = Number(/page=(\d+)/.exec(path)![1]);
        return answer(items.slice((n - 1) * 10, n * 10), items.length, { page: n });
      },
      "DELETE /api/admin/saved-barcodes/:id": () => ((items = items.slice(0, 10)), { deleted: 1 }),
    });
    renderWithSession(<CachedDataSettings />, { isAdmin: true });
    await screen.findByText("11 saved barcodes");
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete Snack 10" }));
    expect(await screen.findByText("Snack 0")).toBeInTheDocument();
    expect(screen.getByText("10 saved barcodes")).toBeInTheDocument();
  });

  it("searches by name or barcode (combined with the pills), starting again at page 1", async () => {
    const s = fakeServer({ "GET /api/admin/saved-barcodes": (_b, path) => (path.includes("q=") ? answer([savedRow(3, { name: "Granola" })], 1, { sources: { usda: 1 } }) : answer(rows(10), 134)) });
    renderWithSession(<CachedDataSettings />, { isAdmin: true });
    await screen.findByText("134 saved barcodes");
    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search saved barcodes" }), "granola");
    expect(await screen.findByText("Granola")).toBeInTheDocument();
    expect(screen.getByText("1 saved barcode")).toBeInTheDocument();
    expect(lastGet(s)).toBe("/api/admin/saved-barcodes?page=1&pageSize=10&q=granola");
    // the counts follow the search; a source seen before keeps its pill (at 0) so it can be switched
    expect(pill(/USDA \(1\)/)).toBeInTheDocument();
    expect(pill(/Open Food Facts \(0\)/)).toBeInTheDocument();
  });

  it("refreshes or deletes one row, and deletes all not in use after asking", async () => {
    let items = [savedRow(1), savedRow(2, { inUse: true, deletesAt: null })];
    const server = fakeServer({
      "GET /api/admin/saved-barcodes": () => answer(items),
      "POST /api/admin/saved-barcodes/:id/refresh": () => ({ result: "updated", food: {} }),
      "DELETE /api/admin/saved-barcodes/:id": () => ((items = items.filter((i) => i.cacheId !== 101)), { deleted: 1 }),
      "POST /api/admin/saved-barcodes/delete-unused": () => ((items = items.filter((i) => i.inUse)), { deleted: 0 }),
    });
    renderWithSession(<CachedDataSettings />, { isAdmin: true });
    const card = await screen.findByRole("region", { name: "Saved barcodes" });
    await userEvent.click(await within(card).findByRole("button", { name: "Refresh Snack 1" }));
    expect(server.writes().at(-1)).toMatchObject({ method: "POST", path: "/api/admin/saved-barcodes/101/refresh" });
    expect(await within(card).findByText("Snack 1: Updated")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Delete Snack 1" }));
    expect(server.writes().at(-1)).toMatchObject({ method: "DELETE", path: "/api/admin/saved-barcodes/101" });
    await waitFor(() => expect(within(card).queryByText("Snack 1")).not.toBeInTheDocument());
    await userEvent.click(within(card).getByRole("button", { name: "Delete all not in use" }));
    const ask = screen.getByRole("alertdialog", { name: "Delete all saved barcodes not in use?" });
    await userEvent.click(within(ask).getByRole("button", { name: "Delete" }));
    expect(server.writes().at(-1)).toMatchObject({ method: "POST", path: "/api/admin/saved-barcodes/delete-unused" });
    expect(await within(card).findByText("1 saved barcode")).toBeInTheDocument();
  });
});
