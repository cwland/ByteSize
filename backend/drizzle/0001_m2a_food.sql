CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "food_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"barcode" text,
	"name" text NOT NULL,
	"brand" text,
	"category" text,
	"servings" jsonb NOT NULL,
	"nutrients" jsonb NOT NULL,
	"image_url" text,
	"raw" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"day" date NOT NULL,
	"meal" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"icon" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"serving_index" integer DEFAULT 0 NOT NULL,
	"unit" text NOT NULL,
	"quantity" real NOT NULL,
	"fraction" real DEFAULT 1 NOT NULL,
	"per_serving" jsonb NOT NULL,
	"servings" jsonb NOT NULL,
	"nutrients" jsonb NOT NULL,
	"ai_estimated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"effective_from" date NOT NULL,
	"plan" text,
	"calories_min" integer NOT NULL,
	"calories_max" integer NOT NULL,
	"protein_min" real NOT NULL,
	"protein_max" real NOT NULL,
	"fiber_min" real NOT NULL,
	"fiber_max" real NOT NULL,
	"water_min" real NOT NULL,
	"water_max" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_body" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"sex" text NOT NULL,
	"birth_year" integer NOT NULL,
	"height_cm" real NOT NULL,
	"weight_kg" real NOT NULL,
	"goal_weight_kg" real NOT NULL,
	"activity" text NOT NULL,
	"glp1" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_foods" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"barcode" text,
	"base_cache_id" integer,
	"category" text,
	"servings" jsonb NOT NULL,
	"nutrients" jsonb NOT NULL,
	"ai_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"meal_windows" jsonb DEFAULT '{"breakfast":"10:30","lunch":"14:30","snacks":"17:00","dinner":"21:00"}'::jsonb NOT NULL,
	"water_buttons_ml" jsonb DEFAULT '[237,473]'::jsonb NOT NULL,
	"culury_url" text,
	"culury_key_enc" text
);
--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_body" ADD CONSTRAINT "user_body_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_foods" ADD CONSTRAINT "user_foods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_foods" ADD CONSTRAINT "user_foods_base_cache_id_food_cache_id_fk" FOREIGN KEY ("base_cache_id") REFERENCES "public"."food_cache"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "food_cache_source_idx" ON "food_cache" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "food_cache_barcode_idx" ON "food_cache" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "log_entries_user_day_idx" ON "log_entries" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "targets_user_from_idx" ON "targets" USING btree ("user_id","effective_from");--> statement-breakpoint
CREATE INDEX "user_foods_user_idx" ON "user_foods" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_foods_user_barcode_idx" ON "user_foods" USING btree ("user_id","barcode") WHERE "user_foods"."barcode" is not null and "user_foods"."archived" = false;--> statement-breakpoint
CREATE INDEX "user_foods_name_trgm_idx" ON "user_foods" USING gin (lower("name" || ' ' || coalesce("brand", '')) gin_trgm_ops);