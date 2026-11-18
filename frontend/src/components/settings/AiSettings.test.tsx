import { describe, expect, it, vi } from "vitest";
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
    // Collapsed: number, name, place, and a summary line
    expect(within(main).getByRole("textbox", { name: "Service name" })).toHaveAttribute("placeholder", "Claude");
    expect(within(main).getByText("Asked first")).toBeInTheDocument();
    expect(within(main).getByText("Anthropic (Claude) · claude-haiku-4-5")).toBeInTheDocument();
    expect(within(backup).getByRole("textbox", { name: "Service name" })).toHaveValue("OpenAI backup");
    expect(within(backup).getByText("Backup 1")).toBeInTheDocument();
    expect(within(backup).getByText("OpenAI · gpt-5-mini")).toBeInTheDocument();
    expect(within(main).queryByLabelText("API key")).not.toBeInTheDocument();

    await userEvent.click(within(main).getByRole("button", { expanded: false }));
    expect(within(main).getByLabelText("API key")).toBeInTheDocument();
    expect(within(main).getByRole("button", { expanded: true })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "+ Add a backup AI service" }));
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

  it("changing the service clears the model, so Validate picks a recommended one", async () => {
    const server = fakeServer({
      "GET /api/settings/ai": () => settings([svc({ provider: "openai", model: "gpt-5-mini" })]),
      "POST /api/settings/ai/models": (b: any) =>
        b.provider === "anthropic" ? { models: claudeModels, recommended: claudeRecommended } : { models: ["gpt-5", "gpt-5-mini"], recommended: ["gpt-5-mini", "gpt-5"] },
      "PUT /api/settings/ai": (b: any) => settings(b.services.map((s: any) => svc(s))),
    });
    renderWithSession(<AiSettings />);
    const row = await expand(/Main: OpenAI/);
    await userEvent.click(within(row).getByRole("button", { name: "Validate" }));
    await within(row).findByText("Key works · 2 models");
    await userEvent.selectOptions(within(row).getByRole("combobox", { name: "Service" }), "anthropic");
    // The OpenAI list and model are gone
    expect(within(row).getByRole("textbox", { name: "Model" })).toHaveValue("");
    expect(within(row).queryByRole("combobox", { name: "Model" })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Validate" }));
    await within(row).findByText("Key works · 5 models");
    expect(within(row).getByRole("combobox", { name: "Model" })).toHaveValue("claude-haiku-4-5");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes().at(-1)?.body.services[0]).toMatchObject({ provider: "anthropic", model: "claude-haiku-4-5" });
  });

  it("without a model list the model can be typed; after Validate it's a dropdown", async () => {
    let listWorks = false;
    const server = fakeServer({
      "GET /api/settings/ai": () => settings([]),
      "POST /api/settings/ai/models": () => (listWorks ? { models: ["llama3.2:3b", "qwen3:8b"], recommended: [] } : { status: 400, json: { error: "Couldn't reach your AI server" } }),
      "POST /api/settings/ai/test": () => ({ message: "Home AI answered" }),
      "PUT /api/settings/ai": (b: any) => settings(b.services.map((s: any, i: number) => svc({ ...s, id: `s${i + 1}` }))),
    });
    renderWithSession(<AiSettings />);
    const row = await screen.findByRole("listitem", { name: /Main: OpenAI/ });
    await userEvent.selectOptions(within(row).getByRole("combobox", { name: "Service" }), "local");
    await userEvent.type(within(row).getByLabelText("Address"), "http://10.0.0.5:11434/v1");
    // Before Validate: a text field
    expect(within(row).queryByRole("combobox", { name: "Model" })).not.toBeInTheDocument();
    // A failed Validate keeps the text field
    await userEvent.click(within(row).getByRole("button", { name: "Validate" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("Couldn't reach your AI server");
    await userEvent.type(within(row).getByRole("textbox", { name: "Model" }), "llama3.2:3b");
    // No model list, but a passing Test proves it works, so it can be saved
    await userEvent.click(within(row).getByRole("button", { name: "Test" }));
    await within(row).findByText("Home AI answered");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes().at(-1)?.body.services[0]).toMatchObject({ provider: "local", model: "llama3.2:3b" });

    // Once a list loads, Model is a dropdown (Home AI: no Recommended group)
    listWorks = true;
    const saved = await expand(/Main: Home AI/);
    await userEvent.click(within(saved).getByRole("button", { name: "Validate" }));
    await within(saved).findByText("Key works · 2 models");
    expect(within(saved).queryByRole("textbox", { name: "Model" })).not.toBeInTheDocument();
    const select = within(saved).getByRole("combobox", { name: "Model" });
    expect(within(select).getAllByRole("group").map((g) => g.getAttribute("label"))).toEqual(["All models"]);
    expect(select).toHaveValue("llama3.2:3b");
  });

  it("Validate sits right next to the API key", async () => {
    fakeServer({ "GET /api/settings/ai": () => settings([svc()]) });
    renderWithSession(<AiSettings />);
    const row = await expand(/Main: Claude/);
    const keyRow = within(row).getByRole("group", { name: "API key and Validate" });
    expect(within(keyRow).getByLabelText("API key")).toBeInTheDocument();
    expect(within(keyRow).getByRole("button", { name: "Validate" })).toBeInTheDocument();
  });

  it("Save waits until a new or changed service is validated", async () => {
    const server = fakeServer({
      "GET /api/settings/ai": () => settings([svc()]),
      "POST /api/settings/ai/models": () => ({ models: claudeModels, recommended: claudeRecommended }),
      "PUT /api/settings/ai": (b: any) => settings(b.services.map((s: any, i: number) => svc({ ...s, id: `s${i + 1}` }))),
    });
    renderWithSession(<AiSettings />);
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeEnabled(); // saved services were checked when they were saved

    // A changed key needs Validate again
    const row = await expand(/Main: Claude/);
    await userEvent.type(within(row).getByLabelText("API key"), "sk-new");
    expect(save).toBeDisabled();
    expect(screen.getByText("Validate each new or changed service before saving.")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Validate" }));
    await within(row).findByText("Key works · 5 models");
    expect(save).toBeEnabled();

    // A new backup service needs Validate too
    await userEvent.click(screen.getByRole("button", { name: "+ Add a backup AI service" }));
    expect(save).toBeDisabled();
    const backup = screen.getByRole("listitem", { name: /Backup 1/ });
    await userEvent.type(within(backup).getByLabelText("API key"), "sk-2");
    await userEvent.click(within(backup).getByRole("button", { name: "Validate" }));
    await within(backup).findByText("Key works · 5 models");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(server.writes().at(-1)).toMatchObject({ method: "PUT", path: "/api/settings/ai" });
  });

  it("a failed Validate keeps Save off", async () => {
    fakeServer({
      "GET /api/settings/ai": () => settings([svc()]),
      "POST /api/settings/ai/models": () => ({ status: 400, json: { error: "Claude said the API key isn't valid" } }),
    });
    renderWithSession(<AiSettings />);
    const row = await expand(/Main: Claude/);
    await userEvent.type(within(row).getByLabelText("API key"), "sk-bad");
    await userEvent.click(within(row).getByRole("button", { name: "Validate" }));
    await within(row).findByRole("alert");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("the eye button shows and hides the key being typed", async () => {
    fakeServer({ "GET /api/settings/ai": () => settings([svc()]) });
    renderWithSession(<AiSettings />);
    const row = await expand(/Main: Claude/);
    const key = within(row).getByLabelText("API key");
    await userEvent.type(key, "sk-abc");
    expect(key).toHaveAttribute("type", "password");
    await userEvent.click(within(row).getByRole("button", { name: "Show Claude key" }));
    expect(key).toHaveAttribute("type", "text");
    await userEvent.click(within(row).getByRole("button", { name: "Hide Claude key" }));
    expect(key).toHaveAttribute("type", "password");
  });

  it("the eye on a saved key fetches that service's key; Save then sends no key and isn't held back", async () => {
    const server = fakeServer({
      "GET /api/settings/ai": () => settings([svc(), svc({ id: "s2", provider: "openai", name: "OpenAI backup", model: "gpt-5-mini" })]),
      "GET /api/settings/ai/s2/key": () => ({ key: "sk-saved-backup" }),
      "PUT /api/settings/ai": (b: any) => settings(b.services.map((x: any) => svc(x))),
    });
    renderWithSession(<AiSettings />);
    const row = await expand(/Backup 1: OpenAI backup/);
    const key = within(row).getByLabelText("API key");
    await userEvent.click(within(row).getByRole("button", { name: "Show OpenAI backup key" }));
    expect(await within(row).findByDisplayValue("sk-saved-backup")).toBe(key);
    expect(server.sent.filter((r) => r.path.endsWith("/key")).map((r) => r.path)).toEqual(["/api/settings/ai/s2/key"]);
    expect(screen.queryByText("Validate each new or changed service before saving.")).not.toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    const sent = server.writes().at(-1)!.body.services;
    expect(sent[1]).not.toHaveProperty("apiKey");
    expect(JSON.stringify(sent)).not.toContain("sk-saved-backup");
  });

  it("hiding a shown saved key goes back to the saved placeholder; collapsing the service drops it", async () => {
    fakeServer({
      "GET /api/settings/ai": () => settings([svc()]),
      "GET /api/settings/ai/s1/key": () => ({ key: "sk-saved-main" }),
    });
    renderWithSession(<AiSettings />);
    const row = await expand(/Main: Claude/);
    await userEvent.click(within(row).getByRole("button", { name: "Show Claude key" }));
    await within(row).findByDisplayValue("sk-saved-main");
    await userEvent.click(within(row).getByRole("button", { name: "Hide Claude key" }));
    expect(within(row).getByLabelText("API key")).toHaveValue("");
    expect(within(row).getByLabelText("API key")).toHaveAttribute("placeholder", "••••••••");
    await userEvent.click(within(row).getByRole("button", { name: "Show Claude key" }));
    await within(row).findByDisplayValue("sk-saved-main");
    await userEvent.click(within(row).getByRole("button", { name: "Hide Claude settings" }));
    await userEvent.click(within(row).getByRole("button", { name: "Show Claude settings" }));
    expect(within(row).getByLabelText("API key")).toHaveValue("");
    expect(screen.queryByDisplayValue("sk-saved-main")).not.toBeInTheDocument();
  });

  it("editing a shown saved key makes it a new key that needs Validate", async () => {
    const server = fakeServer({
      "GET /api/settings/ai": () => settings([svc()]),
      "GET /api/settings/ai/s1/key": () => ({ key: "sk-saved-main" }),
    });
    renderWithSession(<AiSettings />);
    const row = await expand(/Main: Claude/);
    await userEvent.click(within(row).getByRole("button", { name: "Show Claude key" }));
    await userEvent.type(await within(row).findByDisplayValue("sk-saved-main"), "X");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(server.writes()).toHaveLength(0);
  });

  it("copy puts a saved service's key on the clipboard without showing it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fakeServer({
      "GET /api/settings/ai": () => settings([svc()]),
      "GET /api/settings/ai/s1/key": () => ({ key: "sk-saved-main" }),
    });
    renderWithSession(<AiSettings />);
    const row = await expand(/Main: Claude/);
    await userEvent.click(within(row).getByRole("button", { name: "Copy Claude key" }));
    expect(await within(row).findByText("Copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("sk-saved-main");
    expect(screen.queryByDisplayValue("sk-saved-main")).not.toBeInTheDocument();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("a new service (not saved yet) has no saved key to fetch", async () => {
    const server = fakeServer({ "GET /api/settings/ai": () => settings([]) });
    renderWithSession(<AiSettings />);
    const row = await screen.findByRole("listitem", { name: /Main: OpenAI/ });
    expect(within(row).getByRole("button", { name: "Show OpenAI key" })).toBeDisabled();
    expect(server.sent.filter((r) => r.path.endsWith("/key"))).toHaveLength(0);
  });
});
