import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VacationMode from "./VacationMode";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

const region = () => screen.findByRole("region", { name: "Vacation mode" });

describe("Vacation mode", () => {
  it("lists vacations, adds one and removes one", async () => {
    let nextId = 8;
    const server = fakeServer({
      "GET /api/vacations": () => ({ vacations: [{ id: 7, from: "2026-12-20", to: "2027-01-02" }] }),
      "POST /api/vacations": (b) => ({ vacation: { id: nextId++, ...b } }),
      "DELETE /api/vacations/:id": () => ({ status: 204 }),
    });
    renderWithSession(<VacationMode />);
    const box = await region();
    expect(within(box).getByText("Days off don't break your streak")).toBeInTheDocument();
    expect(await within(box).findByText("Dec 20–Jan 2, 2027")).toBeInTheDocument();

    const user = userEvent.setup();
    fireEvent.change(within(box).getByLabelText("From"), { target: { value: "2026-11-26" } });
    fireEvent.change(within(box).getByLabelText("To"), { target: { value: "2026-11-29" } });
    await user.click(within(box).getByRole("button", { name: "Add vacation" }));
    expect(server.writes()[0]).toMatchObject({ method: "POST", path: "/api/vacations", body: { from: "2026-11-26", to: "2026-11-29" } });
    expect(await within(box).findByText("Nov 26–29, 2026")).toBeInTheDocument();
    // Newest first, as the server lists them
    expect(within(box).getAllByRole("listitem")[0]).toHaveTextContent("Dec 20–Jan 2, 2027");

    await user.click(within(box).getByRole("button", { name: "Remove vacation Dec 20–Jan 2, 2027" }));
    expect(server.writes()[1]).toMatchObject({ method: "DELETE", path: "/api/vacations/7" });
    expect(within(box).queryByText("Dec 20–Jan 2, 2027")).toBeNull();
    expect(within(box).getAllByRole("listitem")).toHaveLength(1);
  });

  it("shows the server's message when a range is refused", async () => {
    fakeServer({
      "GET /api/vacations": () => ({ vacations: [] }),
      "POST /api/vacations": () => ({ status: 400, json: { error: "The end can't be before the start" } }),
    });
    renderWithSession(<VacationMode />);
    const box = await region();
    expect(await within(box).findByText("No vacations set")).toBeInTheDocument();
    fireEvent.change(within(box).getByLabelText("From"), { target: { value: "2026-11-29" } });
    fireEvent.change(within(box).getByLabelText("To"), { target: { value: "2026-11-26" } });
    await userEvent.setup().click(within(box).getByRole("button", { name: "Add vacation" }));
    expect(await within(box).findByRole("alert")).toHaveTextContent("The end can't be before the start");
  });

  it("needs both dates before adding", async () => {
    const server = fakeServer({ "GET /api/vacations": () => ({ vacations: [] }) });
    renderWithSession(<VacationMode />);
    const box = await region();
    expect(within(box).getByRole("button", { name: "Add vacation" })).toBeDisabled();
    fireEvent.change(within(box).getByLabelText("From"), { target: { value: "2026-11-29" } });
    expect(within(box).getByRole("button", { name: "Add vacation" })).toBeDisabled();
    expect(server.writes()).toEqual([]);
  });
});
