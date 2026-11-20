CREATE TABLE "favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"cache_id" integer,
	"user_food_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_cache_id_food_cache_id_fk" FOREIGN KEY ("cache_id") REFERENCES "public"."food_cache"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_food_id_user_foods_id_fk" FOREIGN KEY ("user_food_id") REFERENCES "public"."user_foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_user_cache_idx" ON "favorites" USING btree ("user_id","cache_id");--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_user_food_idx" ON "favorites" USING btree ("user_id","user_food_id");