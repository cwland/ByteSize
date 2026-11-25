CREATE TABLE "restaurant_brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"brand_key" text NOT NULL,
	"brand" text NOT NULL,
	"is_restaurant" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restaurant_brands" ADD CONSTRAINT "restaurant_brands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_brands_user_key_idx" ON "restaurant_brands" USING btree ("user_id","brand_key");