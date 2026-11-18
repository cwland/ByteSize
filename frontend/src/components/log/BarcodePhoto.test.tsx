import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FoodHost from "../../test/FoodHost";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { barFood, culuryOff, dayJson, restaurantRoutes, settingsMe } from "../../test/fixtures";

// Add food › barcode (§25): type the number, or upload a photo of the barcode

function open(analyze: (form: FormData) => unknown) {
  const server = fakeServer({
    ...culuryOff,
    "GET /api/day/:date": () => dayJson(),
    "GET /api/settings/me": () => settingsMe,
    "GET /api/foods/recent": () => ({ foods: [] }),
    "GET /api/ai/status": () => ({ ready: true, photos: true }),
    ...restaurantRoutes,
    "POST /api/photos/analyze": analyze,
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <FoodHost />
    </SelectedDayProvider>,
  );
  return server;
}

async function openBarcode(user: ReturnType<typeof userEvent.setup>) {
  const card = await screen.findByRole("region", { name: "Snacks" });
  await user.click(within(card).getByRole("button", { name: "Add Food" }));
  const sheet = screen.getByRole("dialog", { name: "Add food to Snacks" });
  await user.click(within(sheet).getByRole("button", { name: "Barcode" }));
  return sheet;
}

const modes = (server: ReturnType<typeof fakeServer>) => server.sent.filter((s) => s.path === "/api/photos/analyze").map((s) => (s.body as FormData).get("mode"));

describe("Barcode: upload a photo of it", () => {
  it("the number box tells password managers to leave it alone", async () => {
    open(() => ({}));
    const sheet = await openBarcode(userEvent.setup());
    const box = within(sheet).getByRole("textbox", { name: "Barcode number" });
    expect(box).toHaveAttribute("autocomplete", "off");
    expect(box).toHaveAttribute("data-1p-ignore");
    expect(box).toHaveAttribute("data-lpignore", "true");
  });

  it("Upload a barcode photo, under the number box, opens the photo picker in barcode mode; a found barcode's food opens", async () => {
    const server = open(() => ({ photoIds: ["p1"], barcode: "0012345678905", food: barFood, errors: [], labelReading: true }));
    const user = userEvent.setup();
    const sheet = await openBarcode(user);
    const box = within(sheet).getByRole("textbox", { name: "Barcode number" });
    const upload = within(sheet).getByRole("button", { name: "Upload a barcode photo" });
    expect(box.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(upload.querySelector("svg")).not.toBeNull(); // camera icon

    await user.click(upload);
    expect(within(sheet).getByRole("heading", { name: "Photo" })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Choose a photo" }));
    await user.upload(within(sheet).getByLabelText("Photo file"), new File(["x"], "barcode.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(modes(server)).toEqual(["barcode"]));
    expect(await within(sheet).findByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent("Peanut butter bar");
  });

  it("no barcode in the photo: offers another photo (still barcode mode) or typing the number", async () => {
    const server = open(() => ({ photoIds: ["p1"], errors: [], labelReading: true }));
    const user = userEvent.setup();
    const sheet = await openBarcode(user);
    await user.click(within(sheet).getByRole("button", { name: "Upload a barcode photo" }));
    await user.click(within(sheet).getByRole("button", { name: "Choose a photo" }));
    await user.upload(within(sheet).getByLabelText("Photo file"), new File(["x"], "blurry.jpg", { type: "image/jpeg" }));
    expect(await within(sheet).findByText("No barcode found in that photo.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Add a barcode photo" })).not.toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Try another photo" }));
    await user.upload(within(sheet).getByLabelText("Photo file"), new File(["y"], "sharper.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(modes(server)).toEqual(["barcode", "barcode"]));

    await user.click(await within(sheet).findByRole("button", { name: "Type the number" }));
    expect(within(sheet).getByRole("textbox", { name: "Barcode number" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Barcode" })).toHaveAttribute("aria-pressed", "true");
  });
});
