"use server";

import {
  approximateJsonByteSize,
  extendPlannerTraceContext,
  finishPlannerTrace,
  isPlannerServerTraceEnabled,
  measurePlannerTraceStepAsync,
  startPlannerTrace,
  summarizePlannerSnapshot,
} from "@/lib/planner/planner-trace";
import type { PlannerTraceContext } from "@/lib/planner/planner-trace";
import type {
  ClosureFormState,
  ProjectDeleteMode,
  ProjectEditorState,
  ProjectPlacement,
  ProjectPlacementOptions,
  ProjectPlacementRequest,
  TeamEditorState,
} from "@/lib/planner/types";
import {
  createClosure,
  createTeam,
  deleteClosure,
  deleteProject,
  deleteTeam,
  loadPlannerSnapshot,
  placeProject,
  placeProjects,
  redoPlannerAction,
  resetDemoData,
  saveProject,
  setHolidaySourceEnabled,
  undoPlannerAction,
  unscheduleProject,
  updateTeam,
} from "@/lib/planner/store";

async function runTracedPlannerAction(
  label: string,
  traceContext: PlannerTraceContext | null | undefined,
  payload: Record<string, unknown>,
  fn: (
    actionTraceContext?: PlannerTraceContext | null
  ) => Promise<Awaited<ReturnType<typeof loadPlannerSnapshot>>>
) {
  const actionTraceContext = isPlannerServerTraceEnabled()
    ? extendPlannerTraceContext(traceContext, {
        runtime: "server",
        phase: "server-action",
      })
    : null;
  const trace = startPlannerTrace(label, actionTraceContext, payload);

  try {
    const snapshot = await measurePlannerTraceStepAsync(
      trace,
      `${label}.store`,
      () => fn(actionTraceContext),
      {
        ...payload,
        payloadBytes: approximateJsonByteSize(payload),
      }
    );
    finishPlannerTrace(trace, {
      payloadBytes: approximateJsonByteSize(payload),
      snapshotSummary: summarizePlannerSnapshot(snapshot),
    });
    return snapshot;
  } catch (error) {
    finishPlannerTrace(trace, {
      payloadBytes: approximateJsonByteSize(payload),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function loadPlannerSnapshotAction(
  sessionId?: string,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.loadSnapshot",
    traceContext,
    {
      sessionId: sessionId ?? null,
    },
    (actionTraceContext) => loadPlannerSnapshot(sessionId, actionTraceContext)
  );
}

export async function saveProjectAction(
  sessionId: string,
  values: ProjectEditorState,
  projectId?: string,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.saveProject",
    traceContext,
    {
      sessionId,
      projectId: projectId ?? null,
      valueBytes: approximateJsonByteSize(values),
    },
    (actionTraceContext) =>
      saveProject(sessionId, values, projectId, actionTraceContext)
  );
}

export async function placeProjectAction(
  sessionId: string,
  projectId: string,
  placement: ProjectPlacement,
  options?: ProjectPlacementOptions,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.placeProject",
    traceContext,
    {
      sessionId,
      projectId,
      source: options?.source ?? null,
      placementBytes: approximateJsonByteSize(placement),
      optionsBytes: approximateJsonByteSize(options ?? null),
    },
    (actionTraceContext) =>
      placeProject(sessionId, projectId, placement, options, actionTraceContext)
  );
}

export async function placeProjectsAction(
  sessionId: string,
  placements: ProjectPlacementRequest[],
  options?: ProjectPlacementOptions,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.placeProjects",
    traceContext,
    {
      sessionId,
      placementCount: placements.length,
      source: options?.source ?? null,
      placementsBytes: approximateJsonByteSize(placements),
      optionsBytes: approximateJsonByteSize(options ?? null),
    },
    (actionTraceContext) =>
      placeProjects(sessionId, placements, options, actionTraceContext)
  );
}

export async function unscheduleProjectAction(
  sessionId: string,
  projectId: string,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.unscheduleProject",
    traceContext,
    {
      sessionId,
      projectId,
    },
    (actionTraceContext) =>
      unscheduleProject(sessionId, projectId, actionTraceContext)
  );
}

export async function deleteProjectAction(
  sessionId: string,
  projectId: string,
  mode?: ProjectDeleteMode,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.deleteProject",
    traceContext,
    {
      sessionId,
      projectId,
      mode: mode ?? null,
    },
    (actionTraceContext) =>
      deleteProject(sessionId, projectId, mode, actionTraceContext)
  );
}

export async function createClosureAction(
  sessionId: string,
  values: ClosureFormState,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.createClosure",
    traceContext,
    {
      sessionId,
      valueBytes: approximateJsonByteSize(values),
    },
    (actionTraceContext) => createClosure(sessionId, values, actionTraceContext)
  );
}

export async function deleteClosureAction(
  sessionId: string,
  closureId: string,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.deleteClosure",
    traceContext,
    {
      sessionId,
      closureId,
    },
    (actionTraceContext) =>
      deleteClosure(sessionId, closureId, actionTraceContext)
  );
}

export async function createTeamAction(
  sessionId: string,
  values: TeamEditorState,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.createTeam",
    traceContext,
    {
      sessionId,
      valueBytes: approximateJsonByteSize(values),
    },
    (actionTraceContext) => createTeam(sessionId, values, actionTraceContext)
  );
}

export async function updateTeamAction(
  sessionId: string,
  teamId: string,
  values: TeamEditorState,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.updateTeam",
    traceContext,
    {
      sessionId,
      teamId,
      valueBytes: approximateJsonByteSize(values),
    },
    (actionTraceContext) =>
      updateTeam(sessionId, teamId, values, actionTraceContext)
  );
}

export async function deleteTeamAction(
  sessionId: string,
  teamId: string,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.deleteTeam",
    traceContext,
    {
      sessionId,
      teamId,
    },
    (actionTraceContext) => deleteTeam(sessionId, teamId, actionTraceContext)
  );
}

export async function setHolidaySourceEnabledAction(
  sessionId: string,
  sourceCode: string,
  enabled: boolean,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.setHolidaySourceEnabled",
    traceContext,
    {
      sessionId,
      sourceCode,
      enabled,
    },
    (actionTraceContext) =>
      setHolidaySourceEnabled(
        sessionId,
        sourceCode,
        enabled,
        actionTraceContext
      )
  );
}

export async function resetDemoDataAction(
  sessionId: string,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.resetDemoData",
    traceContext,
    {
      sessionId,
    },
    (actionTraceContext) => resetDemoData(sessionId, actionTraceContext)
  );
}

export async function undoPlannerActionAction(
  sessionId: string,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.undo",
    traceContext,
    {
      sessionId,
    },
    (actionTraceContext) => undoPlannerAction(sessionId, actionTraceContext)
  );
}

export async function redoPlannerActionAction(
  sessionId: string,
  traceContext?: PlannerTraceContext | null
) {
  return runTracedPlannerAction(
    "planner.action.redo",
    traceContext,
    {
      sessionId,
    },
    (actionTraceContext) => redoPlannerAction(sessionId, actionTraceContext)
  );
}
