import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FoodDatabasesSettings, RestaurantMenusSettings, useSourceKeys } from "./FoodSourcesSettings";
import { restoreClipboard, stubClipboard } from "../../test/clipboard";

// Each card as IntegrationsSettings uses it, with the summary fetched once by its parent
const FoodDatabases = () => <FoodDatabasesSettings sources={useSourceKeys()} />;
const RestaurantMenus = () => <RestaurantMenusSettings sources={useSourceKeys()} />;
afterEach(restoreClipboard);
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

const none = { usda: { hasKey: false }, spoonacular: { hasKey: false }, fatsecret: { hasKey: false } };

describe("Food databases and restaurant menus settings", () => {
  it("saves a USDA key without ever showing it again", async () => {
    let hasKey = false;
    const server = fakeServer({
      "GET /api/admin/food-sources": () => ({ ...none, usda: { hasKey } }),
      "PUT /api/admin/food-sources": (body: any) => {
        hasKey = !!body.usdaApiKey;
        return { ...none, usda: { hasKey } };
      },
    });
    renderWithSession(<FoodDatabases />, { isAdmin: true });
    expect(await screen.findByText(/No USDA key yet/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("USDA API key"), "abc123");
    await userEvent.click(screen.getByRole("button", { name: "Save USDA key" }));
    expect(server.sent.find((r) => r.method === "PUT")?.body).toEqual({ usdaApiKey: "abc123" });
    expect(await screen.findByText(/USDA key saved/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("abc123")).not.toBeInTheDocument();
  });

  it("removes the key", async () => {
    const server = fakeServer({
      "GET /api/admin/food-sources": () => ({ ...none, usda: { hasKey: true } }),
      "PUT /api/admin/food-sources": () => none,
    });
    renderWithSession(<FoodDatabases />, { isAdmin: true });
    await userEvent.click(await screen.findByRole("button", { name: "Remove USDA key" }));
    expect(server.sent.find((r) => r.method === "PUT")?.body).toEqual({ usdaApiKey: null });
    expect(await screen.findByText(/No USDA key yet/)).toBeInTheDocument();
  });

  it("saves a Spoonacular key without ever showing it, and tests it", async () => {
    let hasKey = false;
    const server = fakeServer({
      "GET /api/admin/food-sources": () => ({ ...none, spoonacular: { hasKey } }),
      "PUT /api/admin/food-sources": (body: any) => {
        hasKey = !!body.spoonacularApiKey;
        return { ...none, spoonacular: { hasKey } };
      },
      "POST /api/admin/food-sources/test": () => ({ ok: true, lookupsLeft: 49 }),
    });
    renderWithSession(<RestaurantMenus />, { isAdmin: true });
    expect(await screen.findByText(/No Spoonacular key yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test Spoonacular" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Spoonacular API key"), "sp-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save Spoonacular key" }));
    expect(server.sent.find((r) => r.method === "PUT")?.body).toEqual({ spoonacularApiKey: "sp-secret" });
    expect(await screen.findByText(/Spoonacular key saved/)).toBeInTheDocument();
    expect(screen.getByText("(uses 1 lookup)")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("sp-secret")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Test Spoonacular" }));
    expect(server.sent.find((r) => r.path === "/api/admin/food-sources/test")?.body).toEqual({ source: "spoonacular" });
    expect(await screen.findByText("Spoonacular works. About 22 lookups left today.")).toBeInTheDocument();
  });

  it("saves FatSecret's client ID and secret together, never shows them, and reports a failed Test", async () => {
    let hasKey = false;
    const server = fakeServer({
      "GET /api/admin/food-sources": () => ({ ...none, fatsecret: { hasKey } }),
      "PUT /api/admin/food-sources": (body: any) => {
        hasKey = !!body.fatsecretClientId && !!body.fatsecretClientSecret;
        return { ...none, fatsecret: { hasKey } };
      },
      "POST /api/admin/food-sources/test": () => ({ ok: false, error: "FatSecret refused this server's IP address" }),
    });
    renderWithSession(<RestaurantMenus />, { isAdmin: true });
    expect(await screen.findByText(/No FatSecret credentials yet/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("FatSecret client ID"), "fs-id");
    expect(screen.getByRole("button", { name: "Save FatSecret credentials" })).toBeDisabled(); // needs both
    await userEvent.type(screen.getByLabelText("FatSecret client secret"), "fs-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save FatSecret credentials" }));
    expect(server.sent.find((r) => r.method === "PUT")?.body).toEqual({ fatsecretClientId: "fs-id", fatsecretClientSecret: "fs-secret" });
    expect(await screen.findByText(/FatSecret credentials saved/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("fs-id")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("fs-secret")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Test FatSecret" }));
    expect(server.sent.find((r) => r.path === "/api/admin/food-sources/test")?.body).toEqual({ source: "fatsecret" });
    expect(await screen.findByText("FatSecret refused this server's IP address")).toBeInTheDocument();
  });

  it("removes FatSecret's credentials", async () => {
    const server = fakeServer({
      "GET /api/admin/food-sources": () => ({ ...none, fatsecret: { hasKey: true } }),
      "PUT /api/admin/food-sources": () => none,
    });
    renderWithSession(<RestaurantMenus />, { isAdmin: true });
    await userEvent.click(await screen.findByRole("button", { name: "Remove FatSecret credentials" }));
    expect(server.sent.find((r) => r.method === "PUT")?.body).toEqual({ fatsecretClientId: null, fatsecretClientSecret: null });
    expect(await screen.findByText(/No FatSecret credentials yet/)).toBeInTheDocument();
  });

  it("Food databases: Open Food Facts needs no key; the USDA eye fetches the saved key and copy copies it", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard({ writeText });
    const server = fakeServer({
      "GET /api/admin/food-sources": () => ({ ...none, usda: { hasKey: true } }),
      "GET /api/admin/food-sources/usda/key": () => ({ key: "usda-saved" }),
    });
    renderWithSession(<FoodDatabases />, { isAdmin: true });
    expect(await screen.findByText(/Open Food Facts/)).toBeInTheDocument();
    expect(screen.queryByText(/Spoonacular/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy USDA key" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("usda-saved");
    expect(screen.queryByDisplayValue("usda-saved")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show USDA key" }));
    expect(await screen.findByDisplayValue("usda-saved")).toBe(screen.getByLabelText("USDA API key"));
    // shown, not typed: Save stays off and nothing is sent
    expect(screen.getByRole("button", { name: "Save USDA key" })).toBeDisabled();
    expect(server.writes()).toHaveLength(0);
  });

  it("Restaurant menus: eyes on the Spoonacular key and on FatSecret's ID and secret, each named apart, and the credits", async () => {
    const server = fakeServer({
      "GET /api/admin/food-sources": () => ({ ...none, spoonacular: { hasKey: true }, fatsecret: { hasKey: true } }),
      "GET /api/admin/food-sources/spoonacular/key": () => ({ key: "spoon-saved" }),
      "GET /api/admin/food-sources/fatsecret/key": () => ({ clientId: "fs-id-saved", clientSecret: "fs-secret-saved" }),
    });
    renderWithSession(<RestaurantMenus />, { isAdmin: true });
    expect(await screen.findByText(/A Spoonacular key is saved/)).toBeInTheDocument();
    expect(screen.queryByText(/USDA/)).not.toBeInTheDocument();
    expect(screen.getByText(/Restaurant data from spoonacular.com/)).toBeInTheDocument();
    expect(screen.getByText(/Powered by FatSecret/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show Spoonacular key" }));
    expect(await screen.findByDisplayValue("spoon-saved")).toBe(screen.getByLabelText("Spoonacular API key"));
    await userEvent.click(screen.getByRole("button", { name: "Show FatSecret client ID" }));
    expect(await screen.findByDisplayValue("fs-id-saved")).toBe(screen.getByLabelText("FatSecret client ID"));
    expect(screen.queryByDisplayValue("fs-secret-saved")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show FatSecret client secret" }));
    expect(await screen.findByDisplayValue("fs-secret-saved")).toBe(screen.getByLabelText("FatSecret client secret"));
    // the ID and secret come together: one fetch (one activity-log line) for both
    expect(server.sent.filter((r) => r.path.endsWith("/key")).map((r) => r.path)).toEqual(["/api/admin/food-sources/spoonacular/key", "/api/admin/food-sources/fatsecret/key"]);
    expect(server.writes()).toHaveLength(0);
  });

  it("FatSecret: once both are hidden again (or after a save) the pair is fetched afresh", async () => {
    const server = fakeServer({
      "GET /api/admin/food-sources": () => ({ ...none, fatsecret: { hasKey: true } }),
      "GET /api/admin/food-sources/fatsecret/key": () => ({ clientId: "fs-id-saved", clientSecret: "fs-secret-saved" }),
      "PUT /api/admin/food-sources": () => ({ ...none, fatsecret: { hasKey: true } }),
    });
    renderWithSession(<RestaurantMenus />, { isAdmin: true });
    const fetches = () => server.sent.filter((r) => r.path.endsWith("/fatsecret/key")).length;
    await userEvent.click(await screen.findByRole("button", { name: "Show FatSecret client ID" }));
    await screen.findByDisplayValue("fs-id-saved");
    await userEvent.click(screen.getByRole("button", { name: "Hide FatSecret client ID" }));
    await userEvent.click(screen.getByRole("button", { name: "Show FatSecret client secret" }));
    await screen.findByDisplayValue("fs-secret-saved");
    expect(fetches()).toBe(2);
    // a save drops what was shown, and the next reveal fetches again
    await userEvent.type(screen.getByLabelText("FatSecret client ID"), "{Control>}a{/Control}new-id");
    await userEvent.clear(screen.getByLabelText("FatSecret client secret"));
    await userEvent.type(screen.getByLabelText("FatSecret client secret"), "new-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save FatSecret credentials" }));
    await screen.findByText(/FatSecret credentials saved/);
    expect(screen.queryByDisplayValue("fs-secret-saved")).not.toBeInTheDocument();
    expect(screen.getByLabelText("FatSecret client ID")).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show FatSecret client ID" }));
    await screen.findByDisplayValue("fs-id-saved");
    expect(fetches()).toBe(3);
  });
});
