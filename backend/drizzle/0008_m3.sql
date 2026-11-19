CREATE TABLE "badges" (
	"user_id" integer NOT NULL,
	"badge" text NOT NULL,
	"earned_on" date NOT NULL,
	"seen" boolean DEFAULT false NOT NULL,
	CONSTRAINT "badges_user_id_badge_pk" PRIMARY KEY("user_id","badge")
);
--> statement-breakpoint
CREATE TABLE "glp1_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"medication" text NOT NULL,
	"dose_mg" double precision NOT NULL,
	"injection_weekday" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "glp1_shots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"day" date NOT NULL,
	"medication" text NOT NULL,
	"dose_mg" double precision NOT NULL,
	"site" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "side_effects" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"day" date NOT NULL,
	"effects" jsonb NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "vacations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"from_day" date NOT NULL,
	"to_day" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weigh_ins" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"day" date NOT NULL,
	"weight_kg" double precision NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_body" ADD COLUMN "targets_weight_kg" double precision;--> statement-breakpoint
ALTER TABLE "badges" ADD CONSTRAINT "badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glp1_settings" ADD CONSTRAINT "glp1_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glp1_shots" ADD CONSTRAINT "glp1_shots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "side_effects" ADD CONSTRAINT "side_effects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacations" ADD CONSTRAINT "vacations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weigh_ins" ADD CONSTRAINT "weigh_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "glp1_shots_user_day_idx" ON "glp1_shots" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "side_effects_user_day_idx" ON "side_effects" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "vacations_user_from_idx" ON "vacations" USING btree ("user_id","from_day");--> statement-breakpoint
CREATE UNIQUE INDEX "weigh_ins_user_day_idx" ON "weigh_ins" USING btree ("user_id","day");--> statement-breakpoint
-- Hand-appended: every existing person starts with one weigh-in, today (their local day), at the weight they signed up with
INSERT INTO "weigh_ins" ("user_id", "day", "weight_kg") SELECT b."user_id", (now() AT TIME ZONE u."timezone")::date, b."weight_kg" FROM "user_body" b JOIN "users" u ON u."id" = b."user_id" ON CONFLICT DO NOTHING;
