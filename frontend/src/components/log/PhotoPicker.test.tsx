import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddFoodSheet from "./AddFoodSheet";
import { fakeServer, type Sent } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { barFood, dayJson } from "../../test/fixtures";

// A label read by the photo AI: every nutrient AI-estimated, the stored photo's id and link
const labelDraft = {
  name: "Greek yogurt",
  brand: "Hillside",
  category: "yogurt",
  icon: "🥛",
  barcode: null as string | null,
  servings: [{ label: "1 cup", grams: 227 }],
  nutrients: { calories: 150, protein_g: 20, fiber_g: 0 },
  aiFields: ["calories", "protein_g", "fiber_g"],
  imageUrl: "/api/photos/p-label",
  override: false,
  source: "ai",
  photoId: "p-label",
};

const jpeg = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type: "image/jpeg" });

function open(routes: Record<string, (b: any, path: string) => unknown> = {}, photos = true) {
  const server = fakeServer({
    "GET /api/day/:date": () => dayJson(),
    "GET /api/foods/recent": () => ({ foods: [] }),
    "GET /api/ai/status": () => ({ ready: photos, provider: photos ? "openai" : null, photos }),
    ...routes,
  });
  renderWithSession(<AddFoodSheet day="2026-11-16" meal="snacks" onClose={vi.fn()} />);
  return server;
}

const analyzed = (server: { sent: Sent[] }) => server.sent.filter((s) => s.method === "POST" && s.path === "/api/photos/analyze");

