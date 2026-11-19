import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { dashboardLayouts } from "../db/schema.js";
import { requireUser } from "../lib/guards.js";
import { GOAL_WIDGET, LAYOUT_PAGES, LAYOUT_VERSION, MAX_COLUMNS, PAGE_WIDGETS, type LayoutPage } from "../lib/widgets.js";
import { todayFor } from "../lib/days.js";
import { activeGoalIds, keepGoals } from "./goals.js";

// The person's widget layout for a page (§28, §40a): GET (null until saved) and PUT { version: 1, columns: string[][] }
// at /api/layouts/:page; /api/dashboard/layout is the Dashboard's under the name it had first. Goal widgets ("goal:<id>",
// §40c) may be on any page: only the person's active goals are kept (others are dropped on read and on save).
const pageParam = z.object({ page: z.enum(LAYOUT_PAGES, { error: "There's no such page" }) });

const MAX_GOAL_WIDGETS = 100;
const layoutBody = (page: LayoutPage) => {
  const known = new Set(PAGE_WIDGETS[page]);
  const where = page === "dashboard" ? "the dashboard" : "the page";
  return z.object({
    version: z.literal(LAYOUT_VERSION),
    columns: z
      .array(z.array(z.string().refine((id) => known.has(id) || GOAL_WIDGET.test(id), "That widget doesn't exist")).max(known.size + MAX_GOAL_WIDGETS), { error: "Columns must be lists of widgets" })
      .max(MAX_COLUMNS, `At most ${MAX_COLUMNS} columns`)
      .refine((cols) => new Set(cols.flat()).size === cols.flat().length, `A widget can only be on ${where} once`),
  });
};
const BODIES = Object.fromEntries(LAYOUT_PAGES.map((p) => [p, layoutBody(p)])) as Record<LayoutPage, ReturnType<typeof layoutBody>>;

export default async function layoutRoutes(app: FastifyInstance) {
  const { db } = app;

  const read = async (userId: number, page: LayoutPage) => {
    const [row] = await db
      .select()
      .from(dashboardLayouts)
      .where(and(eq(dashboardLayouts.userId, userId), eq(dashboardLayouts.page, page)));
    if (!row) return { layout: null };
    // Widgets the page no longer has, and goals no longer active, are dropped
    const known = new Set(PAGE_WIDGETS[page]);
    const active = await activeGoalIds(db, userId, await todayFor(app, userId));
    const columns = row.columns.slice(0, MAX_COLUMNS).map((c) => c.filter((id) => known.has(id) || GOAL_WIDGET.test(id)));
    return { layout: { version: LAYOUT_VERSION, columns: keepGoals(columns, active) } };
  };

  const write = async (req: FastifyRequest, page: LayoutPage) => {
    const userId = requireUser(req);
    const parsed = BODIES[page].parse(req.body ?? {});
    const layout = { ...parsed, columns: keepGoals(parsed.columns, await activeGoalIds(db, userId, await todayFor(app, userId))) };
    const now = app.now();
    await db
      .insert(dashboardLayouts)
      .values({ userId, page, columns: layout.columns, updatedAt: now })
      .onConflictDoUpdate({ target: [dashboardLayouts.userId, dashboardLayouts.page], set: { columns: layout.columns, updatedAt: now } });
    return { layout };
  };

  app.get("/api/layouts/:page", async (req) => {
    const userId = requireUser(req);
    return read(userId, pageParam.parse(req.params).page);
  });
  app.put("/api/layouts/:page", async (req) => {
    requireUser(req);
    return write(req, pageParam.parse(req.params).page);
  });

  app.get("/api/dashboard/layout", async (req) => read(requireUser(req), "dashboard"));
  app.put("/api/dashboard/layout", async (req) => write(req, "dashboard"));
}
