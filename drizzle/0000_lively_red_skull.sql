CREATE TYPE "public"."closure_type" AS ENUM('holiday', 'company_closure', 'custom_time_off');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."team" AS ENUM('team-a', 'team-b');--> statement-breakpoint
CREATE TABLE "closure_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(160) NOT NULL,
	"type" "closure_type" NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closure_periods_valid_range" CHECK ("closure_periods"."end_date" >= "closure_periods"."start_date")
);
--> statement-breakpoint
CREATE TABLE "project_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"predecessor_project_id" uuid NOT NULL,
	"successor_project_id" uuid NOT NULL,
	"lag_half_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_dependencies_no_self_ref" CHECK ("project_dependencies"."predecessor_project_id" <> "project_dependencies"."successor_project_id"),
	CONSTRAINT "project_dependencies_non_negative_lag" CHECK ("project_dependencies"."lag_half_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(180) NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"planned_team" "team" NOT NULL,
	"estimated_duration_half_days" integer DEFAULT 2 NOT NULL,
	"scheduled_team" "team",
	"scheduled_start_slot" varchar(20),
	"scheduled_duration_half_days" integer,
	"sequence_order" integer,
	"target_date_hint" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_estimated_duration_positive" CHECK ("projects"."estimated_duration_half_days" > 0),
	CONSTRAINT "projects_scheduled_duration_positive" CHECK ("projects"."scheduled_duration_half_days" IS NULL OR "projects"."scheduled_duration_half_days" > 0),
	CONSTRAINT "projects_scheduled_fields_match_status" CHECK ((
        "projects"."status" = 'draft'
        AND "projects"."scheduled_team" IS NULL
        AND "projects"."scheduled_start_slot" IS NULL
        AND "projects"."scheduled_duration_half_days" IS NULL
        AND "projects"."sequence_order" IS NULL
      ) OR (
        "projects"."status" = 'scheduled'
        AND "projects"."scheduled_team" IS NOT NULL
        AND "projects"."scheduled_start_slot" IS NOT NULL
        AND "projects"."scheduled_duration_half_days" IS NOT NULL
        AND "projects"."sequence_order" IS NOT NULL
      ))
);
--> statement-breakpoint
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_predecessor_project_id_projects_id_fk" FOREIGN KEY ("predecessor_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_successor_project_id_projects_id_fk" FOREIGN KEY ("successor_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_dependencies_unique_edge" ON "project_dependencies" USING btree ("predecessor_project_id","successor_project_id");