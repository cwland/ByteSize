import { integer, pgTable, serial } from "drizzle-orm/pg-core";

// Placeholder table so the first migration isn't empty; real tables arrive in Task 2.
export const schemaInfo = pgTable("schema_info", {
  id: serial("id").primaryKey(),
  version: integer("version").notNull().default(1),
});
