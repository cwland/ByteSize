ALTER TABLE "oauth_flows" ADD COLUMN "client" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_flows" ADD COLUMN "app_key_hash" text;--> statement-breakpoint
ALTER TABLE "oauth_tickets" ADD COLUMN "app_key_hash" text;