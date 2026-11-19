ALTER TABLE "badges" ADD COLUMN "count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "week_start" integer;--> statement-breakpoint
-- Goals made before this keep the person's week start as it is now; Goal met counts the met goals still there
UPDATE "goals" g SET "week_start" = COALESCE((SELECT s."week_start" FROM "user_settings" s WHERE s."user_id" = g."user_id"), 0);--> statement-breakpoint
UPDATE "badges" b SET "count" = (SELECT count(*) FROM "goals" g WHERE g."user_id" = b."user_id" AND g."result"->>'state' = 'completed') WHERE b."badge" = 'goal_met';
