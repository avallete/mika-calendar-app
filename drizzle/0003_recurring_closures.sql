ALTER TABLE "closure_periods"
  ADD COLUMN IF NOT EXISTS "repeats_annually" boolean DEFAULT false NOT NULL;

--> statement-breakpoint

UPDATE "closure_periods"
SET "repeats_annually" = false
WHERE "repeats_annually" IS NULL;
