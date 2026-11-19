ALTER TABLE "insights" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "email_tries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "insights_email" boolean DEFAULT false NOT NULL;