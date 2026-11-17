import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { publicUser } from "../lib/users.js";

// Settings › Profile › Theme (the list is in the web app's themes)
export const THEMES = ["avocado", "fresh", "harbor", "terracotta-sage", "slate-rose", "midnight-coral"] as const;

// Your own settings. Who you are comes only from your login, never from the body.
export default async function profileRoutes(app: FastifyInstance) {
  const { db } = app;

  app.patch("/api/profile", async (req) => {
    const userId = requireUser(req);
    const body = z
      .object({
        displayName: z.string().trim().max(100).nullable().optional(),
        email: z.string().trim().email("That doesn't look like an email address").max(200).nullable().optional(),
        theme: z.enum(THEMES, { error: "Choose one of the themes" }).optional(),
        colorMode: z.enum(["light", "dark", "system"], { error: "Choose light, dark or system" }).optional(),
        units: z.enum(["imperial", "metric"], { error: "Choose imperial or metric" }).optional(),
        // Decides where each day starts and ends, so it must be a real IANA name
        timezone: z
          .string()
          .trim()
          .refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "Choose a time zone from the list")
          .optional(),
      })
      .parse(req.body ?? {});

    const changes = {
      ...(body.displayName !== undefined ? { displayName: body.displayName || null } : {}),
      ...(body.email !== undefined ? { email: body.email || null } : {}),
      ...(body.theme !== undefined ? { theme: body.theme } : {}),
      ...(body.colorMode !== undefined ? { colorMode: body.colorMode } : {}),
      ...(body.units !== undefined ? { units: body.units } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
    };
    const [user] = Object.keys(changes).length
      ? await db.update(users).set(changes).where(eq(users.id, userId)).returning()
      : await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new HttpError(401, "Not logged in");
    return { user: publicUser(user) };
  });

  // The setup wizard is done (shown once, on the first sign-in)
  app.post("/api/profile/setup-done", async (req) => {
    const userId = requireUser(req);
    const [user] = await db.update(users).set({ setupDoneAt: app.now() }).where(eq(users.id, userId)).returning();
    if (!user) throw new HttpError(401, "Not logged in");
    return { user: publicUser(user) };
  });
}
