import { asc, and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { format } from "date-fns";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NodePgTransaction } from "drizzle-orm/node-postgres/session";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PgliteTransaction } from "drizzle-orm/pglite/session";
import type { TablesRelationalConfig } from "drizzle-orm/relations";

import { ensureDbReady, getDb } from "@/db/client";
import {
  type ClosurePeriodRow,
  type HolidaySourceRow,
  type ProjectDependencyRow,
  type ProjectRow,
  type TeamRow,
  closurePeriods,
  holidaySources,
  plannerActionLog,
  projectDependencies,
  projects,
  teams,
} from "@/db/schema";
import {
  buildFrancePublicHolidays,
  getCoveredYears,
} from "@/lib/planner/france-holidays";
import { initialPlannerState } from "@/lib/planner/sample-data";
import {
  addClosureInState,
  createTeamInState,
  deleteProjectInState,
  deleteTeamInState,
  placeProjectInState,
  placeProjectsInState,
  resetPlannerDemoDataInState,
  removeClosureInState,
  toggleHolidaySourceInState,
  unscheduleProjectInState,
  updateTeamInState,
  upsertProjectInState,
} from "@/lib/planner/state-mutations";
import { rescheduleProjects } from "@/lib/planner/scheduler";
import type {
  ClosureFormState,
  ClosurePeriod,
  PlannerHistoryState,
  PlannerState,
  ProjectDeleteMode,
  ProjectEditorState,
  ProjectPlacement,
  ProjectPlacementOptions,
  ProjectPlacementRequest,
  TeamEditorState,
} from "@/lib/planner/types";
import { getSortedTeams } from "@/lib/planner/types";

type DbExecutor =
  | ReturnType<typeof getDb>
  | NodePgDatabase<Record<string, unknown>>
  | NodePgTransaction<Record<string, unknown>, TablesRelationalConfig>
  | PgliteDatabase<Record<string, unknown>>
  | PgliteTransaction<Record<string, unknown>, TablesRelationalConfig>;

type PersistentPlannerState = Omit<PlannerState, "closures" | "history"> & {
  customClosures: ClosurePeriod[];
};

function toDateString(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return format(new Date(value), "yyyy-MM-dd");
}

function actionLabel(actionType: string) {
  switch (actionType) {
    case "project.upsert":
      return "modifier un projet";
    case "project.place":
    case "project.placeMany":
      return "deplacer un projet";
    case "project.unschedule":
      return "repasser un projet en brouillon";
    case "project.delete":
      return "supprimer un projet";
    case "closure.add":
      return "ajouter un jour non ouvre";
    case "closure.delete":
      return "supprimer un jour non ouvre";
    case "team.create":
      return "ajouter une equipe";
    case "team.update":
      return "modifier une equipe";
    case "team.delete":
      return "supprimer une equipe";
    case "holiday-source.toggle":
      return "modifier les jours feries France";
    case "demo.reset":
      return "recharger les donnees de demo";
    default:
      return "modifier le planning";
  }
}

function buildHistoryState(params?: {
  undoActionType?: string;
  redoActionType?: string;
}): PlannerHistoryState {
  return {
    canUndo: Boolean(params?.undoActionType),
    canRedo: Boolean(params?.redoActionType),
    undoLabel: params?.undoActionType ? actionLabel(params.undoActionType) : undefined,
    redoLabel: params?.redoActionType ? actionLabel(params.redoActionType) : undefined,
  };
}

function getBasePersistentState() {
  return {
    teams: initialPlannerState.teams,
    holidaySources: initialPlannerState.holidaySources,
    projects: initialPlannerState.projects,
    dependencies: initialPlannerState.dependencies,
    customClosures: initialPlannerState.closures.filter(
      (closure) => closure.source === "custom"
    ),
  } satisfies PersistentPlannerState;
}

async function ensureClosureMarkerSchema(executor: DbExecutor) {
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
    sql.raw(`UPDATE "closure_periods" SET "impact" = 'blocking' WHERE "impact" IS NULL;`)
  );
}

