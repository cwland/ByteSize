CREATE TABLE "fatsecret_barcodes" (
	"barcode" text PRIMARY KEY NOT NULL,
	"food_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"query" text NOT NULL,
	"results" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "food_searches_source_query_idx" ON "food_searches" USING btree ("source","query");