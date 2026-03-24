import { asc, and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { format } from "date-fns";
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
  type DbExecutor,
  type PersistentPlannerState,
  ensureClosureMarkerSchema,
  getBasePersistentState,
  plannerStateToPersistentState,
  replacePersistentState,
} from "@/lib/planner/persistence";
import {
  buildEffectiveClosures,
  materializePlannerState,
} from "@/lib/planner/closure-materialization";
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
      repeatsAnnually: row.repeatsAnnually,
    })),
  };
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
    customClosures: persistentState.customClosures,
    closures: buildEffectiveClosures({
      projects: persistentState.projects,
      holidaySources: persistentState.holidaySources,
      customClosures: persistentState.customClosures,
    }),
    history,
  };
}

function normalizePlannerSnapshot(
  persistentState: PersistentPlannerState,
  history: PlannerHistoryState
) {
  const snapshot = toPlannerSnapshot(persistentState, history);
  const normalized = rescheduleProjects(materializePlannerState(snapshot));

  return {
    ...normalized,
    history,
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
      plannerStateToPersistentState(nextSnapshot),
      buildHistoryState({
        undoActionType: actionType,
      })
    );
    const persistentAfter = plannerStateToPersistentState(normalizedAfter);

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
    await replacePersistentState(tx, plannerStateToPersistentState(snapshot));
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
    await replacePersistentState(tx, plannerStateToPersistentState(snapshot));
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
