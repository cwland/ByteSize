CREATE TABLE "barcode_picks" (
	"user_id" integer NOT NULL,
	"barcode" text NOT NULL,
	"cache_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barcode_picks_user_id_barcode_pk" PRIMARY KEY("user_id","barcode")
);
--> statement-breakpoint
ALTER TABLE "barcode_picks" ADD CONSTRAINT "barcode_picks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barcode_picks" ADD CONSTRAINT "barcode_picks_cache_id_food_cache_id_fk" FOREIGN KEY ("cache_id") REFERENCES "public"."food_cache"("id") ON DELETE cascade ON UPDATE no action;