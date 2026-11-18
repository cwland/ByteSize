import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataSettings from "./DataSettings";
import WeightImport from "./WeightImport";
import { fakeServer, type Sent } from "../../test/fakeServer";
import { weightImportPreview } from "../../test/fixtures";
import { renderWithSession } from "../../test/renderWithSession";

// Settings › Data › Import weight history (design §19): choose a CSV, check the preview, import.
afterEach(() => vi.restoreAllMocks());

const csv = (name = "weights.csv", size?: number) => {
  const f = new File(["Date,Weight\n11/16/2026,214.2\n"], name, { type: "text/csv" });
  if (size !== undefined) Object.defineProperty(f, "size", { value: size });
  return f;
};
const fields = (s: Sent) => Object.fromEntries([...(s.body as FormData).entries()].filter(([k]) => k !== "file"));
const previews = (sent: Sent[]) => sent.filter((s) => s.path === "/api/weight/import/preview");
const imports = (sent: Sent[]) => sent.filter((s) => s.path === "/api/weight/import");
const choose = (file = csv()) => userEvent.upload(screen.getByLabelText("Choose a CSV file"), file);
const imported = { imported: 211, kept: 3, replaced: 0, from: "2025-01-03", to: "2026-11-16" };

describe("Import weight history", () => {
  it("is a card in Settings › Data for everyone", () => {
    fakeServer({});
    renderWithSession(<DataSettings />, { isAdmin: false });
    const card = screen.getByRole("region", { name: "Import weight history" });
    expect(within(card).getByLabelText("Choose a CSV file")).toBeInTheDocument();
  });

  it("choosing a file previews it: guessed columns, units, date format, a summary, unreadable rows and the first rows", async () => {
    const { sent } = fakeServer({ "POST /api/weight/import/preview": () => weightImportPreview });
    renderWithSession(<WeightImport />);
    await choose();
    expect(await screen.findByText("214 weigh-ins from Jan 3, 2025 to Nov 16, 2026")).toBeInTheDocument();
    const [p] = previews(sent);
    expect((p.body as FormData).get("file")).toBeInstanceOf(File);
    expect(((p.body as FormData).get("file") as File).name).toBe("weights.csv");
    expect(fields(p)).toEqual({}); // the server guesses everything the first time
    expect(screen.getByRole("combobox", { name: "Date column" })).toHaveDisplayValue("Date");
    expect(screen.getByRole("combobox", { name: "Weight column" })).toHaveDisplayValue("Weight");
    expect(screen.getByRole("combobox", { name: "Units in the file" })).toHaveDisplayValue("Pounds (lb)");
    expect(screen.getByRole("combobox", { name: "Date format" })).toHaveDisplayValue("Month/Day/Year");
    expect(screen.getByText("3 of these days already have a weigh-in in ByteSize.")).toBeInTheDocument();
    expect(screen.getByText("2 rows can't be read:")).toBeInTheDocument();
    expect(screen.getByText('Line 5: Can\'t read the weight "abc"')).toBeInTheDocument();
    expect(screen.getByText("Line 9: Date is in the future")).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "First rows as they will be saved" })).getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toEqual(["DateWeight", "Nov 16, 2026214.2 lb", "Nov 15, 2026214.8 lb"]);
    expect(screen.getByRole("radio", { name: "Keep what's in ByteSize" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("shows the first rows in the person's units", async () => {
    fakeServer({ "POST /api/weight/import/preview": () => weightImportPreview });
    renderWithSession(<WeightImport />, { units: "metric" });
    await choose();
    expect(await screen.findByText("97.2 kg")).toBeInTheDocument();
  });

  it("changing a dropdown previews again with the choices so far", async () => {
    const { sent } = fakeServer({
      "POST /api/weight/import/preview": (body: FormData) => ({
        ...weightImportPreview,
        weightColumn: Number(body.get("weightColumn") ?? 1),
        units: body.get("units") ?? "lb",
        dateFormat: body.get("dateFormat") ?? "mdy",
        count: body.get("dateFormat") === "dmy" ? 120 : 214,
      }),
    });
    renderWithSession(<WeightImport />);
    await choose();
    await screen.findByText("214 weigh-ins from Jan 3, 2025 to Nov 16, 2026");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Weight column" }), "BMI");
    await waitFor(() => expect(previews(sent)).toHaveLength(2));
    expect(fields(previews(sent)[1])).toEqual({ weightColumn: "2" });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Weight column" })).toHaveDisplayValue("BMI"));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Units in the file" }), "Kilograms (kg)");
    await waitFor(() => expect(previews(sent)).toHaveLength(3));
    expect(fields(previews(sent)[2])).toEqual({ weightColumn: "2", units: "kg" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date format" }), "Day/Month/Year");
    expect(await screen.findByText("120 weigh-ins from Jan 3, 2025 to Nov 16, 2026")).toBeInTheDocument();
    expect(fields(previews(sent)[3])).toEqual({ weightColumn: "2", units: "kg", dateFormat: "dmy" });
    expect((previews(sent)[3].body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("imports with the previewed options, keeping existing days by default; says how many; weight screens reload", async () => {
    const { sent } = fakeServer({ "POST /api/weight/import/preview": () => weightImportPreview, "POST /api/weight/import": () => imported });
    const changed = vi.fn();
    window.addEventListener("bytesize:weight-changed", changed);
    renderWithSession(<WeightImport />);
    await choose();
    await userEvent.click(await screen.findByRole("button", { name: "Import" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Imported 211 weigh-ins. Kept the 3 days already in ByteSize.");
    expect(fields(imports(sent)[0])).toEqual({ dateColumn: "0", weightColumn: "1", units: "lb", dateFormat: "mdy", existing: "keep" });
    expect((imports(sent)[0].body as FormData).get("file")).toBeInstanceOf(File);
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener("bytesize:weight-changed", changed);
    // Back to the start, ready for another file
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Choose a CSV file")).toBeInTheDocument();
  });

  it("sends replace when the person chooses the file's weigh-ins for days already in ByteSize", async () => {
    const { sent } = fakeServer({ "POST /api/weight/import/preview": () => weightImportPreview, "POST /api/weight/import": () => ({ ...imported, imported: 214, kept: 0, replaced: 3 }) });
    renderWithSession(<WeightImport />);
    await choose();
    await userEvent.click(await screen.findByRole("radio", { name: "Replace with the file's" }));
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Imported 214 weigh-ins. Replaced 3 days that were already in ByteSize.");
    expect(fields(imports(sent)[0]).existing).toBe("replace");
  });

  it("asks nothing about existing days when there are none; nothing readable: Import is off", async () => {
    fakeServer({ "POST /api/weight/import/preview": () => ({ ...weightImportPreview, existingDays: 0, count: 0, from: null, to: null, rows: [], dateFormatMatters: false }) });
    renderWithSession(<WeightImport />);
    await choose();
    expect(await screen.findByText("No weigh-ins can be read with these choices. Try another column or date format.")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Keep what's in ByteSize" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Date format" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("shows the server's message when a file can't be read", async () => {
    fakeServer({ "POST /api/weight/import/preview": () => ({ status: 400, json: { error: "That file isn't a CSV file. Choose the .csv file your old app exported." } }) });
    renderWithSession(<WeightImport />);
    await choose(csv("photo.csv"));
    expect(await screen.findByRole("alert")).toHaveTextContent("That file isn't a CSV file. Choose the .csv file your old app exported.");
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
  });

  it("a choice the server refuses keeps the last good preview and shows why", async () => {
    let n = 0;
    fakeServer({ "POST /api/weight/import/preview": () => (n++ ? { status: 400, json: { error: "Choose different columns for the date and the weight." } } : weightImportPreview) });
    renderWithSession(<WeightImport />);
    await choose();
    await screen.findByText("214 weigh-ins from Jan 3, 2025 to Nov 16, 2026");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date column" }), "Weight");
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose different columns for the date and the weight.");
    expect(screen.getByRole("combobox", { name: "Date column" })).toHaveDisplayValue("Date");
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("shows an import error and keeps the preview", async () => {
    fakeServer({ "POST /api/weight/import/preview": () => weightImportPreview, "POST /api/weight/import": () => ({ status: 429, json: { error: "Too many tries. Wait 42 seconds and try again." } }) });
    renderWithSession(<WeightImport />);
    await choose();
    await userEvent.click(await screen.findByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries. Wait 42 seconds and try again.");
    expect(screen.getByText("214 weigh-ins from Jan 3, 2025 to Nov 16, 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("a file over 5 MB is refused before it is sent", async () => {
    const { sent } = fakeServer({});
    renderWithSession(<WeightImport />);
    await choose(csv("big.csv", 5 * 1024 * 1024 + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent("The file must be 5 MB or less.");
    expect(sent).toEqual([]);
  });

  it("Cancel goes back to choosing a file", async () => {
    fakeServer({ "POST /api/weight/import/preview": () => weightImportPreview });
    renderWithSession(<WeightImport />);
    await choose();
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("214 weigh-ins from Jan 3, 2025 to Nov 16, 2026")).not.toBeInTheDocument();
  });
});
