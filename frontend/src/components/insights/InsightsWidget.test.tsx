import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import InsightsWidget, { firstLines } from "./InsightsWidget";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { registryFor } from "../dashboard/widgets";
import { defaultLayout, readingOrder } from "../dashboard/layout";

// The Insights widget (§43): the newest recap's first lines and "See all insights"

describe("Insights widget", () => {
  it("shows the newest recap's first lines and links to the page", async () => {
    const server = fakeServer({
      "GET /api/insights/latest": () => ({ aiReady: true, recap: { periodStart: "2026-11-08", periodEnd: "2026-11-14", soFar: false, summary: "A solid week. You hit your range on 2 days. Protein lagged on Tuesday.", createdAt: "2026-11-15T13:05:00Z" } }),
    });
    renderWithSession(<InsightsWidget />);
    const card = await screen.findByRole("region", { name: "Insights" });
    expect(await within(card).findByText("A solid week. You hit your range on 2 days.")).toBeInTheDocument();
    expect(within(card).getByText("Nov 8–14")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "See all insights" })).toHaveAttribute("href", "#/insights");
    expect(server.sent[0].path).toBe("/api/insights/latest");
  });

  it("no recap yet: says when it comes; no AI: says what's needed", async () => {
    fakeServer({ "GET /api/insights/latest": () => ({ aiReady: true, recap: null }) });
    const { unmount } = renderWithSession(<InsightsWidget />);
    expect(await screen.findByText(/Your weekly recap shows here/)).toBeInTheDocument();
    unmount();
    fakeServer({ "GET /api/insights/latest": () => ({ aiReady: false, recap: null }) });
    renderWithSession(<InsightsWidget />);
    expect(await screen.findByText(/Insights need an AI service/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all insights" })).toBeInTheDocument();
  });

  it("first lines: up to two sentences, cut at a word when long", () => {
    expect(firstLines("One. Two! Three?")).toBe("One. Two!");
    expect(firstLines("No stop at all")).toBe("No stop at all");
    expect(firstLines(`${"word ".repeat(60)}end.`).length).toBeLessThanOrEqual(161);
  });

  it("is in the Dashboard's default layout below Day totals (reading order on phones), and offered on Goals", () => {
    const order = readingOrder(defaultLayout(registryFor("dashboard")));
    expect(order.indexOf("insights")).toBe(order.indexOf("day-totals") + 1);
    expect(registryFor("goals").find((w) => w.id === "insights")).toMatchObject({ column: null });
  });
});
