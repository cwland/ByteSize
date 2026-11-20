ALTER TABLE "glp1_settings" ADD COLUMN "dose_unit" text DEFAULT 'mg' NOT NULL;--> statement-breakpoint
ALTER TABLE "glp1_shots" ADD COLUMN "dose_unit" text DEFAULT 'mg' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "seen_version" text;