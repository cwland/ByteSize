CREATE TABLE "log_trash" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entry_id" integer NOT NULL,
	"row" jsonb NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "log_trash" ADD CONSTRAINT "log_trash_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "log_trash_user_entry_idx" ON "log_trash" USING btree ("user_id","entry_id");