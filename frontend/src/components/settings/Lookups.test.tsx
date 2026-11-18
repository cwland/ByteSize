// §21 in Settings › Integrations: the lookup order table, "Keep results for" hours, the FatSecret plan. (Saved barcodes moved to Cached data: CachedDataSettings.test.tsx.)
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntegrationsSettings from "./IntegrationsSettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { foodSourcesJson } from "../../test/fixtures";

function admin(routes: Record<string, (b: any, path: string) => unknown> = {}, summary: unknown = foodSourcesJson()) {
  return fakeServer({
    "GET /api/settings/ai": () => ({ settings: null }),
    "GET /api/admin/food-sources": () => summary,
    "GET /api/settings/culury": () => ({ url: null, hasKey: false, enabled: false }),
    ...routes,
  });
}
const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);
const orderRow = (name: string) => within(screen.getByRole("table", { name: "How ByteSize looks foods up" })).getByRole("rowheader", { name }).closest("tr")!;

describe("How ByteSize looks foods up (the order table)", () => {
  it("lists each lookup's sources in order: barcode, restaurants, typed search", async () => {
    admin({}, foodSourcesJson({ fatsecret: { plan: "premier" } }));
    renderWithSession(<IntegrationsSettings />, { isAdmin: true });
    const table = await screen.findByRole("table", { name: "How ByteSize looks foods up" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Lookup", "1st", "2nd", "3rd"]);
    expect(cells(orderRow("Barcode"))).toEqual(["Open Food Facts", "FatSecret", "USDA"]);
    expect(cells(orderRow("Restaurants"))).toEqual(["FatSecret", "Spoonacular", "—"]);
    expect(cells(orderRow("Typed search"))).toEqual(["FatSecret", "USDA", "Open Food Facts"]);
    expect(screen.getByText(/A saved copy is always checked first/)).toBeInTheDocument();
  });

  it("marks sources that are off, and FatSecret barcodes as Premier only on Basic", async () => {
    admin({}, foodSourcesJson({ usda: { enabled: false }, spoonacular: { enabled: false } }));
    renderWithSession(<IntegrationsSettings />, { isAdmin: true });
    await screen.findByRole("table", { name: "How ByteSize looks foods up" });
    expect(cells(orderRow("Barcode"))).toEqual(["Open Food Facts", "FatSecret (Premier only)", "USDA Off — skipped"]);
    expect(cells(orderRow("Restaurants"))).toEqual(["FatSecret", "Spoonacular Off — skipped", "—"]);
  });

  it("follows a switch flipped on the same page", async () => {
    let usda = true;
    admin({ "PUT /api/admin/food-sources": (b: any) => ((usda = b.enabled?.usda ?? usda), foodSourcesJson({ usda: { enabled: usda } })) });
    renderWithSession(<IntegrationsSettings />, { isAdmin: true });
    await screen.findByRole("table", { name: "How ByteSize looks foods up" });
    await userEvent.click(screen.getByRole("switch", { name: "USDA on" }));
    await waitFor(() => expect(cells(orderRow("Typed search"))).toEqual(["FatSecret", "USDA Off — skipped", "Open Food Facts"]));
  });
});

describe("Keep results for (hours) and the FatSecret plan", () => {
  it("each source card shows its hours with the terms note, and saves a new number", async () => {
    const server = admin({ "PUT /api/admin/food-sources": () => foodSourcesJson({ fatsecret: { hours: 12 } }) });
    renderWithSession(<IntegrationsSettings />, { isAdmin: true });
    const fs = await screen.findByRole("region", { name: "FatSecret" });
    const box = within(fs).getByRole("spinbutton", { name: "FatSecret: keep results for (hours)" });
    expect(box).toHaveValue(24);
    expect(within(fs).getByText(/FatSecret's terms allow keeping results for 24 hours/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Spoonacular" })).getByRole("spinbutton", { name: "Spoonacular: keep results for (hours)" })).toHaveValue(1);
    expect(within(screen.getByRole("region", { name: "Open Food Facts" })).getByRole("spinbutton", { name: "Open Food Facts: keep results for (hours)" })).toHaveValue(9999);
    expect(within(screen.getByRole("region", { name: "USDA" })).getByRole("spinbutton", { name: "USDA: keep results for (hours)" })).toHaveValue(9999);
    await userEvent.clear(box);
    await userEvent.type(box, "12");
    await userEvent.click(within(fs).getByRole("button", { name: "Save FatSecret hours" }));
    expect(server.writes().at(-1)).toMatchObject({ method: "PUT", path: "/api/admin/food-sources", body: { hours: { fatsecret: 12 } } });
    expect(await within(fs).findByText("Keeping FatSecret results for 12 hours")).toBeInTheDocument();
  });

  it("refuses anything but whole hours 1–9999 before sending", async () => {
    const server = admin();
    renderWithSession(<IntegrationsSettings />, { isAdmin: true });
    const usda = await screen.findByRole("region", { name: "USDA" });
    const box = within(usda).getByRole("spinbutton", { name: "USDA: keep results for (hours)" });
    for (const bad of ["0", "10000", "1.5"]) {
      await userEvent.clear(box);
      await userEvent.type(box, bad);
      await userEvent.click(within(usda).getByRole("button", { name: "Save USDA hours" }));
      expect(await within(usda).findByText("Keep results for 1 to 9999 whole hours")).toBeInTheDocument();
    }
    expect(server.writes()).toEqual([]);
  });

  it("the FatSecret card offers Basic or Premier, saved at once; a key without barcode access says so", async () => {
    let plan = "basic";
    const server = admin({ "PUT /api/admin/food-sources": (b: any) => ((plan = b.fatsecretPlan ?? plan), foodSourcesJson({ fatsecret: { plan } })) });
    renderWithSession(<IntegrationsSettings />, { isAdmin: true });
    const fs = await screen.findByRole("region", { name: "FatSecret" });
    const group = within(fs).getByRole("radiogroup", { name: "FatSecret plan" });
    expect(within(group).getByRole("radio", { name: "Basic (free)" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(group).getByRole("radio", { name: "Premier (barcodes)" }));
    expect(server.writes().at(-1)).toMatchObject({ body: { fatsecretPlan: "premier" } });
    await waitFor(() => expect(within(group).getByRole("radio", { name: "Premier (barcodes)" })).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(cells(orderRow("Barcode"))).toEqual(["Open Food Facts", "FatSecret", "USDA"]));
  });

  it("Premier without barcode access: the card says so once", async () => {
    admin({}, foodSourcesJson({ fatsecret: { plan: "premier", barcodeScopeMissing: true } }));
    renderWithSession(<IntegrationsSettings />, { isAdmin: true });
    const fs = await screen.findByRole("region", { name: "FatSecret" });
    expect(within(fs).getByText("Your FatSecret key doesn't include barcode lookups yet")).toBeInTheDocument();
  });
});

describe("members", () => {
  it("see none of the admin parts, and none of their routes is asked", async () => {
    const server = fakeServer({ "GET /api/settings/culury": () => ({ url: null, hasKey: false, enabled: false }) });
    renderWithSession(<IntegrationsSettings />, { isAdmin: false });
    await screen.findByRole("switch", { name: "Culury on" });
    expect(screen.queryByRole("table", { name: "How ByteSize looks foods up" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Saved barcodes" })).not.toBeInTheDocument();
    expect(screen.queryByText(/keep results for/i)).not.toBeInTheDocument();
    expect(server.sent.map((r) => r.path)).toEqual(["/api/settings/culury"]);
  });
});
