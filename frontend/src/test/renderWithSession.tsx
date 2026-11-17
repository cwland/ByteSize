import { vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { SessionContext, type User } from "../session";
import { userJson } from "./fakeServer";

// A screen as a signed-in person sees it
export function renderWithSession(ui: ReactNode, over: Partial<User> = {}) {
  const session = {
    user: userJson(over) as User,
    setUser: vi.fn(),
    refresh: vi.fn(async () => {}),
    replaceToken: vi.fn(),
    signOut: vi.fn(),
    signOutEverywhere: vi.fn(async () => {}),
  };
  return { session, ...render(<SessionContext.Provider value={session}>{ui}</SessionContext.Provider>) };
}
