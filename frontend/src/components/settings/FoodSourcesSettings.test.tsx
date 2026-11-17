import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FoodSourcesSettings from "./FoodSourcesSettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

const none = { usda: { hasKey: false }, spoonacular: { hasKey: false }, fatsecret: { hasKey: false } };

describe("Food sources settings", () => {
  it("saves a USDA key without ever showing it again", async () => {
    let hasKey = false;
    const server = fakeServer({
      "GET /api/admin/food-sources": () => ({ ...none, usda: { hasKey } }),
      "PUT /api/admin/food-sources": (body: any) => {
        hasKey = !!body.usdaApiKey;
        return { ...none, usda: { hasKey } };
      },
    });
    renderWithSession(<FoodSourcesSettings />, { isAdmin: true });
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
    renderWithSession(<FoodSourcesSettings />, { isAdmin: true });
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
    renderWithSession(<FoodSourcesSettings />, { isAdmin: true });
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
    renderWithSession(<FoodSourcesSettings />, { isAdmin: true });
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
    renderWithSession(<FoodSourcesSettings />, { isAdmin: true });
    await userEvent.click(await screen.findByRole("button", { name: "Remove FatSecret credentials" }));
    expect(server.sent.find((r) => r.method === "PUT")?.body).toEqual({ fatsecretClientId: null, fatsecretClientSecret: null });
    expect(await screen.findByText(/No FatSecret credentials yet/)).toBeInTheDocument();
  });
});
