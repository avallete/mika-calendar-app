DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'closure_impact') THEN
    CREATE TYPE "public"."closure_impact" AS ENUM ('blocking', 'advisory');
  END IF;
END $$;
--> statement-breakpoint
ALTER TYPE "public"."closure_type" ADD VALUE IF NOT EXISTS 'weather';
--> statement-breakpoint
ALTER TYPE "public"."closure_type" ADD VALUE IF NOT EXISTS 'annotation';
--> statement-breakpoint
ALTER TABLE "closure_periods"
  ADD COLUMN IF NOT EXISTS "impact" "closure_impact" DEFAULT 'blocking' NOT NULL;
--> statement-breakpoint
ALTER TABLE "closure_periods"
  ADD COLUMN IF NOT EXISTS "details" text;
--> statement-breakpoint
UPDATE "closure_periods"
SET "impact" = 'blocking'
WHERE "impact" IS NULL;
