/// <reference types="node" /> // reads both package.json files
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppShell from "./AppShell";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { CHANGELOG, changeCount, isNewer } from "../changelog";
import { APP_VERSION } from "../version";

// W1 (SPEC-15): "What's new" once per version after an update, and from the version number in the bottom left.

describe("the version", () => {
  it("is the same in both apps and the newest changelog entry", () => {
    const version = (dir: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", dir, "package.json"), "utf8")).version;
    expect(version("frontend")).toBe(version("backend"));
    expect(CHANGELOG[0].version).toBe(version("frontend"));
    expect(APP_VERSION).toBe(version("frontend"));
  });

  it("compares as numbers", () => {
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.2.0", null)).toBe(true);
  });
});

describe("What's new", () => {
  afterEach(() => void (window.location.hash = "#/"));

  it("shows once after an update, and Got it remembers it", async () => {
    const server = fakeServer({ "PUT /api/auth/seen-version": (b) => ({ seenVersion: b.version }) });
    renderWithSession(<AppShell />, { timezone: "America/Denver", seenVersion: "0.1.0" });
    const news = await screen.findByRole("dialog", { name: "What's new" });
    // Everything since 0.1.0 is open; what you'd already seen is a folded row
    for (const r of CHANGELOG.filter((r) => isNewer(r.version, "0.1.0"))) expect(within(news).getByRole("region", { name: `Version ${r.version}` })).toBeInTheDocument();
    expect(within(news).queryByRole("region", { name: "Version 0.1.0" })).not.toBeInTheDocument();
    expect(within(news).getByRole("button", { name: /^Version 0\.1\.0/ })).toHaveAttribute("aria-expanded", "false");
    await userEvent.setup().click(within(news).getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(server.writes()).toContainEqual(expect.objectContaining({ method: "PUT", path: "/api/auth/seen-version", body: { version: APP_VERSION } })));
    expect(screen.queryByRole("dialog", { name: "What's new" })).not.toBeInTheDocument();
  });

  it("doesn't show when this version was already seen", async () => {
    fakeServer({});
    renderWithSession(<AppShell />, { timezone: "America/Denver", seenVersion: APP_VERSION });
    await screen.findAllByRole("navigation");
    expect(screen.queryByRole("dialog", { name: "What's new" })).not.toBeInTheDocument();
  });

  // SPEC-19: the current version in full, earlier ones folded under "Earlier updates" (like YAHD2)
  it("the version in the corner: the current version open, every earlier one folded with its count and date", async () => {
    const server = fakeServer({});
    renderWithSession(<AppShell />, { timezone: "America/Denver", seenVersion: APP_VERSION });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `What's new in v${APP_VERSION}` }));
    const news = screen.getByRole("dialog", { name: "What's new" });
    expect(within(news).getByText(new RegExp(`^ByteSize v${APP_VERSION.replace(/\./g, "\\.")} · `))).toBeInTheDocument();
    const current = within(news).getByRole("region", { name: `Version ${APP_VERSION}` });
    expect(within(current).getByText("Current version")).toBeInTheDocument();
    const earlier = CHANGELOG.slice(1);
    expect(within(news).getByRole("heading", { name: "Earlier updates" })).toBeInTheDocument();
    for (const r of earlier) {
      const row = within(news).getByRole("button", { name: new RegExp(`^Version ${r.version.replace(/\./g, "\\.")}`) });
      expect(row).toHaveAttribute("aria-expanded", "false");
      expect(row).toHaveTextContent(`${changeCount(r)} change${changeCount(r) === 1 ? "" : "s"}`);
      expect(within(news).queryByRole("region", { name: `Version ${r.version}` })).not.toBeInTheDocument();
    }
    // A row opens in place, and closes again
    const row = within(news).getByRole("button", { name: /^Version 0\.1\.0/ });
    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(within(news).getByRole("region", { name: "Version 0.1.0" })).toBeInTheDocument();
    await user.click(row);
    expect(within(news).queryByRole("region", { name: "Version 0.1.0" })).not.toBeInTheDocument();
    await user.click(within(news).getByRole("button", { name: "Got it" }));
    expect(server.writes().filter((w) => w.path === "/api/auth/seen-version")).toHaveLength(0); // nothing new to remember
  });

  it("a version's changes are grouped as Added, Changed and Fixed", async () => {
    fakeServer({});
    renderWithSession(<AppShell />, { timezone: "America/Denver", seenVersion: APP_VERSION });
    await userEvent.setup().click(await screen.findByRole("button", { name: `What's new in v${APP_VERSION}` }));
    const current = within(screen.getByRole("dialog", { name: "What's new" })).getByRole("region", { name: `Version ${APP_VERSION}` });
    const r = CHANGELOG[0];
    const kinds = (["added", "changed", "fixed"] as const).filter((k) => r[k]?.length);
    expect(within(current).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(kinds.map((k) => ({ added: "Added", changed: "Changed", fixed: "Fixed" })[k]));
    for (const k of kinds) for (const c of r[k]!) expect(within(current).getByText(c)).toBeInTheDocument();
  });

  it("every release has at least one change, sorted into a kind", () => {
    for (const r of CHANGELOG) expect(changeCount(r)).toBeGreaterThan(0);
  });
});
