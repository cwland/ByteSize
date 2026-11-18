import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntegrationsSettings from "./IntegrationsSettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

// § 18: one card per integration, each with a switch in its title row. On = open and used; off = closed.
type Summary = { off: { enabled: boolean }; usda: { hasKey: boolean; enabled: boolean }; spoonacular: { hasKey: boolean; enabled: boolean }; fatsecret: { hasKey: boolean; enabled: boolean } };
const fresh = (): Summary => ({ off: { enabled: true }, usda: { hasKey: false, enabled: false }, spoonacular: { hasKey: false, enabled: false }, fatsecret: { hasKey: false, enabled: false } });
const aiService = { id: "s1", name: "Home AI", provider: "local", model: "qwen", baseUrl: "http://10.0.0.5:11434/v1", quick: true, photos: true, hasKey: false, apiKeyUnreadable: false };

/** The admin's Integrations tab against a fake server that keeps the switches as the real one does. */
function adminTab(start: Partial<Summary> = {}, opts: { ai?: boolean; culury?: { url: string | null; hasKey: boolean; enabled: boolean } } = {}) {
  let sources: Summary = { ...fresh(), ...start };
  let ai = { enabled: opts.ai ?? true, timeoutSec: 15, services: [aiService] };
  let culury = opts.culury ?? { url: null, hasKey: false, enabled: false };
  const server = fakeServer({
    "GET /api/settings/ai": () => ({ settings: ai }),
    "PUT /api/settings/ai": (b: any) => ({ settings: (ai = { ...ai, enabled: b.enabled ?? ai.enabled }) }),
    "GET /api/admin/food-sources": () => sources,
    "PUT /api/admin/food-sources": (b: any) => {
      for (const [k, v] of Object.entries(b.enabled ?? {})) sources = { ...sources, [k]: { ...sources[k as keyof Summary], enabled: v } };
      return sources;
    },
    "GET /api/settings/culury": () => culury,
    "PUT /api/settings/culury/enabled": (b: any) => (culury = { ...culury, enabled: b.enabled }),
  });
  renderWithSession(<IntegrationsSettings />, { isAdmin: true });
  return server;
}
const card = (name: string) => screen.getByRole("region", { name });
const theSwitch = (name: string) => screen.getByRole("switch", { name: `${name} on` });

