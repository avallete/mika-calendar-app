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
import {
  addPlannerTraceContextFields,
  approximateJsonByteSize,
  buildPlannerCaptureServerSummary,
  extendPlannerTraceContext,
  finishPlannerTrace,
  logPlannerCaptureEvent,
  measurePlannerTraceStep,
  measurePlannerTraceStepAsync,
  startPlannerTrace,
  summarizePlannerSnapshot,
  type PlannerTraceContext,
  type PlannerTraceLike,
} from "@/lib/planner/planner-trace";
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
  history: PlannerHistoryState,
  traceContext?: PlannerTraceLike,
  label = "planner.store.normalizeSnapshot"
) {
  const snapshot = measurePlannerTraceStep(
    traceContext,
    `${label}.toPlannerSnapshot`,
    () => toPlannerSnapshot(persistentState, history),
    addPlannerTraceContextFields(traceContext, {
      persistentSummary: summarizePlannerSnapshot(persistentState),
    })
  );
  const materializedSnapshot = measurePlannerTraceStep(
    traceContext,
    `${label}.materialize`,
    () => materializePlannerState(snapshot),
    addPlannerTraceContextFields(traceContext, {
      snapshotSummary: summarizePlannerSnapshot(snapshot),
    })
  );
  const normalized = measurePlannerTraceStep(
    traceContext,
    `${label}.reschedule`,
    () => {
      const traceFields = addPlannerTraceContextFields(traceContext);
      const traceSource =
        typeof traceFields.traceSource === "string"
          ? traceFields.traceSource
          : "load";
      return rescheduleProjects(materializedSnapshot, {
        action: label,
        metadata: {
          source: traceSource,
        },
        traceContext,
      });
    },
    addPlannerTraceContextFields(traceContext, {
      snapshotSummary: summarizePlannerSnapshot(materializedSnapshot),
    })
  );

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

async function ensurePlannerBootstrapped(
  executor: DbExecutor,
  traceContext?: PlannerTraceLike
) {
  await measurePlannerTraceStepAsync(
    traceContext,
    "planner.store.bootstrap.ensureSchema",
    () => ensureClosureMarkerSchema(executor),
    addPlannerTraceContextFields(traceContext)
  );

  const existingTeamCount = await measurePlannerTraceStepAsync(
    traceContext,
    "planner.store.bootstrap.teamCount",
    () =>
      executor.select({ count: sql<number>`count(*)` }).from(teams),
    addPlannerTraceContextFields(traceContext)
  );

  if (Number(existingTeamCount[0]?.count ?? 0) === 0) {
    const baseState = getBasePersistentState();
    await measurePlannerTraceStepAsync(
      traceContext,
      "planner.store.bootstrap.seedBaseState",
      () =>
        replacePersistentState(executor, baseState, traceContext, {
          after: summarizePlannerSnapshot(baseState),
        }),
      addPlannerTraceContextFields(traceContext, {
        snapshotSummary: summarizePlannerSnapshot(baseState),
      })
    );
    return;
  }

  const existingHolidaySources = await measurePlannerTraceStepAsync(
    traceContext,
    "planner.store.bootstrap.holidaySourceCount",
    () =>
      executor.select({ count: sql<number>`count(*)` }).from(holidaySources),
    addPlannerTraceContextFields(traceContext)
  );
  if (Number(existingHolidaySources[0]?.count ?? 0) === 0) {
    await measurePlannerTraceStepAsync(
      traceContext,
      "planner.store.bootstrap.backfillHolidaySources",
      () =>
        executor.insert(holidaySources).values(
          initialPlannerState.holidaySources.map((source) => ({
            id: source.id,
            code: source.code,
            labelFr: source.labelFr,
            enabled: source.enabled,
          }))
        ),
      addPlannerTraceContextFields(traceContext, {
        rowCount: initialPlannerState.holidaySources.length,
      })
    );
  }
}

function getPlannerServerCaptureEnvironment() {
  return {
    nodeEnv:
      typeof process !== "undefined"
        ? (process.env.NODE_ENV ?? "development")
        : "development",
    serverTraceEnabled: true,
  };
}

function logPlannerServerCaptureStart(
  traceContext: PlannerTraceContext | null,
  payload: Record<string, unknown>
) {
  if (!traceContext) {
    return;
  }

  logPlannerCaptureEvent(
    "planner.capture.start",
    {
      ...payload,
      environment: getPlannerServerCaptureEnvironment(),
    },
    traceContext
  );
}

function logPlannerServerCaptureCompletion(
  traceContext: PlannerTraceContext | null,
  payload: Record<string, unknown>,
  summary: ReturnType<typeof buildPlannerCaptureServerSummary>
) {
  if (!traceContext) {
    return;
  }

  logPlannerCaptureEvent(
    "planner.capture.server.summary",
    {
      ...payload,
      summary,
    },
    traceContext
  );
  logPlannerCaptureEvent(
    "planner.capture.end",
    {
      ...payload,
      summary,
      environment: getPlannerServerCaptureEnvironment(),
    },
    traceContext
  );
}

export async function loadPlannerSnapshot(
  sessionId?: string,
  traceContext?: PlannerTraceContext | null
) {
  const storeTraceContext = extendPlannerTraceContext(traceContext, {
    runtime: "server",
    phase: "store",
  });
  const trace = startPlannerTrace("planner.store.loadSnapshot", storeTraceContext, {
    sessionId: sessionId ?? null,
  });
  const db = getDb();
  try {
    await measurePlannerTraceStepAsync(
      trace,
      "planner.store.load.dbReady",
      () => ensureDbReady(),
      addPlannerTraceContextFields(storeTraceContext, {
        sessionId: sessionId ?? null,
      })
    );
    await measurePlannerTraceStepAsync(
      trace,
      "planner.store.load.bootstrap",
      () => ensurePlannerBootstrapped(db, storeTraceContext),
      addPlannerTraceContextFields(storeTraceContext)
    );
    const persistentState = await measurePlannerTraceStepAsync(
      trace,
      "planner.store.load.readPersistentState",
      () => readPersistentState(db),
      addPlannerTraceContextFields(storeTraceContext)
    );
    const history = await measurePlannerTraceStepAsync(
      trace,
      "planner.store.load.readHistoryState",
      () => readHistoryState(db, sessionId),
      addPlannerTraceContextFields(storeTraceContext, {
        sessionId: sessionId ?? null,
      })
    );
    logPlannerServerCaptureStart(storeTraceContext, {
      sessionId: sessionId ?? null,
      actionType: "loadSnapshot",
      source: storeTraceContext?.source ?? null,
      snapshotSummary: summarizePlannerSnapshot(persistentState),
    });
    const snapshot = normalizePlannerSnapshot(
      persistentState,
      history,
      trace,
      "planner.store.load.normalizeSnapshot"
    );
    const serverSummary = buildPlannerCaptureServerSummary(trace);
    logPlannerServerCaptureCompletion(
      storeTraceContext,
      {
        sessionId: sessionId ?? null,
        actionType: "loadSnapshot",
        source: storeTraceContext?.source ?? null,
        snapshotSummary: summarizePlannerSnapshot(snapshot),
      },
      serverSummary
    );
    finishPlannerTrace(trace, {
      snapshotSummary: summarizePlannerSnapshot(snapshot),
    });
    return snapshot;
  } catch (error) {
    finishPlannerTrace(trace, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function invalidateRedoStack(
  executor: DbExecutor,
  sessionId: string,
  traceContext?: PlannerTraceLike
) {
  await measurePlannerTraceStepAsync(
    traceContext,
    "planner.store.invalidateRedoStack",
    async () => {
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
    },
    addPlannerTraceContextFields(traceContext, {
      sessionId,
    })
  );
}

async function commitLoggedMutation(
  sessionId: string,
  actionType: string,
  payload: Record<string, unknown>,
  mutator: (state: PlannerState, traceContext?: PlannerTraceContext | null) => PlannerState,
  traceContext?: PlannerTraceContext | null
) {
  if (!sessionId) {
    throw new Error("Une session de planning est requise.");
  }

  const db = getDb();
  const storeTraceContext = extendPlannerTraceContext(traceContext, {
    runtime: "server",
    phase: "store",
  });
  const persistenceTraceContext = extendPlannerTraceContext(storeTraceContext, {
    phase: "persistence",
  });
  const trace = startPlannerTrace("planner.store.commitMutation", storeTraceContext, {
    actionType,
    sessionId,
    payloadBytes: approximateJsonByteSize(payload),
  });
  try {
    await measurePlannerTraceStepAsync(
      trace,
      "planner.store.commit.dbReady",
      () => ensureDbReady(),
      addPlannerTraceContextFields(storeTraceContext, {
        sessionId,
      })
    );
    const nextSnapshot = await measurePlannerTraceStepAsync(
      trace,
      "planner.store.commit.transaction",
      () =>
        db.transaction(async (tx) => {
          await ensurePlannerBootstrapped(tx, trace);
          await invalidateRedoStack(tx, sessionId, trace);

          const persistentBefore = await measurePlannerTraceStepAsync(
            trace,
            "planner.store.commit.readPersistentState.before",
            () => readPersistentState(tx),
            addPlannerTraceContextFields(storeTraceContext)
          );
          const historyBefore = await measurePlannerTraceStepAsync(
            trace,
            "planner.store.commit.readHistoryState.before",
            () => readHistoryState(tx, sessionId),
            addPlannerTraceContextFields(storeTraceContext, {
              sessionId,
            })
          );
          const beforeSnapshot = normalizePlannerSnapshot(
            persistentBefore,
            historyBefore,
            trace,
            "planner.store.commit.normalizeBefore"
          );
          logPlannerServerCaptureStart(storeTraceContext, {
            sessionId,
            actionType,
            source: storeTraceContext?.source ?? null,
            snapshotSummary: summarizePlannerSnapshot(beforeSnapshot),
          });
          const nextSnapshot = measurePlannerTraceStep(
            trace,
            "planner.store.commit.stateMutator",
            () => mutator(beforeSnapshot, storeTraceContext),
            addPlannerTraceContextFields(storeTraceContext, {
              beforeSnapshotSummary: summarizePlannerSnapshot(beforeSnapshot),
            })
          );
          const normalizedAfter = normalizePlannerSnapshot(
            plannerStateToPersistentState(nextSnapshot),
            buildHistoryState({
              undoActionType: actionType,
            }),
            trace,
            "planner.store.commit.normalizeAfter"
          );
          const persistentAfter = plannerStateToPersistentState(normalizedAfter);

          await measurePlannerTraceStepAsync(
            trace,
            "planner.store.commit.replacePersistentState",
            () =>
              replacePersistentState(tx, persistentAfter, persistenceTraceContext, {
                before: summarizePlannerSnapshot(persistentBefore),
                after: summarizePlannerSnapshot(persistentAfter),
              }),
            addPlannerTraceContextFields(storeTraceContext, {
              beforeSummary: summarizePlannerSnapshot(persistentBefore),
              afterSummary: summarizePlannerSnapshot(persistentAfter),
            })
          );

          const logId = crypto.randomUUID();
          const afterSnapshotForLog = normalizedAfter;

          await measurePlannerTraceStepAsync(
            trace,
            "planner.store.commit.insertActionLog",
            () =>
              tx.insert(plannerActionLog).values({
                id: logId,
                sessionId,
                actionType,
                payload,
                beforeSnapshot,
                afterSnapshot: afterSnapshotForLog,
              }),
            addPlannerTraceContextFields(storeTraceContext, {
              payloadBytes: approximateJsonByteSize(payload),
              beforeSnapshotBytes: approximateJsonByteSize(beforeSnapshot),
              afterSnapshotBytes: approximateJsonByteSize(afterSnapshotForLog),
            })
          );

          const historyAfter = await measurePlannerTraceStepAsync(
            trace,
            "planner.store.commit.readHistoryState.after",
            () => readHistoryState(tx, sessionId),
            addPlannerTraceContextFields(storeTraceContext, {
              sessionId,
            })
          );
          return {
            ...normalizedAfter,
            history: historyAfter,
          };
        }),
      addPlannerTraceContextFields(storeTraceContext, {
        actionType,
      })
    );
    const serverSummary = buildPlannerCaptureServerSummary(trace);
    logPlannerServerCaptureCompletion(
      storeTraceContext,
      {
        sessionId,
        actionType,
        source: storeTraceContext?.source ?? null,
        snapshotSummary: summarizePlannerSnapshot(nextSnapshot),
      },
      serverSummary
    );
    finishPlannerTrace(trace, {
      actionType,
      snapshotSummary: summarizePlannerSnapshot(nextSnapshot),
    });
    return nextSnapshot;
  } catch (error) {
    finishPlannerTrace(trace, {
      actionType,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function saveProject(
  sessionId: string,
  values: ProjectEditorState,
  projectId?: string,
  traceContext?: PlannerTraceContext | null
) {
  return commitLoggedMutation(
    sessionId,
    "project.upsert",
    { projectId: projectId ?? null, values },
    (state, actionTraceContext) =>
      upsertProjectInState(state, values, projectId, actionTraceContext),
    traceContext
  );
}

export async function placeProject(
  sessionId: string,
  projectId: string,
  placement: ProjectPlacement,
  options?: ProjectPlacementOptions,
  traceContext?: PlannerTraceContext | null
) {
  return commitLoggedMutation(
    sessionId,
    "project.place",
    { projectId, placement, options: options ?? null },
    (state, actionTraceContext) =>
      placeProjectInState(state, projectId, placement, options, actionTraceContext),
    traceContext
  );
}

export async function placeProjects(
  sessionId: string,
  placements: ProjectPlacementRequest[],
  options?: ProjectPlacementOptions,
  traceContext?: PlannerTraceContext | null
) {
  return commitLoggedMutation(
    sessionId,
    "project.placeMany",
    { placements, options: options ?? null },
    (state, actionTraceContext) =>
      placeProjectsInState(state, placements, options, actionTraceContext),
    traceContext
  );
}

export async function unscheduleProject(
  sessionId: string,
  projectId: string,
  traceContext?: PlannerTraceContext | null
) {
  return commitLoggedMutation(
    sessionId,
    "project.unschedule",
    { projectId },
    (state, actionTraceContext) =>
      unscheduleProjectInState(state, projectId, actionTraceContext),
    traceContext
  );
}

export async function deleteProject(
  sessionId: string,
  projectId: string,
  mode?: ProjectDeleteMode,
  traceContext?: PlannerTraceContext | null
) {
  return commitLoggedMutation(
    sessionId,
    "project.delete",
    { projectId, mode: mode ?? null },
    (state, actionTraceContext) =>
      deleteProjectInState(state, projectId, mode, actionTraceContext),
    traceContext
  );
}

export async function createClosure(
  sessionId: string,
  values: ClosureFormState,
  traceContext?: PlannerTraceContext | null
) {
  return commitLoggedMutation(
    sessionId,
    "closure.add",
    { values },
    (state, actionTraceContext) => addClosureInState(state, values, actionTraceContext),
    traceContext
  );
}

export async function deleteClosure(
  sessionId: string,
  closureId: string,
  traceContext?: PlannerTraceContext | null
) {
  return commitLoggedMutation(
    sessionId,
    "closure.delete",
    { closureId },
    (state, actionTraceContext) =>
      removeClosureInState(state, closureId, actionTraceContext),
    traceContext
  );
}

export async function createTeam(
  sessionId: string,
  values: TeamEditorState,
  traceContext?: PlannerTraceContext | null
) {
  return commitLoggedMutation(
    sessionId,
    "team.create",
    { values },
    (state) => createTeamInState(state, values),
    traceContext
  );
}

export async function updateTeam(
  sessionId: string,
  teamId: string,
  values: TeamEditorState,
  traceContext?: PlannerTraceContext | null
) {
  return commitLoggedMutation(
    sessionId,
    "team.update",
    { teamId, values },
    (state) => updateTeamInState(state, teamId, values),
    traceContext
  );
}

export async function deleteTeam(
  sessionId: string,
  teamId: string,
  traceContext?: PlannerTraceContext | null
) {
  return commitLoggedMutation(
    sessionId,
    "team.delete",
    { teamId },
    (state) => deleteTeamInState(state, teamId),
    traceContext
  );
}

export async function setHolidaySourceEnabled(
  sessionId: string,
  sourceCode: string,
  enabled: boolean,
  traceContext?: PlannerTraceContext | null
) {
  return commitLoggedMutation(
    sessionId,
    "holiday-source.toggle",
    { sourceCode, enabled },
    (state, actionTraceContext) =>
      toggleHolidaySourceInState(state, sourceCode, enabled, actionTraceContext),
    traceContext
  );
}

export async function resetDemoData(
  sessionId: string,
  traceContext?: PlannerTraceContext | null
) {
  return commitLoggedMutation(
    sessionId,
    "demo.reset",
    {},
    (state) => resetPlannerDemoDataInState(state),
    traceContext
  );
}

export async function undoPlannerAction(
  sessionId: string,
  traceContext?: PlannerTraceContext | null
) {
  const storeTraceContext = extendPlannerTraceContext(traceContext, {
    runtime: "server",
    phase: "store",
  });
  const persistenceTraceContext = extendPlannerTraceContext(storeTraceContext, {
    phase: "persistence",
  });
  const trace = startPlannerTrace("planner.store.undo", storeTraceContext, {
    sessionId,
  });
  const db = getDb();
  try {
    await measurePlannerTraceStepAsync(
      trace,
      "planner.store.undo.dbReady",
      () => ensureDbReady(),
      addPlannerTraceContextFields(storeTraceContext, {
        sessionId,
      })
    );
    const snapshot = await measurePlannerTraceStepAsync(
      trace,
      "planner.store.undo.transaction",
      () =>
        db.transaction(async (tx) => {
          const rows = await measurePlannerTraceStepAsync(
            trace,
            "planner.store.undo.readActionLog",
            () =>
              tx
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
                .limit(1),
            addPlannerTraceContextFields(storeTraceContext, {
              sessionId,
            })
          );

          const entry = rows[0];
          if (!entry) {
            return loadPlannerSnapshot(sessionId, storeTraceContext);
          }

          const snapshot = entry.beforeSnapshot as PlannerState;
          logPlannerServerCaptureStart(storeTraceContext, {
            sessionId,
            actionType: "undo",
            source: storeTraceContext?.source ?? null,
            snapshotSummary: summarizePlannerSnapshot(snapshot),
          });
          await measurePlannerTraceStepAsync(
            trace,
            "planner.store.undo.replacePersistentState",
            () =>
              replacePersistentState(
                tx,
                plannerStateToPersistentState(snapshot),
                persistenceTraceContext,
                {
                  after: summarizePlannerSnapshot(snapshot),
                }
              ),
            addPlannerTraceContextFields(storeTraceContext, {
              snapshotSummary: summarizePlannerSnapshot(snapshot),
            })
          );
          await measurePlannerTraceStepAsync(
            trace,
            "planner.store.undo.markEntryUndone",
            async () => {
              await tx
                .update(plannerActionLog)
                .set({
                  undoneAt: new Date(),
                })
                .where(eq(plannerActionLog.id, entry.id));
            },
            addPlannerTraceContextFields(storeTraceContext, {
              actionLogId: entry.id,
            })
          );

          const history = await measurePlannerTraceStepAsync(
            trace,
            "planner.store.undo.readHistoryState",
            () => readHistoryState(tx, sessionId),
            addPlannerTraceContextFields(storeTraceContext, {
              sessionId,
            })
          );
          return {
            ...snapshot,
            history,
          };
        }),
      addPlannerTraceContextFields(storeTraceContext, {
        sessionId,
      })
    );
    const serverSummary = buildPlannerCaptureServerSummary(trace);
    logPlannerServerCaptureCompletion(
      storeTraceContext,
      {
        sessionId,
        actionType: "undo",
        source: storeTraceContext?.source ?? null,
        snapshotSummary: summarizePlannerSnapshot(snapshot),
      },
      serverSummary
    );
    finishPlannerTrace(trace, {
      sessionId,
      snapshotSummary: summarizePlannerSnapshot(snapshot),
    });
    return snapshot;
  } catch (error) {
    finishPlannerTrace(trace, {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function redoPlannerAction(
  sessionId: string,
  traceContext?: PlannerTraceContext | null
) {
  const storeTraceContext = extendPlannerTraceContext(traceContext, {
    runtime: "server",
    phase: "store",
  });
  const persistenceTraceContext = extendPlannerTraceContext(storeTraceContext, {
    phase: "persistence",
  });
  const trace = startPlannerTrace("planner.store.redo", storeTraceContext, {
    sessionId,
  });
  const db = getDb();
  try {
    await measurePlannerTraceStepAsync(
      trace,
      "planner.store.redo.dbReady",
      () => ensureDbReady(),
      addPlannerTraceContextFields(storeTraceContext, {
        sessionId,
      })
    );
    const snapshot = await measurePlannerTraceStepAsync(
      trace,
      "planner.store.redo.transaction",
      () =>
        db.transaction(async (tx) => {
          const rows = await measurePlannerTraceStepAsync(
            trace,
            "planner.store.redo.readActionLog",
            () =>
              tx
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
                .limit(1),
            addPlannerTraceContextFields(storeTraceContext, {
              sessionId,
            })
          );

          const entry = rows[0];
          if (!entry) {
            return loadPlannerSnapshot(sessionId, storeTraceContext);
          }

          const snapshot = entry.afterSnapshot as PlannerState;
          logPlannerServerCaptureStart(storeTraceContext, {
            sessionId,
            actionType: "redo",
            source: storeTraceContext?.source ?? null,
            snapshotSummary: summarizePlannerSnapshot(snapshot),
          });
          await measurePlannerTraceStepAsync(
            trace,
            "planner.store.redo.replacePersistentState",
            () =>
              replacePersistentState(
                tx,
                plannerStateToPersistentState(snapshot),
                persistenceTraceContext,
                {
                  after: summarizePlannerSnapshot(snapshot),
                }
              ),
            addPlannerTraceContextFields(storeTraceContext, {
              snapshotSummary: summarizePlannerSnapshot(snapshot),
            })
          );
          await measurePlannerTraceStepAsync(
            trace,
            "planner.store.redo.markEntryActive",
            async () => {
              await tx
                .update(plannerActionLog)
                .set({
                  undoneAt: null,
                })
                .where(eq(plannerActionLog.id, entry.id));
            },
            addPlannerTraceContextFields(storeTraceContext, {
              actionLogId: entry.id,
            })
          );

          const history = await measurePlannerTraceStepAsync(
            trace,
            "planner.store.redo.readHistoryState",
            () => readHistoryState(tx, sessionId),
            addPlannerTraceContextFields(storeTraceContext, {
              sessionId,
            })
          );
          return {
            ...snapshot,
            history,
          };
        }),
      addPlannerTraceContextFields(storeTraceContext, {
        sessionId,
      })
    );
    const serverSummary = buildPlannerCaptureServerSummary(trace);
    logPlannerServerCaptureCompletion(
      storeTraceContext,
      {
        sessionId,
        actionType: "redo",
        source: storeTraceContext?.source ?? null,
        snapshotSummary: summarizePlannerSnapshot(snapshot),
      },
      serverSummary
    );
    finishPlannerTrace(trace, {
      sessionId,
      snapshotSummary: summarizePlannerSnapshot(snapshot),
    });
    return snapshot;
  } catch (error) {
    finishPlannerTrace(trace, {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
