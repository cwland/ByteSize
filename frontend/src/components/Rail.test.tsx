import { describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import Rail from "./Rail";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { settingsMe } from "../test/fixtures";

// §46: the rail's GLP-1 item comes from the settings the app already reads (glp1On), so it doesn't pop in after two
// requests of its own on every mount
const glp1Item = () => within(screen.getByRole("navigation", { name: "Main" })).queryByRole("link", { name: "GLP-1" });

describe("the rail's GLP-1 item (§46)", () => {
  it("comes from the settings: one request, never GLP-1's or the body's", async () => {
    const server = fakeServer({ "GET /api/settings/me": () => ({ ...settingsMe, glp1On: true }) });
    renderWithSession(<Rail page="goals" />);
    expect(await within(screen.getByRole("navigation", { name: "Main" })).findByRole("link", { name: "GLP-1" })).toHaveAttribute("href", "#/glp1");
    const paths = server.sent.map((s) => s.path.split("?")[0]);
    expect(paths).toEqual(["/api/settings/me"]);
  });

  it("drawn again (another page), it's there from the first paint", async () => {
    fakeServer({ "GET /api/settings/me": () => ({ ...settingsMe, glp1On: true }) });
    renderWithSession(<Rail page="goals" />);
    await within(screen.getByRole("navigation", { name: "Main" })).findByRole("link", { name: "GLP-1" });
    cleanup();
    fakeServer({ "GET /api/settings/me": () => new Promise(() => {}) }); // not answered yet
    renderWithSession(<Rail page="settings" />);
    expect(glp1Item()).toBeInTheDocument();
  });

  it("after a reload, the look remembered on this device has it from the first paint", () => {
    localStorage.setItem("bytesize-look:1", JSON.stringify({ dateFormat: "iso", weekStart: 1, glp1On: true }));
    fakeServer({ "GET /api/settings/me": () => new Promise(() => {}) });
    renderWithSession(<Rail page="goals" />, { id: 1 });
    expect(glp1Item()).toBeInTheDocument();
  });

  it("off: no item, and it goes when the settings say so", async () => {
    localStorage.setItem("bytesize-look:1", JSON.stringify({ dateFormat: "iso", weekStart: 1, glp1On: true }));
    fakeServer({ "GET /api/settings/me": () => ({ ...settingsMe, glp1On: false }) });
    renderWithSession(<Rail page="goals" />, { id: 1 });
    expect(glp1Item()).toBeInTheDocument(); // as remembered, until the settings answer
    await waitFor(() => expect(glp1Item()).toBeNull());
    expect(JSON.parse(localStorage.getItem("bytesize-look:1")!)).toMatchObject({ glp1On: false });
  });
});
