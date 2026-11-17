CREATE TABLE "restaurant_favourites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"cache_id" integer NOT NULL,
	"chain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurant_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"query" text NOT NULL,
	"results" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restaurant_favourites" ADD CONSTRAINT "restaurant_favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_favourites" ADD CONSTRAINT "restaurant_favourites_cache_id_food_cache_id_fk" FOREIGN KEY ("cache_id") REFERENCES "public"."food_cache"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_favourites_user_cache_idx" ON "restaurant_favourites" USING btree ("user_id","cache_id");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_searches_source_query_idx" ON "restaurant_searches" USING btree ("source","query");