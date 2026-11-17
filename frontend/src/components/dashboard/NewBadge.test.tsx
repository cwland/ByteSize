import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewBadge from "./NewBadge";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

const badges = (ids: string[]) => ({
  badges: [
    { id: "first_weigh_in", earnedOn: "2026-11-02", seen: true },
    { id: "lost_5", earnedOn: "2026-11-14", seen: !ids.includes("lost_5") },
    { id: "lost_10", earnedOn: null, seen: false },
  ],
  new: ids,
});

describe("New badge", () => {
  it("celebrates a new badge once: marks it seen as it shows, and can be dismissed", async () => {
    const server = fakeServer({
      "GET /api/badges": () => badges(["lost_5"]),
      "POST /api/badges/seen": (b) => ({ seen: b.ids }),
    });
    renderWithSession(<NewBadge />);
    const card = await screen.findByRole("region", { name: "New badge" });
    expect(card).toHaveTextContent("New badge: 5 lb down 🎉");
    await waitFor(() => expect(server.writes()).toEqual([expect.objectContaining({ method: "POST", path: "/api/badges/seen", body: { ids: ["lost_5"] } })]));

    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("region", { name: "New badge" })).toBeNull();
    expect(server.writes()).toHaveLength(1);
  });

  it("lists several new badges together, in kilograms for metric", async () => {
    const server = fakeServer({
      "GET /api/badges": () => badges(["first_weigh_in", "lost_5"]),
      "POST /api/badges/seen": (b) => ({ seen: b.ids }),
    });
    renderWithSession(<NewBadge />, { units: "metric" });
    expect(await screen.findByRole("region", { name: "New badges" })).toHaveTextContent("New badges: First weigh-in, 2 kg down 🎉");
    await waitFor(() => expect(server.writes()[0]?.body).toEqual({ ids: ["first_weigh_in", "lost_5"] }));
  });

  it("shows nothing and marks nothing when there is no new badge, or badges can't be loaded", async () => {
    const server = fakeServer({ "GET /api/badges": () => badges([]) });
    const { unmount } = renderWithSession(<NewBadge />);
    await waitFor(() => expect(server.sent).toHaveLength(1));
    expect(screen.queryByRole("region")).toBeNull();
    unmount();

    const failing = fakeServer({});
    renderWithSession(<NewBadge />);
    await waitFor(() => expect(failing.sent).toHaveLength(1));
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(server.writes()).toEqual([]);
  });
});