async function readPersistentState(executor: DbExecutor): Promise<PersistentPlannerState> {
  const [teamRows, holidaySourceRows, projectRows, dependencyRows, closureRows] =
    await Promise.all([
      executor
        .select()
        .from(teams)
        .orderBy(asc(teams.displayOrder), asc(teams.nameFr)),
      executor.select().from(holidaySources).orderBy(asc(holidaySources.code)),
      executor.select().from(projects).orderBy(asc(projects.sequenceOrder), asc(projects.title)),
      executor.select().from(projectDependencies),
      executor.select().from(closurePeriods).orderBy(asc(closurePeriods.startDate)),
    ]);

  return {
    teams: teamRows.map((row: TeamRow) => ({
      id: row.id,
      slug: row.slug,
      nameFr: row.nameFr,
      displayOrder: row.displayOrder,
      accentColor: row.accentColor,
      softColor: row.softColor,
      isActive: row.isActive,
    })),
    holidaySources: holidaySourceRows.map((row: HolidaySourceRow) => ({
      id: row.id,
      code: row.code,
      labelFr: row.labelFr,
      enabled: row.enabled,
    })),
    projects: projectRows.map((row: ProjectRow) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      plannedTeam: row.plannedTeamId,
      estimatedDurationHalfDays: row.estimatedDurationHalfDays,
      scheduledTeam: row.scheduledTeamId ?? undefined,
      scheduledStartSlot:
        (row.scheduledStartSlot as PlannerState["projects"][number]["scheduledStartSlot"]) ??
        undefined,
      scheduledDurationHalfDays: row.scheduledDurationHalfDays ?? undefined,
      sequenceOrder: row.sequenceOrder ?? undefined,
      targetDateHint: toDateString(row.targetDateHint),
      notes: row.notes ?? undefined,
    })),
    dependencies: dependencyRows.map((row: ProjectDependencyRow) => ({
      id: row.id,
      predecessorProjectId: row.predecessorProjectId,
      successorProjectId: row.successorProjectId,
      lagHalfDays: row.lagHalfDays,
    })),
    customClosures: closureRows.map((row: ClosurePeriodRow) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      startDate: toDateString(row.startDate)!,
      endDate: toDateString(row.endDate)!,
      impact: row.impact,
      details: row.details ?? undefined,
      source: "custom",
      editable: true,
    })),
  };
}

async function replacePersistentState(
  executor: DbExecutor,
  state: PersistentPlannerState
) {
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
        targetDateHint: project.targetDateHint ? new Date(`${project.targetDateHint}T00:00:00.000Z`) : null,
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
      }))
    );
  }
}

function buildEffectiveClosures(state: PersistentPlannerState) {
  const relevantDates = [
    ...state.projects.flatMap((project) => {
      const values: string[] = [];
      if (project.targetDateHint) {
        values.push(project.targetDateHint);
      }
      if (project.scheduledStartSlot) {
        values.push(project.scheduledStartSlot.slice(0, 10));
      }
      return values;
    }),
    ...state.customClosures.flatMap((closure) => [closure.startDate, closure.endDate]),
  ];

  const generatedClosures = state.holidaySources.flatMap((source) => {
    if (!source.enabled || source.code !== "FR") {
      return [];
    }

    return getCoveredYears(relevantDates).flatMap((year) =>
      buildFrancePublicHolidays(year)
    );
  });

  return [...generatedClosures, ...state.customClosures].sort((left, right) => {
    if (left.startDate !== right.startDate) {
      return left.startDate.localeCompare(right.startDate);
    }

    return left.title.localeCompare(right.title, "fr");
  });
}

function toPlannerSnapshot(
  persistentState: PersistentPlannerState,
  history: PlannerHistoryState
): PlannerState {
  return {
    teams: getSortedTeams(persistentState.teams),
    holidaySources: persistentState.holidaySources,
    projects: persistentState.projects,
    dependencies: persistentState.dependencies,
    closures: buildEffectiveClosures(persistentState),
    history,
  };
}

function normalizePlannerSnapshot(
  persistentState: PersistentPlannerState,
  history: PlannerHistoryState
) {
  const snapshot = toPlannerSnapshot(persistentState, history);
  const normalized = rescheduleProjects(snapshot);

  return {
    ...normalized,
    history,
  };
}

function toPersistentPlannerState(snapshot: PlannerState): PersistentPlannerState {
  return {
    teams: snapshot.teams,
    holidaySources: snapshot.holidaySources,
    projects: snapshot.projects,
    dependencies: snapshot.dependencies,
    customClosures: snapshot.closures.filter((closure) => closure.source === "custom"),
  };
}

