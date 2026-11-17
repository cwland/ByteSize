import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiSettings from "./AiSettings";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

// A service exactly as GET /api/settings/ai sends it
const svc = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  name: "",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  baseUrl: null,
  quick: true,
  photos: true,
  hasKey: true,
  apiKeyUnreadable: false,
  ...over,
});
const settings = (services: unknown[]) => ({ settings: { enabled: true, timeoutSec: 15, services } });

const claudeModels = ["claude-3-5-haiku-20241022", "claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-opus-4-1", "claude-sonnet-4-5"];
const claudeRecommended = ["claude-haiku-4-5", "claude-sonnet-4-5"];

// jsdom has no layout: give each service row a place on screen (100px tall, stacked)
function placeRows() {
  screen.getAllByRole("listitem").forEach((row, i) => {
    row.getBoundingClientRect = () => ({ top: i * 100, bottom: i * 100 + 100, height: 100, left: 0, right: 400, width: 400, x: 0, y: i * 100, toJSON: () => ({}) });
  });
}

async function expand(name: RegExp) {
  const row = await screen.findByRole("listitem", { name });
  await userEvent.click(within(row).getByRole("button", { expanded: false }));
  return row;
}

describe("AiSettings", () => {
  it("Validate loads the models and says the key works", async () => {
    const server = fakeServer({
      "GET /api/settings/ai": () => settings([svc()]),
      "POST /api/settings/ai/models": () => ({ models: claudeModels, recommended: claudeRecommended }),
    });
    renderWithSession(<AiSettings />);
    const row = await expand(/Main: Claude/);
    expect(within(row).queryByRole("button", { name: "Find models" })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Validate" }));
    expect(await within(row).findByText("Key works · 5 models")).toBeInTheDocument();
    expect(server.writes()).toEqual([expect.objectContaining({ method: "POST", path: "/api/settings/ai/models", body: expect.objectContaining({ id: "s1", provider: "anthropic" }) })]);
  });

  it("a failed Validate shows the server's message", async () => {
    fakeServer({
      "GET /api/settings/ai": () => settings([svc()]),
      "POST /api/settings/ai/models": () => ({ status: 400, json: { error: "Claude said the API key isn't valid" } }),
    });
    renderWithSession(<AiSettings />);
    const row = await expand(/Main: Claude/);
    await userEvent.click(within(row).getByRole("button", { name: "Validate" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("Claude said the API key isn't valid");
  });

  it("Model is a dropdown: Recommended first, then the rest A–Z", async () => {
    fakeServer({
      "GET /api/settings/ai": () => settings([svc()]),
      "POST /api/settings/ai/models": () => ({ models: claudeModels, recommended: claudeRecommended }),
    });
    renderWithSession(<AiSettings />);
    const row = await expand(/Main: Claude/);
    await userEvent.click(within(row).getByRole("button", { name: "Validate" }));
    await within(row).findByText("Key works · 5 models");
    const select = within(row).getByRole("combobox", { name: "Model" });
    const groups = within(select).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("label"))).toEqual(["Recommended", "All models"]);
    expect(within(groups[0]).getAllByRole("option").map((o) => o.textContent)).toEqual(["claude-haiku-4-5", "claude-sonnet-4-5"]);
    expect(within(groups[1]).getAllByRole("option").map((o) => o.textContent)).toEqual(["claude-3-5-haiku-20241022", "claude-haiku-4-5-20251001", "claude-opus-4-1"]);
    expect(select).toHaveValue("claude-haiku-4-5");
  });

  it("a service with no model gets the first recommended one", async () => {
    const server = fakeServer({
      "GET /api/settings/ai": () => settings([]),
      "POST /api/settings/ai/models": () => ({ models: ["gpt-4.1-mini", "gpt-5", "gpt-5-mini", "text-embedding-3-small"], recommended: ["gpt-5-mini", "gpt-5"] }),
      "PUT /api/settings/ai": (b: any) => settings(b.services.map((s: any, i: number) => svc({ ...s, id: `s${i + 1}` }))),
    });
    renderWithSession(<AiSettings />);
    // A new service starts open
    const row = await screen.findByRole("listitem", { name: /Main: OpenAI/ });
    expect(within(row).getByRole("button", { expanded: true })).toBeInTheDocument();
    await userEvent.type(within(row).getByLabelText("API key"), "sk-test");
    await userEvent.click(within(row).getByRole("button", { name: "Validate" }));
    await within(row).findByText("Key works · 4 models");
    expect(within(row).getByRole("combobox", { name: "Model" })).toHaveValue("gpt-5-mini");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes().at(-1)?.body.services[0]).toMatchObject({ provider: "openai", model: "gpt-5-mini", apiKey: "sk-test" });
  });

  it("saved services start collapsed showing name and model; new ones open", async () => {
    fakeServer({ "GET /api/settings/ai": () => settings([svc(), svc({ id: "s2", provider: "openai", name: "OpenAI backup", model: "gpt-5-mini" })]) });
    renderWithSession(<AiSettings />);
    const main = await screen.findByRole("listitem", { name: /Main: Claude/ });
    const backup = screen.getByRole("listitem", { name: /Backup 1: OpenAI backup/ });
    expect(within(main).getByRole("button", { expanded: false })).toHaveTextContent(/Main: Claude.*claude-haiku-4-5/);
    expect(within(backup).getByRole("button", { expanded: false })).toHaveTextContent(/OpenAI backup.*gpt-5-mini/);
    expect(within(main).queryByLabelText("API key")).not.toBeInTheDocument();

    await userEvent.click(within(main).getByRole("button", { expanded: false }));
    expect(within(main).getByLabelText("API key")).toBeInTheDocument();
    expect(within(main).getByRole("button", { expanded: true })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add a backup service" }));
    const added = screen.getByRole("listitem", { name: /Backup 2/ });
    expect(within(added).getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(within(added).getByLabelText("API key")).toBeInTheDocument();
  });

  it("dragging service 2's handle above service 1 saves the new order", async () => {
    const server = fakeServer({
      "GET /api/settings/ai": () => settings([svc(), svc({ id: "s2", provider: "openai", model: "gpt-5-mini" })]),
      "PUT /api/settings/ai": (b: any) => settings(b.services.map((s: any) => svc(s))),
    });
    renderWithSession(<AiSettings />);
    await screen.findByRole("listitem", { name: /Main: Claude/ });
    placeRows();
    const handle = screen.getByRole("button", { name: "Drag to reorder Backup 1: OpenAI" });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 150 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 90 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 20 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 20 });
    expect(screen.getAllByRole("listitem").map((r) => r.getAttribute("aria-label"))).toEqual(["Main: OpenAI", "Backup 1: Claude"]);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes().at(-1)?.body.services.map((s: any) => s.id)).toEqual(["s2", "s1"]);
  });

  it("a dragged service can't leave the list", async () => {
    const server = fakeServer({
      "GET /api/settings/ai": () => settings([svc(), svc({ id: "s2", provider: "openai" }), svc({ id: "s3", provider: "gemini" })]),
      "PUT /api/settings/ai": (b: any) => settings(b.services.map((s: any) => svc(s))),
    });
    renderWithSession(<AiSettings />);
    await screen.findByRole("listitem", { name: /Main: Claude/ });
    placeRows();
    const handle = screen.getByRole("button", { name: "Drag to reorder Main: Claude" });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 5000 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 5000 });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes().at(-1)?.body.services.map((s: any) => s.id)).toEqual(["s2", "s3", "s1"]);

    placeRows();
    const last = screen.getByRole("button", { name: "Drag to reorder Backup 2: Claude" });
    fireEvent.pointerDown(last, { pointerId: 2, button: 0, clientY: 250 });
    fireEvent.pointerMove(last, { pointerId: 2, clientY: -5000 });
    fireEvent.pointerUp(last, { pointerId: 2, clientY: -5000 });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes().at(-1)?.body.services.map((s: any) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("ArrowUp on a focused handle moves the service up; no Move up/down buttons", async () => {
    const server = fakeServer({
      "GET /api/settings/ai": () => settings([svc(), svc({ id: "s2", provider: "openai" })]),
      "PUT /api/settings/ai": (b: any) => settings(b.services.map((s: any) => svc(s))),
    });
    renderWithSession(<AiSettings />);
    await screen.findByRole("listitem", { name: /Main: Claude/ });
    expect(screen.queryByRole("button", { name: "Move up" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move down" })).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Drag to reorder Backup 1: OpenAI" }).focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("listitem").map((r) => r.getAttribute("aria-label"))).toEqual(["Main: OpenAI", "Backup 1: Claude"]);
    expect(screen.getByRole("button", { name: "Drag to reorder Main: OpenAI" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes().at(-1)?.body.services.map((s: any) => s.id)).toEqual(["s2", "s1"]);
  });
});
