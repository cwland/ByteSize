CREATE TABLE "recipe_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"position" integer NOT NULL,
	"food_kind" text NOT NULL,
	"food_id" integer NOT NULL,
	"serving_index" integer DEFAULT 0 NOT NULL,
	"unit" text NOT NULL,
	"quantity" double precision NOT NULL,
	"fraction" double precision DEFAULT 1 NOT NULL,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "log_entries" ADD COLUMN "group_ref" text;--> statement-breakpoint
ALTER TABLE "user_foods" ADD COLUMN "recipe_servings" double precision;--> statement-breakpoint
ALTER TABLE "user_foods" ADD COLUMN "serving_grams" double precision;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_user_foods_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."user_foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_items_recipe_idx" ON "recipe_items" USING btree ("recipe_id","position");--> statement-breakpoint
CREATE INDEX "recipe_items_food_idx" ON "recipe_items" USING btree ("food_kind","food_id");