async function readHistoryState(
  executor: DbExecutor,
  sessionId?: string
): Promise<PlannerHistoryState> {
  if (!sessionId) {
    return buildHistoryState();
  }

  const [undoRow, redoRow] = await Promise.all([
    executor
      .select({ actionType: plannerActionLog.actionType })
      .from(plannerActionLog)
      .where(
        and(
          eq(plannerActionLog.sessionId, sessionId),
          isNull(plannerActionLog.undoneAt),
          isNull(plannerActionLog.invalidatedAt)
        )
      )
      .orderBy(desc(plannerActionLog.createdAt))
      .limit(1),
    executor
      .select({ actionType: plannerActionLog.actionType })
      .from(plannerActionLog)
      .where(
        and(
          eq(plannerActionLog.sessionId, sessionId),
          isNotNull(plannerActionLog.undoneAt),
          isNull(plannerActionLog.invalidatedAt)
        )
      )
      .orderBy(asc(plannerActionLog.createdAt))
      .limit(1),
  ]);

  return buildHistoryState({
    undoActionType: undoRow[0]?.actionType,
    redoActionType: redoRow[0]?.actionType,
  });
}

async function ensurePlannerBootstrapped(executor: DbExecutor) {
  await ensureClosureMarkerSchema(executor);

  const existingTeamCount = await executor
    .select({ count: sql<number>`count(*)` })
    .from(teams);

  if (Number(existingTeamCount[0]?.count ?? 0) === 0) {
    await replacePersistentState(executor, getBasePersistentState());
    return;
  }

  const existingHolidaySources = await executor
    .select({ count: sql<number>`count(*)` })
    .from(holidaySources);
  if (Number(existingHolidaySources[0]?.count ?? 0) === 0) {
    await executor.insert(holidaySources).values(
      initialPlannerState.holidaySources.map((source) => ({
        id: source.id,
        code: source.code,
        labelFr: source.labelFr,
        enabled: source.enabled,
      }))
    );
  }
}

export async function loadPlannerSnapshot(sessionId?: string) {
  const db = getDb();
  await ensureDbReady();
  await ensurePlannerBootstrapped(db);
  const persistentState = await readPersistentState(db);
  const history = await readHistoryState(db, sessionId);
  return normalizePlannerSnapshot(persistentState, history);
}

async function invalidateRedoStack(executor: DbExecutor, sessionId: string) {
  await executor
    .update(plannerActionLog)
    .set({
      invalidatedAt: new Date(),
    })
    .where(
      and(
        eq(plannerActionLog.sessionId, sessionId),
        isNotNull(plannerActionLog.undoneAt),
        isNull(plannerActionLog.invalidatedAt)
      )
    );
}

async function commitLoggedMutation(
  sessionId: string,
  actionType: string,
  payload: Record<string, unknown>,
  mutator: (state: PlannerState) => PlannerState
) {
  if (!sessionId) {
    throw new Error("Une session de planning est requise.");
  }

  const db = getDb();
  await ensureDbReady();
  return db.transaction(async (tx) => {
    await ensurePlannerBootstrapped(tx);
    await invalidateRedoStack(tx, sessionId);

    const persistentBefore = await readPersistentState(tx);
    const historyBefore = await readHistoryState(tx, sessionId);
    const beforeSnapshot = normalizePlannerSnapshot(persistentBefore, historyBefore);
    const nextSnapshot = mutator(beforeSnapshot);
    const normalizedAfter = normalizePlannerSnapshot(
      toPersistentPlannerState(nextSnapshot),
      buildHistoryState({
        undoActionType: actionType,
      })
    );
    const persistentAfter = toPersistentPlannerState(normalizedAfter);

    await replacePersistentState(tx, persistentAfter);

    const logId = crypto.randomUUID();
    const afterSnapshotForLog = normalizedAfter;

    await tx.insert(plannerActionLog).values({
      id: logId,
      sessionId,
      actionType,
      payload,
      beforeSnapshot,
      afterSnapshot: afterSnapshotForLog,
    });

    const historyAfter = await readHistoryState(tx, sessionId);
    return {
      ...normalizedAfter,
      history: historyAfter,
    };
  });
}

export async function saveProject(
  sessionId: string,
  values: ProjectEditorState,
  projectId?: string
) {
  return commitLoggedMutation(
    sessionId,
    "project.upsert",
    { projectId: projectId ?? null, values },
    (state) => upsertProjectInState(state, values, projectId)
  );
}

export async function placeProject(
  sessionId: string,
  projectId: string,
  placement: ProjectPlacement,
  options?: ProjectPlacementOptions
) {
  return commitLoggedMutation(
    sessionId,
    "project.place",
    { projectId, placement, options: options ?? null },
    (state) => placeProjectInState(state, projectId, placement, options)
  );
}

