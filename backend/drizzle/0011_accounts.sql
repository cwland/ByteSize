CREATE TABLE "oauth_flows" (
	"state" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"user_id" integer,
	"verifier" text NOT NULL,
	"nonce" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"app_origin" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_tickets" (
	"ticket_hash" text PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"code_hash" text NOT NULL,
	"wrong_tries" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_codes_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "oauth_issuer" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "oauth_subject" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "oauth_email" text;--> statement-breakpoint
ALTER TABLE "oauth_flows" ADD CONSTRAINT "oauth_flows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tickets" ADD CONSTRAINT "oauth_tickets_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_oauth_identity_idx" ON "users" USING btree ("oauth_issuer","oauth_subject");