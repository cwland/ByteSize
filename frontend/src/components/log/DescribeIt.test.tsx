import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FoodHost from "../../test/FoodHost";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { culuryOff, dayJson, restaurantRoutes, settingsMe } from "../../test/fixtures";

// Describe it (§23): feedback while the AI works, Cancel, "Did you mean", and plain errors

const cheerios = {
  name: "Cheerios",
  brand: "General Mills",
  icon: "🥣",
  barcode: null,
  servings: [{ label: "1 cup", grams: 28 }],
  nutrients: { calories: 100, protein_g: 3, fiber_g: 3, carbs_g: 20 },
  aiFields: ["calories", "protein_g", "fiber_g", "carbs_g"],
  imageUrl: null,
  override: false,
  source: "ai",
  category: "cereal",
};

// An answer the server streams as lines; the test sends each line when it wants
function streamed() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) });
  return {
    response: new Response(body, { headers: { "content-type": "application/x-ndjson" } }),
    send: (o: unknown) => ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`)),
    end: () => ctrl.close(),
  };
}

function open(estimate: (b: any) => unknown) {
  const server = fakeServer({
    ...culuryOff,
    "GET /api/day/:date": () => dayJson(),
    "GET /api/settings/me": () => settingsMe,
    "GET /api/foods/recent": () => ({ foods: [] }),
    "GET /api/foods/search": () => ({ groups: [], errors: [] }),
    ...restaurantRoutes,
    "POST /api/ai/estimate": estimate,
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Denver">
      <FoodHost />
    </SelectedDayProvider>,
  );
  return server;
}

async function describeIt(user: ReturnType<typeof userEvent.setup>, text: string) {
  const card = await screen.findByRole("region", { name: "Snacks" });
  await user.click(within(card).getByRole("button", { name: "Add Food" }));
  const sheet = screen.getByRole("dialog", { name: "Add food to Snacks" });
  await user.click(within(sheet).getByRole("button", { name: "Describe it" }));
  await user.type(within(sheet).getByRole("textbox", { name: "Describe the food" }), text);
  await user.click(within(sheet).getByRole("button", { name: "Estimate" }));
  return sheet;
}

describe("Describe it", () => {
  it("shows at once that it's working: button disabled, a turning wheel and 'Estimating… asking AI'; then 'Still estimating… trying another AI'", async () => {
    const answer = streamed();
    const server = open(() => answer.response);
    const user = userEvent.setup();
    const sheet = await describeIt(user, "a large banana");

    const working = await within(sheet).findByRole("status");
    expect(working).toHaveTextContent("Estimating… asking AI");
    const wheel = working.querySelector("svg")!;
    expect(wheel.getAttribute("class")).toMatch(/animate-spin/);
    expect(wheel.getAttribute("class")).toMatch(/motion-reduce:animate-pulse/); // pulses instead with reduced motion
    expect(within(sheet).getByRole("button", { name: "Estimate" })).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    // asked for progress as lines
    expect(server.sent.find((s) => s.path === "/api/ai/estimate")!.headers.accept).toMatch(/application\/x-ndjson/);

    answer.send({ progress: "another" });
    await waitFor(() => expect(within(sheet).getByRole("status")).toHaveTextContent("Still estimating… trying another AI"));
    expect(sheet).not.toHaveTextContent(/OpenRouter|Home AI|OpenAI|Claude|Gemini/);

    answer.send({ food: cheerios, assumed: false });
    answer.end();
    expect(await within(sheet).findByRole("heading", { name: "New food" })).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Name")).toHaveValue("Cheerios");
  });

  it("Cancel stops waiting: the request is aborted, the words stay, nothing is logged", async () => {
    const server = open(() => new Promise(() => {})); // the AI takes its time
    const user = userEvent.setup();
    const sheet = await describeIt(user, "cherios");
    await within(sheet).findByRole("status");
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));

    expect(server.sent.find((s) => s.path === "/api/ai/estimate")!.signal?.aborted).toBe(true);
    expect(within(sheet).getByRole("status")).toBeEmptyDOMElement(); // the live region stays, emptied
    expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(sheet).getByRole("textbox", { name: "Describe the food" })).toHaveValue("cherios");
    expect(within(sheet).getByRole("button", { name: "Estimate" })).toBeEnabled();
    expect(server.writes().filter((w) => w.path.startsWith("/api/log"))).toEqual([]);
  });

  it("‹ Back while it works cancels it, as Cancel does: the request is aborted and a late answer opens nothing (§37)", async () => {
    const answer = streamed();
    const server = open(() => answer.response);
    const user = userEvent.setup();
    const sheet = await describeIt(user, "cherios");
    await within(sheet).findByText("Estimating… asking AI");
    await user.click(within(sheet).getByRole("button", { name: "‹ Back" }));
    expect(server.sent.find((s) => s.path === "/api/ai/estimate")!.signal?.aborted).toBe(true);
    // back at search; nothing jumps to the New food form afterwards
    expect(within(sheet).queryByRole("textbox", { name: "Describe the food" })).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(within(sheet).queryByRole("heading", { name: "New food" })).not.toBeInTheDocument();
    // and Describe it again starts idle, with the words kept
    await user.click(within(sheet).getByRole("button", { name: "Describe it" }));
    expect(within(sheet).getByRole("status")).toBeEmptyDOMElement();
    expect(within(sheet).getByRole("button", { name: "Estimate" })).toBeEnabled();
  });

  it("while idle the status region takes no space (no stray gap by the Estimate button), and is in the flow while working (§37)", async () => {
    open(() => new Promise(() => {}));
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "Snacks" });
    await user.click(within(card).getByRole("button", { name: "Add Food" }));
    const sheet = screen.getByRole("dialog", { name: "Add food to Snacks" });
    await user.click(within(sheet).getByRole("button", { name: "Describe it" }));
    const area = within(sheet).getByRole("status").parentElement!;
    expect(area).toHaveClass("absolute", "size-0", "overflow-hidden"); // out of the layout, still read out
    await user.type(within(sheet).getByRole("textbox", { name: "Describe the food" }), "toast");
    await user.click(within(sheet).getByRole("button", { name: "Estimate" }));
    expect(area).not.toHaveClass("absolute");
  });

  it("a guess worth confirming: Did you mean Cheerios? Yes carries on with that estimate", async () => {
    open(() => ({ food: cheerios, assumed: true, interpretedAs: "Cheerios" }));
    const user = userEvent.setup();
    const sheet = await describeIt(user, "cherios");
    const question = await within(sheet).findByRole("heading", { name: "Did you mean Cheerios?" });
    expect(question).toHaveFocus(); // screen readers hear the question at once
    expect(question).toHaveAttribute("tabindex", "-1");
    expect(sheet).toHaveTextContent("1 cup"); // the estimate is shown under the question
    expect(sheet).toHaveTextContent("100");
    await user.click(within(sheet).getByRole("button", { name: "Yes" }));
    expect(await within(sheet).findByRole("heading", { name: "New food" })).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Name")).toHaveValue("Cheerios");
  });

  it("the status line is there before it starts (an empty live region), so screen readers announce the change", async () => {
    open(() => new Promise(() => {}));
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "Snacks" });
    await user.click(within(card).getByRole("button", { name: "Add Food" }));
    const sheet = screen.getByRole("dialog", { name: "Add food to Snacks" });
    await user.click(within(sheet).getByRole("button", { name: "Describe it" }));
    const status = within(sheet).getByRole("status");
    expect(status).toBeEmptyDOMElement();
    await user.type(within(sheet).getByRole("textbox", { name: "Describe the food" }), "toast");
    await user.click(within(sheet).getByRole("button", { name: "Estimate" }));
    expect(within(sheet).getByRole("status")).toBe(status); // the same element, now with the text
    expect(status).toHaveTextContent("Estimating… asking AI");
  });

  it("no Did you mean when the AI only tidied what was typed (case, spacing, punctuation)", async () => {
    open(() => ({ food: { ...cheerios, name: "Cherios" }, assumed: true, interpretedAs: "Cherios!" }));
    const user = userEvent.setup();
    const sheet = await describeIt(user, "  cherios ");
    expect(await within(sheet).findByRole("heading", { name: "New food" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("heading", { name: /Did you mean/ })).not.toBeInTheDocument();
  });

  it("No, change it: back to the text box with the person's words, ready to edit", async () => {
    open(() => ({ food: cheerios, assumed: true, interpretedAs: "Cheerios" }));
    const user = userEvent.setup();
    const sheet = await describeIt(user, "cherios");
    await user.click(await within(sheet).findByRole("button", { name: "No, change it" }));
    const box = within(sheet).getByRole("textbox", { name: "Describe the food" });
    expect(box).toHaveValue("cherios");
    expect(box).toHaveFocus();
    expect(within(sheet).queryByRole("heading", { name: /Did you mean/ })).not.toBeInTheDocument();
  });

  it("errors are the server's plain words, ending the wait", async () => {
    const answer = streamed();
    open(() => answer.response);
    const user = userEvent.setup();
    const sheet = await describeIt(user, "zxqv blorp");
    await within(sheet).findByRole("status");
    answer.send({ error: "Couldn't work out what that is. Try describing it differently.", status: 422 });
    answer.end();
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Couldn't work out what that is. Try describing it differently.");
    expect(within(sheet).getByRole("status")).toBeEmptyDOMElement();
    expect(within(sheet).getByRole("button", { name: "Estimate" })).toBeEnabled();
  });

  it("a plain (not streamed) error answer is shown too", async () => {
    open(() => ({ status: 502, json: { error: "The AI couldn't estimate that. Try again, or describe it differently." } }));
    const user = userEvent.setup();
    const sheet = await describeIt(user, "cherios");
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("The AI couldn't estimate that. Try again, or describe it differently.");
  });
});
