ALTER TABLE "log_entries" ALTER COLUMN "quantity" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "log_entries" ALTER COLUMN "fraction" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "log_entries" ALTER COLUMN "fraction" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "targets" ALTER COLUMN "protein_min" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "targets" ALTER COLUMN "protein_max" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "targets" ALTER COLUMN "fiber_min" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "targets" ALTER COLUMN "fiber_max" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "targets" ALTER COLUMN "water_min" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "targets" ALTER COLUMN "water_max" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "user_body" ALTER COLUMN "height_cm" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "user_body" ALTER COLUMN "weight_kg" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "user_body" ALTER COLUMN "goal_weight_kg" SET DATA TYPE double precision;