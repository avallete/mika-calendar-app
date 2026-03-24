import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NodePgTransaction } from "drizzle-orm/node-postgres/session";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PgliteTransaction } from "drizzle-orm/pglite/session";
import type { TablesRelationalConfig } from "drizzle-orm/relations";

import {
  closurePeriods,
  holidaySources,
  plannerActionLog,
  projectDependencies,
  projects,
  teams,
} from "@/db/schema";
import { initialPlannerState } from "@/lib/planner/sample-data";
import type { PlannerState } from "@/lib/planner/types";

export type DbExecutor =
  | NodePgDatabase<Record<string, unknown>>
  | NodePgTransaction<Record<string, unknown>, TablesRelationalConfig>
  | PgliteDatabase<Record<string, unknown>>
  | PgliteTransaction<Record<string, unknown>, TablesRelationalConfig>;

export type PersistentPlannerState = Omit<PlannerState, "closures" | "history">;

export function plannerStateToPersistentState(snapshot: PlannerState): PersistentPlannerState {
  return {
    teams: snapshot.teams,
    holidaySources: snapshot.holidaySources,
    projects: snapshot.projects,
    dependencies: snapshot.dependencies,
    customClosures: snapshot.customClosures,
  };
}

export function getBasePersistentState() {
  return plannerStateToPersistentState(initialPlannerState);
}

export async function ensureClosureMarkerSchema(executor: DbExecutor) {
  await executor.execute(sql.raw(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'closure_impact') THEN
    CREATE TYPE "public"."closure_impact" AS ENUM ('blocking', 'advisory');
  END IF;
END $$;
`));
  await executor.execute(
    sql.raw(`ALTER TYPE "public"."closure_type" ADD VALUE IF NOT EXISTS 'weather';`)
  );
  await executor.execute(
    sql.raw(`ALTER TYPE "public"."closure_type" ADD VALUE IF NOT EXISTS 'annotation';`)
  );
  await executor.execute(
    sql.raw(`
ALTER TABLE "closure_periods"
  ADD COLUMN IF NOT EXISTS "impact" "closure_impact" DEFAULT 'blocking' NOT NULL;
`)
  );
  await executor.execute(
    sql.raw(`ALTER TABLE "closure_periods" ADD COLUMN IF NOT EXISTS "details" text;`)
  );
  await executor.execute(
    sql.raw(`
ALTER TABLE "closure_periods"
  ADD COLUMN IF NOT EXISTS "repeats_annually" boolean DEFAULT false NOT NULL;
`)
  );
  await executor.execute(
    sql.raw(`UPDATE "closure_periods" SET "impact" = 'blocking' WHERE "impact" IS NULL;`)
  );
  await executor.execute(
    sql.raw(`
UPDATE "closure_periods"
SET "repeats_annually" = false
WHERE "repeats_annually" IS NULL;
`)
  );
}

export async function replacePersistentState(
  executor: DbExecutor,
  state: PersistentPlannerState
) {
  await executor.delete(plannerActionLog);
  await executor.delete(projectDependencies);
  await executor.delete(projects);
  await executor.delete(closurePeriods);
  await executor.delete(holidaySources);
  await executor.delete(teams);

  if (state.teams.length) {
    await executor.insert(teams).values(
      state.teams.map((team) => ({
        id: team.id,
        slug: team.slug,
        nameFr: team.nameFr,
        displayOrder: team.displayOrder,
        accentColor: team.accentColor,
        softColor: team.softColor,
        isActive: team.isActive,
      }))
    );
  }

  if (state.holidaySources.length) {
    await executor.insert(holidaySources).values(
      state.holidaySources.map((source) => ({
        id: source.id,
        code: source.code,
        labelFr: source.labelFr,
        enabled: source.enabled,
      }))
    );
  }

  if (state.projects.length) {
    await executor.insert(projects).values(
      state.projects.map((project) => ({
        id: project.id,
        title: project.title,
        status: project.status,
        plannedTeamId: project.plannedTeam,
        estimatedDurationHalfDays: project.estimatedDurationHalfDays,
        scheduledTeamId: project.scheduledTeam ?? null,
        scheduledStartSlot: project.scheduledStartSlot ?? null,
        scheduledDurationHalfDays: project.scheduledDurationHalfDays ?? null,
        sequenceOrder: project.sequenceOrder ?? null,
        targetDateHint: project.targetDateHint
          ? new Date(`${project.targetDateHint}T00:00:00.000Z`)
          : null,
        notes: project.notes ?? null,
      }))
    );
  }

  if (state.dependencies.length) {
    await executor.insert(projectDependencies).values(
      state.dependencies.map((dependency) => ({
        id: dependency.id,
        predecessorProjectId: dependency.predecessorProjectId,
        successorProjectId: dependency.successorProjectId,
        lagHalfDays: dependency.lagHalfDays,
      }))
    );
  }

  if (state.customClosures.length) {
    await executor.insert(closurePeriods).values(
      state.customClosures.map((closure) => ({
        id: closure.id,
        title: closure.title,
        type: closure.type,
        impact: closure.impact,
        startDate: new Date(`${closure.startDate}T00:00:00.000Z`),
        endDate: new Date(`${closure.endDate}T00:00:00.000Z`),
        details: closure.details ?? null,
        repeatsAnnually: closure.repeatsAnnually,
      }))
    );
  }
}

export async function seedPlannerDatabase(
  executor: DbExecutor,
  snapshot: PlannerState = initialPlannerState
) {
  await ensureClosureMarkerSchema(executor);
  await replacePersistentState(executor, plannerStateToPersistentState(snapshot));
}
