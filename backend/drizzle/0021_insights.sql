CREATE TABLE "insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"question" text,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "insights_weekly" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "insights_recap_tried_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "insights_protein_tried_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "insights_widget_offered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insights_user_kind_created_idx" ON "insights" USING btree ("user_id","kind","created_at");