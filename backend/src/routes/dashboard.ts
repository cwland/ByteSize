import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { dashboardLayouts } from "../db/schema.js";
import { requireUser } from "../lib/guards.js";
import { LAYOUT_VERSION, MAX_COLUMNS, WIDGET_IDS } from "../lib/widgets.js";

// The person's Dashboard layout: GET (null until saved) and PUT { version: 1, columns: string[][] }.
const known = new Set<string>(WIDGET_IDS);
const layoutBody = z.object({
  version: z.literal(LAYOUT_VERSION),
  columns: z
    .array(z.array(z.string().refine((id) => known.has(id), "That widget doesn't exist")).max(WIDGET_IDS.length), { error: "Columns must be lists of widgets" })
    .max(MAX_COLUMNS, `At most ${MAX_COLUMNS} columns`)
    .refine((cols) => new Set(cols.flat()).size === cols.flat().length, "A widget can only be on the dashboard once"),
});

export default async function dashboardRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get("/api/dashboard/layout", async (req) => {
    const userId = requireUser(req);
    const [row] = await db.select().from(dashboardLayouts).where(eq(dashboardLayouts.userId, userId));
    if (!row) return { layout: null };
    // Widgets ByteSize no longer has are dropped
    return { layout: { version: LAYOUT_VERSION, columns: row.columns.slice(0, MAX_COLUMNS).map((c) => c.filter((id) => known.has(id))) } };
  });

  app.put("/api/dashboard/layout", async (req) => {
    const userId = requireUser(req);
    const layout = layoutBody.parse(req.body ?? {});
    const now = app.now();
    await db
      .insert(dashboardLayouts)
      .values({ userId, columns: layout.columns, updatedAt: now })
      .onConflictDoUpdate({ target: dashboardLayouts.userId, set: { columns: layout.columns, updatedAt: now } });
    return { layout };
  });
}
