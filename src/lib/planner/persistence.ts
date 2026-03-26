import { eq, inArray, sql } from "drizzle-orm";
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
import type {
  PlannerSnapshotSummary,
  PlannerTraceLike,
} from "@/lib/planner/planner-trace";
import {
  addPlannerTraceContextFields,
  measurePlannerTraceStepAsync,
} from "@/lib/planner/planner-trace";
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

function toProjectRowInput(project: PersistentPlannerState["projects"][number]) {
  return {
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
  };
}

function toProjectRowUpdate(project: PersistentPlannerState["projects"][number]) {
  const { id: removedProjectId, ...projectRowInput } = toProjectRowInput(project);
  void removedProjectId;
  return projectRowInput;
}

function toDependencyRowInput(
  dependency: PersistentPlannerState["dependencies"][number]
) {
  return {
    id: dependency.id,
    predecessorProjectId: dependency.predecessorProjectId,
    successorProjectId: dependency.successorProjectId,
    lagHalfDays: dependency.lagHalfDays,
  };
}

function areTeamsEqual(
  left: PersistentPlannerState["teams"],
  right: PersistentPlannerState["teams"]
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areHolidaySourcesEqual(
  left: PersistentPlannerState["holidaySources"],
  right: PersistentPlannerState["holidaySources"]
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areCustomClosuresEqual(
  left: PersistentPlannerState["customClosures"],
  right: PersistentPlannerState["customClosures"]
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areProjectsEqual(
  left: PersistentPlannerState["projects"][number],
  right: PersistentPlannerState["projects"][number]
) {
  return (
    left.title === right.title &&
    left.status === right.status &&
    left.plannedTeam === right.plannedTeam &&
    left.estimatedDurationHalfDays === right.estimatedDurationHalfDays &&
    (left.scheduledTeam ?? null) === (right.scheduledTeam ?? null) &&
    (left.scheduledStartSlot ?? null) === (right.scheduledStartSlot ?? null) &&
    (left.scheduledDurationHalfDays ?? null) ===
      (right.scheduledDurationHalfDays ?? null) &&
    (left.sequenceOrder ?? null) === (right.sequenceOrder ?? null) &&
    (left.targetDateHint ?? null) === (right.targetDateHint ?? null) &&
    (left.notes ?? null) === (right.notes ?? null)
  );
}

function areDependenciesEqual(
  left: PersistentPlannerState["dependencies"][number],
  right: PersistentPlannerState["dependencies"][number]
) {
  return (
    left.predecessorProjectId === right.predecessorProjectId &&
    left.successorProjectId === right.successorProjectId &&
    left.lagHalfDays === right.lagHalfDays
  );
}

export function canWritePersistentStateDelta(
  before: PersistentPlannerState,
  after: PersistentPlannerState
) {
  return (
    areTeamsEqual(before.teams, after.teams) &&
    areHolidaySourcesEqual(before.holidaySources, after.holidaySources) &&
    areCustomClosuresEqual(before.customClosures, after.customClosures)
  );
}

export async function writePersistentStateDelta(
  executor: DbExecutor,
  before: PersistentPlannerState,
  after: PersistentPlannerState,
  traceContext?: PlannerTraceLike
) {
  const beforeProjectsById = new Map(before.projects.map((project) => [project.id, project] as const));
  const afterProjectsById = new Map(after.projects.map((project) => [project.id, project] as const));
  const beforeDependenciesById = new Map(
    before.dependencies.map((dependency) => [dependency.id, dependency] as const)
  );
  const afterDependenciesById = new Map(
    after.dependencies.map((dependency) => [dependency.id, dependency] as const)
  );

  const deletedDependencyIds = before.dependencies
    .filter((dependency) => !afterDependenciesById.has(dependency.id))
    .map((dependency) => dependency.id);
  const insertedDependencies = after.dependencies.filter(
    (dependency) => !beforeDependenciesById.has(dependency.id)
  );
  const deletedProjectIds = before.projects
    .filter((project) => !afterProjectsById.has(project.id))
    .map((project) => project.id);
  const insertedProjects = after.projects.filter((project) => !beforeProjectsById.has(project.id));
  const updatedProjects = after.projects.filter((project) => {
    const previous = beforeProjectsById.get(project.id);
    return previous ? !areProjectsEqual(previous, project) : false;
  });
  const updatedDependencies = after.dependencies.filter((dependency) => {
    const previous = beforeDependenciesById.get(dependency.id);
    return previous ? !areDependenciesEqual(previous, dependency) : false;
  });

  const deletedOrUpdatedDependencyIds = [
    ...deletedDependencyIds,
    ...updatedDependencies.map((dependency) => dependency.id),
  ];

  if (deletedOrUpdatedDependencyIds.length) {
    await measurePlannerTraceStepAsync(
      traceContext ?? null,
      "planner.persistence.delete.dependencies",
      () =>
        executor
          .delete(projectDependencies)
          .where(inArray(projectDependencies.id, deletedOrUpdatedDependencyIds)),
      addPlannerTraceContextFields(traceContext, {
        rowCount: deletedOrUpdatedDependencyIds.length,
      })
    );
  }

  if (deletedProjectIds.length) {
    await measurePlannerTraceStepAsync(
      traceContext ?? null,
      "planner.persistence.delete.projects",
      () =>
        executor.delete(projects).where(inArray(projects.id, deletedProjectIds)),
      addPlannerTraceContextFields(traceContext, {
        rowCount: deletedProjectIds.length,
      })
    );
  }

  if (insertedProjects.length) {
    await measurePlannerTraceStepAsync(
      traceContext ?? null,
      "planner.persistence.insert.projects",
      () => executor.insert(projects).values(insertedProjects.map(toProjectRowInput)),
      addPlannerTraceContextFields(traceContext, {
        rowCount: insertedProjects.length,
      })
    );
  }

  if (updatedProjects.length) {
    await measurePlannerTraceStepAsync(
      traceContext ?? null,
      "planner.persistence.update.projects",
      async () => {
        for (const project of updatedProjects) {
          await executor
            .update(projects)
            .set({
              ...toProjectRowUpdate(project),
              updatedAt: new Date(),
            })
            .where(eq(projects.id, project.id));
        }
      },
      addPlannerTraceContextFields(traceContext, {
        rowCount: updatedProjects.length,
      })
    );
  }

  if (insertedDependencies.length || updatedDependencies.length) {
    const nextDependencies = [...insertedDependencies, ...updatedDependencies];
    await measurePlannerTraceStepAsync(
      traceContext ?? null,
      "planner.persistence.insert.dependencies",
      () =>
        executor
          .insert(projectDependencies)
          .values(nextDependencies.map(toDependencyRowInput)),
      addPlannerTraceContextFields(traceContext, {
        rowCount: nextDependencies.length,
      })
    );
  }
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
  state: PersistentPlannerState,
  traceContext?: PlannerTraceLike,
  summaries?: {
    before?: PlannerSnapshotSummary;
    after?: PlannerSnapshotSummary;
  }
) {
  await measurePlannerTraceStepAsync(
    traceContext ?? null,
    "planner.persistence.delete.actionLog",
    () => executor.delete(plannerActionLog),
    addPlannerTraceContextFields(traceContext, {
      rowCount: null,
    })
  );
  await measurePlannerTraceStepAsync(
    traceContext ?? null,
    "planner.persistence.delete.dependencies",
    () => executor.delete(projectDependencies),
    addPlannerTraceContextFields(traceContext, {
      rowCount: summaries?.before?.dependencyCount ?? null,
    })
  );
  await measurePlannerTraceStepAsync(
    traceContext ?? null,
    "planner.persistence.delete.projects",
    () => executor.delete(projects),
    addPlannerTraceContextFields(traceContext, {
      rowCount: summaries?.before?.projectCount ?? null,
    })
  );
  await measurePlannerTraceStepAsync(
    traceContext ?? null,
    "planner.persistence.delete.closures",
    () => executor.delete(closurePeriods),
    addPlannerTraceContextFields(traceContext, {
      rowCount: summaries?.before?.customClosureCount ?? null,
    })
  );
  await measurePlannerTraceStepAsync(
    traceContext ?? null,
    "planner.persistence.delete.holidaySources",
    () => executor.delete(holidaySources),
    addPlannerTraceContextFields(traceContext, {
      rowCount: summaries?.before?.holidaySourceCount ?? null,
    })
  );
  await measurePlannerTraceStepAsync(
    traceContext ?? null,
    "planner.persistence.delete.teams",
    () => executor.delete(teams),
    addPlannerTraceContextFields(traceContext, {
      rowCount: summaries?.before?.teamCount ?? null,
    })
  );

  if (state.teams.length) {
    await measurePlannerTraceStepAsync(
      traceContext ?? null,
      "planner.persistence.insert.teams",
      () =>
        executor.insert(teams).values(
          state.teams.map((team) => ({
            id: team.id,
            slug: team.slug,
            nameFr: team.nameFr,
            displayOrder: team.displayOrder,
            accentColor: team.accentColor,
            softColor: team.softColor,
            isActive: team.isActive,
          }))
        ),
      addPlannerTraceContextFields(traceContext, {
        rowCount: summaries?.after?.teamCount ?? state.teams.length,
      })
    );
  }

  if (state.holidaySources.length) {
    await measurePlannerTraceStepAsync(
      traceContext ?? null,
      "planner.persistence.insert.holidaySources",
      () =>
        executor.insert(holidaySources).values(
          state.holidaySources.map((source) => ({
            id: source.id,
            code: source.code,
            labelFr: source.labelFr,
            enabled: source.enabled,
          }))
        ),
      addPlannerTraceContextFields(traceContext, {
        rowCount: summaries?.after?.holidaySourceCount ?? state.holidaySources.length,
      })
    );
  }

  if (state.projects.length) {
    await measurePlannerTraceStepAsync(
      traceContext ?? null,
      "planner.persistence.insert.projects",
      () => executor.insert(projects).values(state.projects.map(toProjectRowInput)),
      addPlannerTraceContextFields(traceContext, {
        rowCount: summaries?.after?.projectCount ?? state.projects.length,
      })
    );
  }

  if (state.dependencies.length) {
    await measurePlannerTraceStepAsync(
      traceContext ?? null,
      "planner.persistence.insert.dependencies",
      () =>
        executor
          .insert(projectDependencies)
          .values(state.dependencies.map(toDependencyRowInput)),
      addPlannerTraceContextFields(traceContext, {
        rowCount: summaries?.after?.dependencyCount ?? state.dependencies.length,
      })
    );
  }

  if (state.customClosures.length) {
    await measurePlannerTraceStepAsync(
      traceContext ?? null,
      "planner.persistence.insert.closures",
      () =>
        executor.insert(closurePeriods).values(
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
        ),
      addPlannerTraceContextFields(traceContext, {
        rowCount:
          summaries?.after?.customClosureCount ?? state.customClosures.length,
      })
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
