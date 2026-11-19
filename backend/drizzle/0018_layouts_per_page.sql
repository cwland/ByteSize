-- §40a: one layout per person per page (dashboard, goals). Existing rows are the Dashboard's.
ALTER TABLE "dashboard_layouts" ADD COLUMN "page" text DEFAULT 'dashboard' NOT NULL;--> statement-breakpoint
ALTER TABLE "dashboard_layouts" DROP CONSTRAINT "dashboard_layouts_pkey";--> statement-breakpoint
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_user_id_page_pk" PRIMARY KEY("user_id","page");
