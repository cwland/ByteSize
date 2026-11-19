import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppShell from "./components/AppShell";
import { IconButton, IconLink } from "./components/ui/IconButton";
import { fakeServer } from "./test/fakeServer";
import { renderWithSession } from "./test/renderWithSession";
import { wideScreen } from "./test/wide";
import { iconOnlyOffenders } from "./test/iconAudit";
import { culuryOff, dayJson, entryJson, m3Routes, mealTotals, restaurantRoutes, settingsMe } from "./test/fixtures";
import { glp1View } from "./test/glp1Fixtures";
import { weightJson } from "./test/weightFixtures";

// §44: every button or link that shows only an icon has hover text (title) and the same words as its accessible
// name (aria-label). src/test/setup.ts runs the same check on the last screen of every test in the suite; this walks
// the main screens, wide and phone, and the sheets they open.

const toast = entryJson();
const day = dayJson({
  entries: [toast, entryJson({ id: 2, meal: "lunch", name: "Peanut butter bar" })],
  totals: { calories: 287, protein_g: 16, unknownCount: {} },
  meals: { breakfast: mealTotals(160, { suggested: 392 }), lunch: mealTotals(127, { suggested: 490 }), dinner: mealTotals(0, { suggested: 686 }), snacks: mealTotals(0, { suggested: 392 }), supplements: mealTotals(0) },
});
const routes = {
  ...m3Routes,
  ...culuryOff,
  ...restaurantRoutes,
  "GET /api/day/:date": () => day,
  "GET /api/settings/me": () => settingsMe,
  "GET /api/weight": () => weightJson(),
  "GET /api/glp1": () => glp1View(),
  "GET /api/foods/recent": () => ({ foods: [] }),
  "GET /api/foods/frequent": () => ({ foods: [] }),
  "GET /api/my-foods": () => ({ foods: [] }),
  "GET /api/ai/status": () => ({ photos: true }),
  "GET /api/settings/ai": () => ({ settings: null }),
  "GET /api/admin/food-sources": () => ({ off: { enabled: true }, usda: { hasKey: false, enabled: false }, spoonacular: { hasKey: false, enabled: false }, fatsecret: { hasKey: false, enabled: false } }),
  "GET /api/passkeys": () => [],
  "GET /api/auth/sessions": () => [],
  "GET /api/auth/logins": () => [],
  "GET /api/keys": () => ({ keys: [] }),
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
});
afterEach(() => void vi.useRealTimers());

const SCREENS = ["#/", "#/goals", "#/log/my-foods?from=/", "#/glp1", ...["profile", "api-keys", "security", "integrations", "cached-data", "email", "data", "app-info", "users", "logs"].map((t) => `#/settings/${t}`)];

async function show(hash: string, wide: boolean) {
  window.location.hash = hash;
  wideScreen(wide);
  fakeServer(routes);
  renderWithSession(<AppShell />, { timezone: "America/Denver", isAdmin: true });
  await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull(), { timeout: 2000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 50));
}

describe("hover text on icon buttons (§44)", () => {
  for (const wide of [true, false]) {
    for (const hash of SCREENS) {
      it(`${hash} (${wide ? "wide" : "phone"}) has no icon-only control without a name and hover text`, async () => {
        await show(hash, wide);
        expect(iconOnlyOffenders()).toEqual([]);
      });
    }
  }

  it("the Add food sheet and its search, barcode and describe views", async () => {
    const user = userEvent.setup();
    await show("#/", false);
    await user.click(screen.getByRole("button", { name: "Log food" }));
    await screen.findByRole("dialog", { name: /Add food/ });
    expect(iconOnlyOffenders()).toEqual([]);
    await user.click(await screen.findByRole("button", { name: "Barcode" }));
    expect(iconOnlyOffenders()).toEqual([]);
    await user.click(screen.getAllByRole("button", { name: "Photo" }).find((b) => b.hasAttribute("title"))!);
    expect(iconOnlyOffenders()).toEqual([]);
  });

  it("the calendar and the week strip", async () => {
    const user = userEvent.setup();
    await show("#/", false);
    await user.click(screen.getByRole("button", { name: "Choose a day" }));
    await screen.findByRole("dialog", { name: "Choose a day" });
    expect(iconOnlyOffenders()).toEqual([]);
  });

  it("IconButton and IconLink give the label as both the accessible name and the hover text", () => {
    renderWithSession(
      <>
        <IconButton label="Delete Banana">x</IconButton>
        <IconLink href="#/" label="Go home">x</IconLink>
      </>,
    );
    expect(screen.getByRole("button", { name: "Delete Banana" })).toHaveAttribute("title", "Delete Banana");
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("title", "Go home");
  });

  it("the check itself catches a bare icon, a missing title and a missing name", () => {
    document.body.innerHTML = `<button><svg></svg></button><button aria-label="Close"><svg></svg></button><a href="#/" title="Home"><svg></svg></a><button title="Ok" aria-label="Ok"><svg></svg></button><button>Save</button>`;
    expect(iconOnlyOffenders()).toHaveLength(3);
    document.body.innerHTML = "";
  });
});
