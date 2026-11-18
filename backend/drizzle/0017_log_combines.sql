CREATE TABLE "log_combines" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entry_id" integer,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"added" jsonb NOT NULL,
	"added_servings" jsonb NOT NULL,
	"split_day" date NOT NULL,
	"split_meal" text NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "log_combines" ADD CONSTRAINT "log_combines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_combines" ADD CONSTRAINT "log_combines_entry_id_log_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."log_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "log_combines_user_created_idx" ON "log_combines" USING btree ("user_id","created_at");