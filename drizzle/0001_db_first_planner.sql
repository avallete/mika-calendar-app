CREATE TABLE IF NOT EXISTS "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name_fr" varchar(160) NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"accent_color" varchar(40) NOT NULL,
	"soft_color" varchar(40) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_slug_unique" ON "teams" USING btree ("slug");
--> statement-breakpoint
INSERT INTO "teams" (
	"id",
	"slug",
	"name_fr",
	"display_order",
	"accent_color",
	"soft_color",
	"is_active"
) VALUES
	('11111111-1111-4111-8111-111111111111', 'equipe-a', 'Equipe A', 0, 'oklch(0.58 0.11 205)', 'oklch(0.95 0.03 205)', true),
	('22222222-2222-4222-8222-222222222222', 'equipe-b', 'Equipe B', 1, 'oklch(0.68 0.13 55)', 'oklch(0.96 0.04 55)', true)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "planned_team_id" uuid;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "scheduled_team_id" uuid;
--> statement-breakpoint
UPDATE "projects"
SET "planned_team_id" = CASE "planned_team"
	WHEN 'team-a' THEN '11111111-1111-4111-8111-111111111111'::uuid
	WHEN 'team-b' THEN '22222222-2222-4222-8222-222222222222'::uuid
	ELSE "planned_team_id"
END
WHERE "planned_team_id" IS NULL;
--> statement-breakpoint
UPDATE "projects"
SET "scheduled_team_id" = CASE "scheduled_team"
	WHEN 'team-a' THEN '11111111-1111-4111-8111-111111111111'::uuid
	WHEN 'team-b' THEN '22222222-2222-4222-8222-222222222222'::uuid
	ELSE "scheduled_team_id"
END
WHERE "scheduled_team_id" IS NULL AND "scheduled_team" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_scheduled_fields_match_status";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "planned_team";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "scheduled_team";
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "planned_team_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_planned_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_scheduled_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "projects"
	ADD CONSTRAINT "projects_planned_team_id_teams_id_fk"
	FOREIGN KEY ("planned_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "projects"
	ADD CONSTRAINT "projects_scheduled_team_id_teams_id_fk"
	FOREIGN KEY ("scheduled_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "projects"
	ADD CONSTRAINT "projects_scheduled_fields_match_status"
	CHECK ((
		"projects"."status" = 'draft'
		AND "projects"."scheduled_team_id" IS NULL
		AND "projects"."scheduled_start_slot" IS NULL
		AND "projects"."scheduled_duration_half_days" IS NULL
		AND "projects"."sequence_order" IS NULL
	) OR (
		"projects"."status" = 'scheduled'
		AND "projects"."scheduled_team_id" IS NOT NULL
		AND "projects"."scheduled_start_slot" IS NOT NULL
		AND "projects"."scheduled_duration_half_days" IS NOT NULL
		AND "projects"."sequence_order" IS NOT NULL
	));
--> statement-breakpoint
ALTER TABLE "closure_periods" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "holiday_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"label_fr" varchar(160) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "holiday_sources_code_unique" ON "holiday_sources" USING btree ("code");
--> statement-breakpoint
INSERT INTO "holiday_sources" ("id", "code", "label_fr", "enabled")
VALUES ('33333333-3333-4333-8333-333333333333', 'FR', 'Jours feries France', true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "planner_action_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(120) NOT NULL,
	"action_type" varchar(80) NOT NULL,
	"payload" jsonb NOT NULL,
	"before_snapshot" jsonb NOT NULL,
	"after_snapshot" jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team') THEN
		DROP TYPE "public"."team";
	END IF;
END $$;
