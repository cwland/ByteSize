import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FoodSourcesSettings from "./FoodSourcesSettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

describe("Food sources settings", () => {
  it("saves a USDA key without ever showing it again", async () => {
    let hasKey = false;
    const server = fakeServer({
      "GET /api/admin/food-sources": () => ({ usda: { hasKey } }),
      "PUT /api/admin/food-sources": (body: any) => {
        hasKey = !!body.usdaApiKey;
        return { usda: { hasKey } };
      },
    });
    renderWithSession(<FoodSourcesSettings />, { isAdmin: true });
    expect(await screen.findByText(/No USDA key yet/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("USDA API key"), "abc123");
    await userEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(server.sent.find((r) => r.method === "PUT")?.body).toEqual({ usdaApiKey: "abc123" });
    expect(await screen.findByText(/USDA key saved/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("abc123")).not.toBeInTheDocument();
  });

  it("removes the key", async () => {
    const server = fakeServer({
      "GET /api/admin/food-sources": () => ({ usda: { hasKey: true } }),
      "PUT /api/admin/food-sources": () => ({ usda: { hasKey: false } }),
    });
    renderWithSession(<FoodSourcesSettings />, { isAdmin: true });
    await userEvent.click(await screen.findByRole("button", { name: "Remove key" }));
    expect(server.sent.find((r) => r.method === "PUT")?.body).toEqual({ usdaApiKey: null });
    expect(await screen.findByText(/No USDA key yet/)).toBeInTheDocument();
  });
});