// Camera button beside the barcode button → the photo step; a choice opens the hidden file input
async function choosePhoto(user: ReturnType<typeof userEvent.setup>, file: File, choice = "Choose a photo") {
  const sheet = screen.getByRole("dialog", { name: "Add food to Snacks" });
  await user.click(within(sheet).getByRole("button", { name: "Photo" }));
  await user.click(await within(sheet).findByRole("button", { name: choice }));
  await user.upload(within(sheet).getByLabelText("Photo file"), file);
  return sheet;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("Photo in Add Food", () => {
  it("choosing a photo posts it as a form upload (mode auto) with the login token", async () => {
    localStorage.setItem("bytesize.token", "tok");
    const server = open({ "POST /api/photos/analyze": () => ({ photoIds: ["p1"], barcode: "0012345678905", food: barFood, errors: [], labelReading: true }) });
    const user = userEvent.setup();
    await choosePhoto(user, jpeg("bar.jpg"));
    await waitFor(() => expect(analyzed(server)).toHaveLength(1));
    const sent = analyzed(server)[0];
    expect(sent.body).toBeInstanceOf(FormData);
    expect(sent.body.get("mode")).toBe("auto");
    expect(sent.body.getAll("images").map((f: File) => f.name)).toEqual(["bar.jpg"]);
    expect(sent.headers.authorization).toBe("Bearer tok");
    expect(sent.headers["content-type"]).toBeUndefined(); // the browser sets the multipart boundary
  });

  it("a photo whose barcode is found opens Track food for it", async () => {
    open({ "POST /api/photos/analyze": () => ({ photoIds: ["p1"], barcode: "0012345678905", food: barFood, errors: [], labelReading: true }) });
    const user = userEvent.setup();
    const sheet = await choosePhoto(user, jpeg("bar.jpg"));
    expect(await within(sheet).findByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(within(sheet).getByText("Peanut butter bar")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Track" })).toBeInTheDocument();
  });

  it("a label draft opens New food prefilled and AI-estimated, with the photo; Save sends photoId", async () => {
    const server = open({
      "POST /api/photos/analyze": () => ({ photoIds: ["p-label"], draft: labelDraft, errors: [], labelReading: true }),
      "POST /api/my-foods": (b) => ({ food: { ...labelDraft, ...b, kind: "user_food", id: 12, source: "mine" } }),
    });
    const user = userEvent.setup();
    const sheet = await choosePhoto(user, jpeg("label.jpg"));
    expect(await within(sheet).findByRole("heading", { name: "New food" })).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Name")).toHaveValue("Greek yogurt");
    expect(within(sheet).getByLabelText("Brand")).toHaveValue("Hillside");
    expect(within(sheet).getByLabelText("Calories")).toHaveValue(150);
    expect(within(sheet).getAllByText("AI estimate")).toHaveLength(3);
    expect(within(sheet).getByRole("img", { name: "Food photo" })).toHaveAttribute("src", "/api/photos/p-label");
    await user.click(within(sheet).getByRole("button", { name: "Save food" }));
    const saved = server.writes().find((w) => w.path === "/api/my-foods")!;
    expect(saved.body).toMatchObject({ name: "Greek yogurt", photoId: "p-label", barcode: null, category: "yogurt", nutrients: { calories: 150, protein_g: 20, fiber_g: 0 } });
    expect([...saved.body.aiFields].sort()).toEqual(["calories", "fiber_g", "protein_g"]);
    expect(await within(sheet).findByRole("button", { name: "Track" })).toBeInTheDocument();
  });

  it("a barcode with no food plus a label: the draft carries the barcode and Save sends it", async () => {
    const server = open({
      "POST /api/photos/analyze": () => ({ photoIds: ["p-label"], barcode: "0099887766554", draft: { ...labelDraft, barcode: "0099887766554" }, errors: [], labelReading: true }),
      "POST /api/my-foods": (b) => ({ food: { ...labelDraft, ...b, kind: "user_food", id: 12, source: "mine" } }),
    });
    const user = userEvent.setup();
    const sheet = await choosePhoto(user, jpeg("both.jpg"));
    expect(await within(sheet).findByLabelText("Barcode")).toHaveValue("0099887766554");
    await user.click(within(sheet).getByRole("button", { name: "Save food" }));
    expect(server.writes().find((w) => w.path === "/api/my-foods")!.body).toMatchObject({ photoId: "p-label", barcode: "0099887766554" });
  });

  it("without a photo-reading AI: Read a label is hidden and says why, and barcodes still work", async () => {
    open({ "POST /api/photos/analyze": () => ({ photoIds: ["p1"], barcode: "0012345678905", food: barFood, errors: [], labelReading: false }) }, false);
    const user = userEvent.setup();
    const sheet = screen.getByRole("dialog", { name: "Add food to Snacks" });
    await user.click(within(sheet).getByRole("button", { name: "Photo" }));
    expect(await within(sheet).findByText("Add an AI service that reads photos to read labels")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Read a label" })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Choose a photo" }));
    await user.upload(within(sheet).getByLabelText("Photo file"), jpeg("bar.jpg"));
    expect(await within(sheet).findByRole("heading", { name: "Track food" })).toBeInTheDocument();
  });

  it("no barcode and no label reading: says why and offers to create the food", async () => {
    open({ "POST /api/photos/analyze": () => ({ photoIds: ["p1"], errors: [], labelReading: false }) }, false);
    const user = userEvent.setup();
    const sheet = await choosePhoto(user, jpeg("plate.jpg"));
    expect(await within(sheet).findByText("No barcode found in that photo.")).toBeInTheDocument();
    expect(within(sheet).getAllByText("Add an AI service that reads photos to read labels").length).toBeGreaterThan(0);
    await user.click(within(sheet).getByRole("button", { name: "Create food" }));
    expect(within(sheet).getByRole("heading", { name: "New food" })).toBeInTheDocument();
  });

  it("a refused upload shows the server's message", async () => {
    open({ "POST /api/photos/analyze": () => ({ status: 400, json: { error: "Use a JPEG or PNG photo" } }) });
    const user = userEvent.setup();
    const sheet = await choosePhoto(user, jpeg("photo.heic"));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Use a JPEG or PNG photo");
  });

  it("an AI that couldn't read the label shows its message", async () => {
    open({ "POST /api/photos/analyze": () => ({ photoIds: ["p1"], errors: [{ source: "ai", message: "The AI couldn't read a nutrition label in that photo." }], labelReading: true }) });
    const user = userEvent.setup();
    const sheet = await choosePhoto(user, jpeg("blurry.jpg"));
    expect(await within(sheet).findByText("The AI couldn't read a nutrition label in that photo.")).toBeInTheDocument();
  });

  it("Read a label sends mode label", async () => {
    const server = open({ "POST /api/photos/analyze": () => ({ photoIds: ["p-label"], draft: labelDraft, errors: [], labelReading: true }) });
    const user = userEvent.setup();
    const sheet = await choosePhoto(user, jpeg("label.jpg"), "Read a label");
    await within(sheet).findByRole("heading", { name: "New food" });
    expect(analyzed(server)[0].body.get("mode")).toBe("label");
  });

  it("a barcode found nowhere offers a label photo, and sends both photos together", async () => {
    const server = open({
      "POST /api/photos/analyze": (b: FormData) =>
        b.getAll("images").length === 1
          ? { photoIds: ["p1"], barcode: "0099887766554", errors: [], labelReading: true }
          : { photoIds: ["p2", "p3"], barcode: "0099887766554", draft: { ...labelDraft, photoId: "p3", barcode: "0099887766554" }, errors: [], labelReading: true },
    });
    const user = userEvent.setup();
    const sheet = await choosePhoto(user, jpeg("barcode.jpg"));
    expect(await within(sheet).findByText("Nothing has barcode 0099887766554 yet.")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Add a label photo" }));
    await user.upload(within(sheet).getByLabelText("Photo file"), jpeg("label.jpg"));
    expect(await within(sheet).findByRole("heading", { name: "New food" })).toBeInTheDocument();
    const second = analyzed(server)[1].body as FormData;
    expect(second.getAll("images").map((f) => (f as File).name)).toEqual(["barcode.jpg", "label.jpg"]);
    expect(second.get("mode")).toBe("auto");
    expect(within(sheet).getByLabelText("Barcode")).toHaveValue("0099887766554");
  });

  it("a barcode photo on a label draft is sent alone (mode barcode) and only fills the barcode: your edits stay", async () => {
    const server = open({
      "POST /api/photos/analyze": (b: FormData) =>
        b.get("mode") === "barcode"
          ? { photoIds: ["p4"], barcode: "0012345678905", food: barFood, errors: [], labelReading: true }
          : { photoIds: ["p-label"], draft: labelDraft, errors: [], labelReading: true },
    });
    const user = userEvent.setup();
    const sheet = await choosePhoto(user, jpeg("label.jpg"));
    await within(sheet).findByRole("heading", { name: "New food" });
    const name = within(sheet).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Greek yogurt, plain");
    await user.click(within(sheet).getByRole("button", { name: "Add a barcode photo" }));
    await user.upload(within(sheet).getByLabelText("Photo file"), jpeg("barcode.jpg"));
    await waitFor(() => expect(within(sheet).getByLabelText("Barcode")).toHaveValue("0012345678905"));
    expect(within(sheet).getByRole("heading", { name: "New food" })).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Name")).toHaveValue("Greek yogurt, plain");
    const calls = analyzed(server);
    expect(calls).toHaveLength(2); // the label read, then the barcode photo alone
    const second = calls[1].body as FormData;
    expect(second.getAll("images").map((f) => (f as File).name)).toEqual(["barcode.jpg"]);
    expect(second.get("mode")).toBe("barcode");
    expect(within(sheet).queryByRole("button", { name: "Add a barcode photo" })).not.toBeInTheDocument();
  });

  it("a barcode photo with no barcode in it says so and keeps the draft as edited", async () => {
    open({
      "POST /api/photos/analyze": (b: FormData) =>
        b.get("mode") === "barcode" ? { photoIds: ["p4"], errors: [], labelReading: true } : { photoIds: ["p-label"], draft: labelDraft, errors: [], labelReading: true },
    });
    const user = userEvent.setup();
    const sheet = await choosePhoto(user, jpeg("label.jpg"));
    await within(sheet).findByRole("heading", { name: "New food" });
    const name = within(sheet).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Yogurt");
    await user.click(within(sheet).getByRole("button", { name: "Add a barcode photo" }));
    await user.upload(within(sheet).getByLabelText("Photo file"), jpeg("blurry.jpg"));
    expect(await within(sheet).findByText("No barcode found in that photo")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Name")).toHaveValue("Yogurt");
    expect(within(sheet).getByLabelText("Barcode")).toHaveValue("");
  });

  it("with two photos sent there is no offer to add another", async () => {
    open({
      "POST /api/photos/analyze": (b: FormData) =>
        b.getAll("images").length === 1 ? { photoIds: ["p1"], barcode: "0099887766554", errors: [], labelReading: true } : { photoIds: ["p2", "p3"], barcode: "0099887766554", errors: [{ source: "ai", message: "The AI didn't answer" }], labelReading: true },
    });
    const user = userEvent.setup();
    const sheet = await choosePhoto(user, jpeg("barcode.jpg"));
    await user.click(await within(sheet).findByRole("button", { name: "Add a label photo" }));
    await user.upload(within(sheet).getByLabelText("Photo file"), jpeg("label.jpg"));
    expect(await within(sheet).findByText("The AI didn't answer")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /Add a (label|barcode) photo/ })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Create food" }));
    expect(within(sheet).getByLabelText("Barcode")).toHaveValue("0099887766554");
  });
});
