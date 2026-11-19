CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_foods" ADD COLUMN "image_path" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploads_user_idx" ON "uploads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uploads_unlinked_idx" ON "uploads" USING btree ("created_at") WHERE "uploads"."linked_at" is null;