describe("Settings › Integrations switches", () => {
  it("admins see one card per integration, in order, each with its switch in the title row", async () => {
    adminTab({ usda: { hasKey: true, enabled: true } });
    await screen.findByLabelText("USDA API key");
    const names = ["AI services", "Open Food Facts", "USDA", "FatSecret", "Spoonacular", "Culury"];
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(names);
    for (const name of names) {
      const sw = await within(card(name)).findByRole("switch", { name: `${name} on` });
      // in the title row: the heading and the switch share one row
      expect(within(card(name)).getByRole("heading", { level: 2 }).parentElement).toBe(sw.parentElement);
    }
  });

  it("a card that is off shows only its title row and “Off — not used”", async () => {
    adminTab();
    await screen.findAllByText("Off — not used");
    for (const name of ["USDA", "FatSecret", "Spoonacular", "Culury"]) {
      expect(theSwitch(name)).toHaveAttribute("aria-checked", "false");
      expect(within(card(name)).getByText("Off — not used")).toBeInTheDocument();
      expect(within(card(name)).queryByRole("textbox")).toBeNull();
      expect(within(card(name)).queryByRole("button")).toBeNull();
    }
    expect(screen.queryByLabelText("USDA API key")).toBeNull();
    expect(theSwitch("Open Food Facts")).toHaveAttribute("aria-checked", "true");
    expect(within(card("Open Food Facts")).getByText(/No key needed/)).toBeInTheDocument();
  });

  it("turning a source off saves at once (only the switch is sent) and closes the card; the key stays saved", async () => {
    const server = adminTab({ usda: { hasKey: true, enabled: true } });
    const user = userEvent.setup();
    expect(await screen.findByLabelText("USDA API key")).toBeInTheDocument();
    await user.click(theSwitch("USDA"));
    expect(server.writes()).toEqual([expect.objectContaining({ method: "PUT", path: "/api/admin/food-sources", body: { enabled: { usda: false } } })]);
    expect(await within(card("USDA")).findByText("Off — not used")).toBeInTheDocument();
    expect(screen.queryByLabelText("USDA API key")).toBeNull();
    // back on: open again, the saved key still saved, nothing else sent
    await user.click(theSwitch("USDA"));
    expect(await screen.findByLabelText("USDA API key")).toBeInTheDocument();
    expect(within(card("USDA")).getByText(/A USDA key is saved/)).toBeInTheDocument();
    expect(server.writes().map((w) => w.body)).toEqual([{ enabled: { usda: false } }, { enabled: { usda: true } }]);
  });

  it("Open Food Facts can be turned off too", async () => {
    const server = adminTab();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("switch", { name: "Open Food Facts on" }));
    expect(server.writes()[0].body).toEqual({ enabled: { off: false } });
    expect(await within(card("Open Food Facts")).findByText("Off — not used")).toBeInTheDocument();
  });

  it("switching on a card with nothing set up opens it with its key field ready, and says it isn't used yet", async () => {
    const server = adminTab();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("switch", { name: "Spoonacular on" }));
    expect(server.writes()[0].body).toEqual({ enabled: { spoonacular: true } });
    const key = await screen.findByLabelText("Spoonacular API key");
    expect(key).toHaveFocus();
    expect(within(card("Spoonacular")).getByText(/No Spoonacular key yet/)).toBeInTheDocument();
    expect(within(card("Spoonacular")).getByText(/isn't used until/)).toBeInTheDocument();
    await user.click(theSwitch("FatSecret"));
    expect(await screen.findByLabelText("FatSecret client ID")).toHaveFocus();
  });

  it("each restaurant card carries its own credits line", async () => {
    adminTab({ spoonacular: { hasKey: true, enabled: true }, fatsecret: { hasKey: true, enabled: true } });
    expect(await within(await screen.findByRole("region", { name: "Spoonacular" })).findByText(/Restaurant data from spoonacular.com/)).toBeInTheDocument();
    expect(within(card("FatSecret")).getByText(/Powered by FatSecret/)).toBeInTheDocument();
    expect(within(card("Spoonacular")).queryByText(/Powered by FatSecret/)).toBeNull();
  });

  it("a switch that couldn't be saved goes back and says why", async () => {
    fakeServer({
      "GET /api/settings/ai": () => ({ settings: null }),
      "GET /api/admin/food-sources": () => ({ ...fresh(), usda: { hasKey: true, enabled: true } }),
      "PUT /api/admin/food-sources": () => ({ status: 500, json: { error: "Something went wrong" } }),
      "GET /api/settings/culury": () => ({ url: null, hasKey: false, enabled: false }),
    });
    renderWithSession(<IntegrationsSettings />, { isAdmin: true });
    const user = userEvent.setup();
    await screen.findByLabelText("USDA API key");
    await user.click(theSwitch("USDA"));
    expect(await within(card("USDA")).findByText("Something went wrong")).toBeInTheDocument();
    expect(theSwitch("USDA")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("USDA API key")).toBeInTheDocument();
  });

  it("AI services: the switch sits in the card's title row, saves at once and keeps the services", async () => {
    const server = adminTab();
    const user = userEvent.setup();
    expect(await within(await screen.findByRole("region", { name: "AI services" })).findByRole("listitem", { name: /Home AI/ })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Use AI" })).toBeNull();
    await user.click(theSwitch("AI services"));
    expect(server.writes()).toEqual([expect.objectContaining({ method: "PUT", path: "/api/settings/ai", body: { enabled: false } })]);
    expect(await within(card("AI services")).findByText("Off — not used")).toBeInTheDocument();
    expect(within(card("AI services")).queryByRole("listitem")).toBeNull();
    await user.click(theSwitch("AI services"));
    expect(await within(card("AI services")).findByRole("listitem", { name: /Home AI/ })).toBeInTheDocument();
    expect(server.writes().map((w) => w.body)).toEqual([{ enabled: false }, { enabled: true }]);
  });

  it("every card's description is the same size (small, subtle)", async () => {
    adminTab({ usda: { hasKey: true, enabled: true } }, { culury: { url: null, hasKey: false, enabled: true } });
    await screen.findByLabelText("USDA API key");
    for (const text of [/Used to look up foods and read meal photos/, /Packaged foods and barcodes/, /FoodData Central adds whole foods/, /Log meals you planned in Culury/]) {
      expect(await screen.findByText(text)).toHaveClass("text-sm", "text-subtle");
    }
  });

  it("AI that was off starts closed", async () => {
    adminTab({}, { ai: false });
    expect(await within(await screen.findByRole("region", { name: "AI services" })).findByText("Off — not used")).toBeInTheDocument();
    expect(theSwitch("AI services")).toHaveAttribute("aria-checked", "false");
  });

  it("Culury: the person's own switch saves at once; switching on unlinked opens the form ready to fill", async () => {
    const server = adminTab();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("switch", { name: "Culury on" }));
    expect(server.writes()).toEqual([expect.objectContaining({ method: "PUT", path: "/api/settings/culury/enabled", body: { enabled: true } })]);
    expect(await screen.findByLabelText("Culury address")).toHaveFocus();
    expect(within(card("Culury")).getByText(/Not linked yet/)).toBeInTheDocument();
  });

  it("Culury linked but off: closed; on again shows the saved link", async () => {
    adminTab({}, { culury: { url: "http://culury.lan:4000", hasKey: true, enabled: false } });
    const user = userEvent.setup();
    expect(await within(await screen.findByRole("region", { name: "Culury" })).findByText("Off — not used")).toBeInTheDocument();
    expect(screen.queryByLabelText("Culury address")).toBeNull();
    await user.click(theSwitch("Culury"));
    expect(await screen.findByLabelText("Culury address")).toHaveValue("http://culury.lan:4000");
    expect(within(card("Culury")).getByText(/A key is saved/)).toBeInTheDocument();
  });

  it("members see only their Culury card and its switch", async () => {
    const server = fakeServer({
      "GET /api/settings/culury": () => ({ url: null, hasKey: false, enabled: false }),
      "PUT /api/settings/culury/enabled": (b: any) => ({ url: null, hasKey: false, enabled: b.enabled }),
    });
    renderWithSession(<IntegrationsSettings />, { isAdmin: false });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("switch", { name: "Culury on" }));
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Culury"]);
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(server.sent.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/settings/culury", "PUT /api/settings/culury/enabled"]);
  });
});
