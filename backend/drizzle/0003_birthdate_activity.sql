-- Hand-edited after drizzle-kit generate: add birth_date as nullable, backfill it from birth_year, then make it NOT NULL
-- and drop birth_year. Old activity levels map to the new ones (very → physical; anything unexpected → sitting, the
-- lowest), and every existing body is flagged so the app asks once to check details before showing plans.
ALTER TABLE "user_body" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "user_body" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "user_body" SET
	"birth_date" = make_date("birth_year", 1, 1),
	"activity" = CASE "activity"
		WHEN 'sedentary' THEN 'sitting'
		WHEN 'light' THEN 'some'
		WHEN 'moderate' THEN 'most'
		WHEN 'active' THEN 'physical'
		WHEN 'very' THEN 'physical'
		ELSE 'sitting'
	END,
	"needs_review" = true;--> statement-breakpoint
ALTER TABLE "user_body" ALTER COLUMN "birth_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_body" DROP COLUMN "birth_year";
