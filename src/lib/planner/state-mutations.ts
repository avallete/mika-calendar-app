import {
  deleteProjectFromState,
  rescheduleProjects,
  updateProjectPlacement,
  updateProjectPlacements,
  wouldCreateDependencyCycle,
} from "@/lib/planner/scheduler";
import { materializePlannerState } from "@/lib/planner/closure-materialization";
import type { PlannerTraceContext } from "@/lib/planner/planner-trace";
import { initialPlannerState } from "@/lib/planner/sample-data";
import type {
  ClosureFormState,
  PlannerState,
  ProjectDeleteMode,
  ProjectEditorState,
  ProjectPlacement,
  ProjectPlacementOptions,
  ProjectPlacementRequest,
  TeamEditorState,
} from "@/lib/planner/types";

const TEAM_COLOR_PALETTE = [
  {
    accentColor: "oklch(0.58 0.11 205)",
    softColor: "oklch(0.95 0.03 205)",
  },
  {
    accentColor: "oklch(0.68 0.13 55)",
    softColor: "oklch(0.96 0.04 55)",
  },
  {
    accentColor: "oklch(0.63 0.12 150)",
    softColor: "oklch(0.95 0.03 150)",
  },
  {
    accentColor: "oklch(0.65 0.12 12)",
    softColor: "oklch(0.95 0.03 12)",
  },
];

function cloneState(state: PlannerState): PlannerState {
  return {
    ...state,
    teams: state.teams.map((team) => ({ ...team })),
    holidaySources: state.holidaySources.map((source) => ({ ...source })),
    projects: state.projects.map((project) => ({ ...project })),
    dependencies: state.dependencies.map((dependency) => ({ ...dependency })),
    customClosures: state.customClosures.map((closure) => ({ ...closure })),
    closures: state.closures.map((closure) => ({ ...closure })),
    history: { ...state.history },
  };
}

function nextTeamPalette(index: number) {
  return TEAM_COLOR_PALETTE[index % TEAM_COLOR_PALETTE.length];
}

export function upsertProjectInState(
  state: PlannerState,
  values: ProjectEditorState,
  projectId?: string,
  traceContext?: PlannerTraceContext | null
) {
  const nextState = cloneState(state);
  const existing = nextState.projects.find((project) => project.id === projectId);

  if (existing) {
    existing.title = values.title;
    existing.plannedTeam = values.plannedTeam;
    existing.estimatedDurationHalfDays = values.estimatedDurationHalfDays;
    existing.targetDateHint = values.targetDateHint || undefined;
    existing.notes = values.notes || undefined;
  } else {
    nextState.projects.push({
      id: crypto.randomUUID(),
      title: values.title,
      status: "draft",
      plannedTeam: values.plannedTeam,
      estimatedDurationHalfDays: values.estimatedDurationHalfDays,
      targetDateHint: values.targetDateHint || undefined,
      notes: values.notes || undefined,
    });
  }

  const resolvedProjectId = existing?.id ?? nextState.projects.at(-1)?.id;
  if (!resolvedProjectId) {
    return nextState;
  }

  const otherDependencies = nextState.dependencies.filter(
    (dependency) => dependency.successorProjectId !== resolvedProjectId
  );
  const nextDependencies = [...otherDependencies];

  for (const predecessorProjectId of values.dependencyIds) {
    if (
      wouldCreateDependencyCycle(
        nextDependencies,
        predecessorProjectId,
        resolvedProjectId
      )
    ) {
      continue;
    }

    nextDependencies.push({
      id: crypto.randomUUID(),
      predecessorProjectId,
      successorProjectId: resolvedProjectId,
      lagHalfDays: 0,
    });
  }

  return rescheduleProjects({
    ...nextState,
    dependencies: nextDependencies,
  }, { traceContext });
}

export function placeProjectInState(
  state: PlannerState,
  projectId: string,
  placement: ProjectPlacement,
  options?: ProjectPlacementOptions,
  traceContext?: PlannerTraceContext | null
) {
  return updateProjectPlacement(
    state,
    projectId,
    placement,
    options,
    traceContext
  );
}

export function placeProjectsInState(
  state: PlannerState,
  placements: ProjectPlacementRequest[],
  options?: ProjectPlacementOptions,
  traceContext?: PlannerTraceContext | null
) {
  return updateProjectPlacements(
    state,
    placements,
    options,
    traceContext
  );
}

