/// <reference types="node" /> // reads both package.json files
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppShell from "./AppShell";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { CHANGELOG, isNewer } from "../changelog";
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
    expect(within(news).getByRole("region", { name: `Version ${APP_VERSION}` })).toBeInTheDocument();
    expect(within(news).queryByRole("region", { name: "Version 0.1.0" })).not.toBeInTheDocument(); // what you'd already seen stays a click away
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

  it("the version in the corner opens every version", async () => {
    const server = fakeServer({});
    renderWithSession(<AppShell />, { timezone: "America/Denver", seenVersion: APP_VERSION });
    await userEvent.setup().click(await screen.findByRole("button", { name: `What's new in v${APP_VERSION}` }));
    const news = screen.getByRole("dialog", { name: "What's new" });
    for (const r of CHANGELOG) expect(within(news).getByRole("region", { name: `Version ${r.version}` })).toBeInTheDocument();
    await userEvent.setup().click(within(news).getByRole("button", { name: "Got it" }));
    expect(server.writes().filter((w) => w.path === "/api/auth/seen-version")).toHaveLength(0); // nothing new to remember
  });
});