export async function placeProjects(
  sessionId: string,
  placements: ProjectPlacementRequest[],
  options?: ProjectPlacementOptions
) {
  return commitLoggedMutation(
    sessionId,
    "project.placeMany",
    { placements, options: options ?? null },
    (state) => placeProjectsInState(state, placements, options)
  );
}

export async function unscheduleProject(sessionId: string, projectId: string) {
  return commitLoggedMutation(
    sessionId,
    "project.unschedule",
    { projectId },
    (state) => unscheduleProjectInState(state, projectId)
  );
}

export async function deleteProject(
  sessionId: string,
  projectId: string,
  mode?: ProjectDeleteMode
) {
  return commitLoggedMutation(
    sessionId,
    "project.delete",
    { projectId, mode: mode ?? null },
    (state) => deleteProjectInState(state, projectId, mode)
  );
}

export async function createClosure(sessionId: string, values: ClosureFormState) {
  return commitLoggedMutation(
    sessionId,
    "closure.add",
    { values },
    (state) => addClosureInState(state, values)
  );
}

export async function deleteClosure(sessionId: string, closureId: string) {
  return commitLoggedMutation(
    sessionId,
    "closure.delete",
    { closureId },
    (state) => removeClosureInState(state, closureId)
  );
}

export async function createTeam(sessionId: string, values: TeamEditorState) {
  return commitLoggedMutation(
    sessionId,
    "team.create",
    { values },
    (state) => createTeamInState(state, values)
  );
}

export async function updateTeam(
  sessionId: string,
  teamId: string,
  values: TeamEditorState
) {
  return commitLoggedMutation(
    sessionId,
    "team.update",
    { teamId, values },
    (state) => updateTeamInState(state, teamId, values)
  );
}

export async function deleteTeam(sessionId: string, teamId: string) {
  return commitLoggedMutation(
    sessionId,
    "team.delete",
    { teamId },
    (state) => deleteTeamInState(state, teamId)
  );
}

export async function setHolidaySourceEnabled(
  sessionId: string,
  sourceCode: string,
  enabled: boolean
) {
  return commitLoggedMutation(
    sessionId,
    "holiday-source.toggle",
    { sourceCode, enabled },
    (state) => toggleHolidaySourceInState(state, sourceCode, enabled)
  );
}

export async function resetDemoData(sessionId: string) {
  return commitLoggedMutation(sessionId, "demo.reset", {}, (state) =>
    resetPlannerDemoDataInState(state)
  );
}

export async function undoPlannerAction(sessionId: string) {
  const db = getDb();
  await ensureDbReady();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(plannerActionLog)
      .where(
        and(
          eq(plannerActionLog.sessionId, sessionId),
          isNull(plannerActionLog.undoneAt),
          isNull(plannerActionLog.invalidatedAt)
        )
      )
      .orderBy(desc(plannerActionLog.createdAt))
      .limit(1);

    const entry = rows[0];
    if (!entry) {
      return loadPlannerSnapshot(sessionId);
    }

    const snapshot = entry.beforeSnapshot as PlannerState;
    await replacePersistentState(tx, toPersistentPlannerState(snapshot));
    await tx
      .update(plannerActionLog)
      .set({
        undoneAt: new Date(),
      })
      .where(eq(plannerActionLog.id, entry.id));

    const history = await readHistoryState(tx, sessionId);
    return {
      ...snapshot,
      history,
    };
  });
}

export async function redoPlannerAction(sessionId: string) {
  const db = getDb();
  await ensureDbReady();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(plannerActionLog)
      .where(
        and(
          eq(plannerActionLog.sessionId, sessionId),
          isNotNull(plannerActionLog.undoneAt),
          isNull(plannerActionLog.invalidatedAt)
        )
      )
      .orderBy(asc(plannerActionLog.createdAt))
      .limit(1);

    const entry = rows[0];
    if (!entry) {
      return loadPlannerSnapshot(sessionId);
    }

    const snapshot = entry.afterSnapshot as PlannerState;
    await replacePersistentState(tx, toPersistentPlannerState(snapshot));
    await tx
      .update(plannerActionLog)
      .set({
        undoneAt: null,
      })
      .where(eq(plannerActionLog.id, entry.id));

    const history = await readHistoryState(tx, sessionId);
    return {
      ...snapshot,
      history,
    };
  });
}
