CREATE TABLE "activity_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"day" date NOT NULL,
	"source" text NOT NULL,
	"steps" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_calorie_modes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"effective_from" date NOT NULL,
	"mode" text NOT NULL,
	"count_pct" integer DEFAULT 50 NOT NULL,
	"weekly_cap" integer DEFAULT 1000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"day" date NOT NULL,
	"type" text NOT NULL,
	"minutes" integer NOT NULL,
	"calories" integer,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "log_entries" ADD COLUMN "treat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_steps" ADD CONSTRAINT "activity_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_calorie_modes" ADD CONSTRAINT "workout_calorie_modes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_steps_user_day_source_idx" ON "activity_steps" USING btree ("user_id","day","source");--> statement-breakpoint
CREATE INDEX "workout_calorie_modes_user_from_idx" ON "workout_calorie_modes" USING btree ("user_id","effective_from");--> statement-breakpoint
CREATE INDEX "workouts_user_day_idx" ON "workouts" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "workouts_user_external_idx" ON "workouts" USING btree ("user_id","external_id") WHERE "workouts"."external_id" is not null;