export function unscheduleProjectInState(
  state: PlannerState,
  projectId: string,
  traceContext?: PlannerTraceContext | null
) {
  return rescheduleProjects({
    ...cloneState(state),
    projects: state.projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            status: "draft" as const,
            scheduledTeam: undefined,
            scheduledStartSlot: undefined,
            scheduledDurationHalfDays: undefined,
            sequenceOrder: undefined,
          }
        : { ...project }
    ),
  }, { traceContext });
}

export function deleteProjectInState(
  state: PlannerState,
  projectId: string,
  mode?: ProjectDeleteMode,
  traceContext?: PlannerTraceContext | null
) {
  return deleteProjectFromState(cloneState(state), projectId, mode, traceContext);
}

export function addClosureInState(
  state: PlannerState,
  values: ClosureFormState,
  traceContext?: PlannerTraceContext | null
) {
  return rescheduleProjects(
    materializePlannerState({
    ...cloneState(state),
    customClosures: [
      ...state.customClosures,
      {
        id: crypto.randomUUID(),
        title: values.title,
        type: values.type,
        startDate: values.startDate,
        endDate: values.endDate,
        impact: values.impact,
        details: values.details || undefined,
        repeatsAnnually: values.repeatsAnnually,
      },
    ],
    }),
    { traceContext }
  );
}

export function removeClosureInState(
  state: PlannerState,
  closureId: string,
  traceContext?: PlannerTraceContext | null
) {
  return rescheduleProjects(
    materializePlannerState({
    ...cloneState(state),
    customClosures: state.customClosures.filter((closure) => closure.id !== closureId),
    }),
    { traceContext }
  );
}

export function createTeamInState(state: PlannerState, values: TeamEditorState) {
  const palette = nextTeamPalette(state.teams.length);
  const accentColor = values.accentColor || palette.accentColor;
  const softColor = values.softColor || palette.softColor;

  return {
    ...cloneState(state),
    teams: [
      ...state.teams,
      {
        id: crypto.randomUUID(),
        slug: values.slug,
        nameFr: values.nameFr,
        displayOrder: values.displayOrder,
        accentColor,
        softColor,
        isActive: true,
      },
    ],
  };
}

export function updateTeamInState(
  state: PlannerState,
  teamId: string,
  values: TeamEditorState
) {
  return {
    ...cloneState(state),
    teams: state.teams.map((team) =>
      team.id === teamId
        ? {
            ...team,
            slug: values.slug,
            nameFr: values.nameFr,
            displayOrder: values.displayOrder,
            accentColor: values.accentColor,
            softColor: values.softColor,
          }
        : { ...team }
    ),
  };
}

export function deleteTeamInState(state: PlannerState, teamId: string) {
  if (state.teams.length <= 1) {
    throw new Error("Au moins une equipe active est requise.");
  }

  const hasLinkedProjects = state.projects.some(
    (project) => project.plannedTeam === teamId || project.scheduledTeam === teamId
  );
  if (hasLinkedProjects) {
    throw new Error(
      "Impossible de supprimer une equipe encore referencee par des projets."
    );
  }

  return {
    ...cloneState(state),
    teams: state.teams.filter((team) => team.id !== teamId),
  };
}

export function toggleHolidaySourceInState(
  state: PlannerState,
  sourceCode: string,
  enabled: boolean,
  traceContext?: PlannerTraceContext | null
) {
  return rescheduleProjects({
    ...materializePlannerState({
      ...cloneState(state),
      holidaySources: state.holidaySources.map((source) =>
        source.code === sourceCode ? { ...source, enabled } : { ...source }
      ),
    }),
  }, { traceContext });
}

export function resetPlannerDemoDataInState(state: PlannerState) {
  return {
    ...cloneState(state),
    teams: initialPlannerState.teams.map((team) => ({ ...team })),
    holidaySources: initialPlannerState.holidaySources.map((source) => ({ ...source })),
    projects: initialPlannerState.projects.map((project) => ({ ...project })),
    dependencies: initialPlannerState.dependencies.map((dependency) => ({ ...dependency })),
    customClosures: initialPlannerState.customClosures.map((closure) => ({ ...closure })),
    closures: initialPlannerState.closures.map((closure) => ({ ...closure })),
  };
}
