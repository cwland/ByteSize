import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProfileSettings from "./ProfileSettings";
import { fakeServer, userJson } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { settingsMe } from "../../test/fixtures";

describe("ProfileSettings week start", () => {
  it("shows the saved week start and saves a new one with the profile", async () => {
    const server = fakeServer({
      "GET /api/settings/me": () => ({ ...settingsMe, weekStart: 0 }),
      "PATCH /api/profile": (b) => ({ user: userJson(b) }),
      "PUT /api/settings/me": (b) => b,
    });
    renderWithSession(<ProfileSettings />);
    const select = screen.getByRole("combobox", { name: "Week starts on" });
    await waitFor(() => expect(select).toHaveValue("0"));
    expect(screen.getByRole("option", { name: "Sunday" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Saturday" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(select, "Monday");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(server.writes().find((w) => w.path === "/api/settings/me")).toMatchObject({
      method: "PUT",
      body: { mealWindows: settingsMe.mealWindows, waterButtonsMl: settingsMe.waterButtonsMl, weekStart: 1 },
    });
  });

  it("an unchanged week start isn't sent", async () => {
    const server = fakeServer({
      "GET /api/settings/me": () => ({ ...settingsMe, weekStart: 3 }),
      "PATCH /api/profile": (b) => ({ user: userJson(b) }),
      "PUT /api/settings/me": (b) => b,
    });
    renderWithSession(<ProfileSettings />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Week starts on" })).toHaveValue("3"));
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(server.writes().some((w) => w.path === "/api/settings/me")).toBe(false);
  });
});
