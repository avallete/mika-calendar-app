import { addDays, format, parseISO, startOfWeek } from "date-fns";

import {
  addWorkingLag,
  advanceWorkingDuration,
  compareSlotKeys,
  makeSlotKey,
  maxSlotKey,
  normalizeToWorkingSlot,
} from "@/lib/planner/calendar";
import {
  type ClosurePeriod,
  type EarlierShiftPromptState,
  type PlannerState,
  type Project,
  type ProjectDeleteMode,
  type ProjectDependency,
  type ProjectMetrics,
  type ProjectPlacement,
  type ProjectPlacementOptions,
  type ScheduledDragIntent,
  type SlotKey,
  type TeamId,
  isScheduledProject,
  teamOptions,
} from "@/lib/planner/types";

type ScheduledComputation = ReturnType<typeof advanceWorkingDuration>;

type SchedulerTrace = {
  id: number;
  action: string;
};

type RescheduleOptions = {
  trace?: SchedulerTrace | null;
  action?: string;
  metadata?: Record<string, unknown>;
};

const MAX_ITERATIONS = 12;

let schedulerTraceEnabled = false;
let schedulerTraceSequence = 0;

function stringifyTracePayload(payload: unknown) {
  try {
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    return JSON.stringify({
      serializationError: error instanceof Error ? error.message : String(error),
    });
  }
}

function startSchedulerTrace(
  action: string,
  metadata?: Record<string, unknown>
): SchedulerTrace | null {
  if (!schedulerTraceEnabled || typeof console === "undefined") {
    return null;
  }

  const trace = {
    id: (schedulerTraceSequence += 1),
    action,
  };

  console.groupCollapsed(`[planner trace #${trace.id}] ${action}`);
  if (metadata) {
    console.log(`meta ${stringifyTracePayload(metadata)}`);
  }

  return trace;
}

function traceLog(trace: SchedulerTrace | null, label: string, payload: unknown) {
  if (!trace || typeof console === "undefined") {
    return;
  }

  console.log(`${label} ${stringifyTracePayload(payload)}`);
}

function finishSchedulerTrace(trace: SchedulerTrace | null) {
  if (!trace || typeof console === "undefined") {
    return;
  }

  console.groupEnd();
}

function summarizeTeamQueues(projects: Project[]) {
  return Object.fromEntries(
    teamOptions.map((team) => [
      team.id,
      sortScheduledProjects(projects, team.id).map((project) => ({
        id: project.id,
        startSlot: project.scheduledStartSlot,
        durationHalfDays: project.scheduledDurationHalfDays,
        sequenceOrder: project.sequenceOrder,
      })),
    ])
  );
}

function listScheduledChanges(previousProjects: Project[], nextProjects: Project[]) {
  const changes: Array<{
    id: string;
    teamId: TeamId;
    previousStartSlot: SlotKey | null;
    nextStartSlot: SlotKey;
    previousDurationHalfDays: number | null;
    nextDurationHalfDays: number;
  }> = [];

  for (const project of nextProjects.filter(isScheduledProject)) {
    const previous = previousProjects.find((candidate) => candidate.id === project.id);
    if (!previous || !isScheduledProject(previous)) {
      changes.push({
        id: project.id,
        teamId: project.scheduledTeam,
        previousStartSlot: null,
        nextStartSlot: project.scheduledStartSlot,
        previousDurationHalfDays: null,
        nextDurationHalfDays: project.scheduledDurationHalfDays,
      });
      continue;
    }

    if (
      previous.scheduledTeam === project.scheduledTeam &&
      previous.scheduledStartSlot === project.scheduledStartSlot &&
      previous.scheduledDurationHalfDays === project.scheduledDurationHalfDays &&
      previous.sequenceOrder === project.sequenceOrder
    ) {
      continue;
    }

    changes.push({
      id: project.id,
      teamId: project.scheduledTeam,
      previousStartSlot: previous.scheduledStartSlot,
      nextStartSlot: project.scheduledStartSlot,
      previousDurationHalfDays: previous.scheduledDurationHalfDays,
      nextDurationHalfDays: project.scheduledDurationHalfDays,
    });
  }

  return changes;
}

function sortScheduledProjects(projects: Project[], teamId: TeamId) {
  return projects
    .filter(isScheduledProject)
    .filter((project) => project.scheduledTeam === teamId)
    .sort((left, right) => {
      if (left.sequenceOrder === right.sequenceOrder) {
        return compareSlotKeys(left.scheduledStartSlot, right.scheduledStartSlot);
      }

      return left.sequenceOrder - right.sequenceOrder;
    });
}

function getPredecessorReadySlot(
  projectId: string,
  dependencies: ProjectDependency[],
  computations: Map<string, ScheduledComputation>,
  closures: ClosurePeriod[]
) {
  const incoming = dependencies.filter((dependency) => dependency.successorProjectId === projectId);

  if (!incoming.length) {
    return null;
  }

  const slots = incoming
    .map((dependency) => {
      const predecessor = computations.get(dependency.predecessorProjectId);
      if (!predecessor) {
        return null;
      }

      return addWorkingLag(predecessor.readySlot, dependency.lagHalfDays, closures);
    })
    .filter(Boolean) as SlotKey[];

  if (!slots.length) {
    return null;
  }

  return maxSlotKey(...slots);
}

function overlapExists(
  leftStart: SlotKey,
  leftEndExclusive: SlotKey,
  rightStart: SlotKey,
  rightEndExclusive: SlotKey
) {
  return (
    compareSlotKeys(leftStart, rightEndExclusive) < 0 &&
    compareSlotKeys(rightStart, leftEndExclusive) < 0
  );
}

function normalizePlacement(
  placement: ProjectPlacement,
  closures: ClosurePeriod[]
): ProjectPlacement {
  return {
    ...placement,
    startSlot: normalizeToWorkingSlot(placement.startSlot, closures),
    durationHalfDays: Math.max(1, placement.durationHalfDays),
  };
}

function compactLaterSameTeamProjects(
  projects: Project[],
  projectId: string,
  anchorStartSlot: SlotKey
) {
  const nextProjects = projects.map((project) => ({ ...project }));
  const movedProject = nextProjects.find((project) => project.id === projectId);
  if (!movedProject || !isScheduledProject(movedProject)) {
    return nextProjects;
  }

  return nextProjects.map((project) => {
    if (
      !isScheduledProject(project) ||
      project.id === movedProject.id ||
      project.scheduledTeam !== movedProject.scheduledTeam ||
      project.sequenceOrder <= movedProject.sequenceOrder
    ) {
      return project;
    }

    return {
      ...project,
      scheduledStartSlot: anchorStartSlot,
    };
  });
}

function collectTransitiveSuccessors(
  dependencies: ProjectDependency[],
  seedIds: Iterable<string>
) {
  const adjacency = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const successors = adjacency.get(dependency.predecessorProjectId) ?? [];
    successors.push(dependency.successorProjectId);
    adjacency.set(dependency.predecessorProjectId, successors);
  }

  const affected = new Set<string>();
  const queue = [...seedIds];

  while (queue.length) {
    const current = queue.shift()!;
    if (affected.has(current)) {
      continue;
    }

    affected.add(current);
    for (const next of adjacency.get(current) ?? []) {
      queue.push(next);
    }
  }

  return affected;
}

export function setSchedulerTraceEnabled(enabled: boolean) {
  schedulerTraceEnabled = enabled;
}

export function normalizeSequenceOrders(projects: Project[]) {
  const nextProjects = [...projects];

  for (const team of teamOptions) {
    const teamProjects = nextProjects
      .filter(isScheduledProject)
      .filter((project) => project.scheduledTeam === team.id)
      .sort((left, right) => {
        if (left.sequenceOrder === right.sequenceOrder) {
          return compareSlotKeys(left.scheduledStartSlot, right.scheduledStartSlot);
        }

        return left.sequenceOrder - right.sequenceOrder;
      });

    teamProjects.forEach((project, index) => {
      project.sequenceOrder = index;
    });
  }

  return nextProjects;
}

export function rescheduleProjects(
  state: PlannerState,
  options?: RescheduleOptions
): PlannerState {
  const trace =
    options?.trace ??
    startSchedulerTrace(options?.action ?? "rescheduleProjects", options?.metadata);
  const ownsTrace = !options?.trace;
  const previousProjects = state.projects.map((project) => ({ ...project }));
  const nextProjects = normalizeSequenceOrders(
    state.projects.map((project) => ({
      ...project,
    }))
  );
  const computations = new Map<string, ScheduledComputation>();

  traceLog(trace, "queues.before", summarizeTeamQueues(previousProjects));

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    let changed = false;

    for (const team of teamOptions) {
      const teamProjects = sortScheduledProjects(nextProjects, team.id);
      let previousReadySlot: SlotKey | null = null;

      for (const project of teamProjects) {
        const dependencyReady = getPredecessorReadySlot(
          project.id,
          state.dependencies,
          computations,
          state.closures
        );

        const requestedStart = [project.scheduledStartSlot, previousReadySlot, dependencyReady]
          .filter(Boolean)
          .reduce((latest, current) => {
            if (!latest) {
              return current as SlotKey;
            }
            return compareSlotKeys(latest, current as SlotKey) > 0
              ? latest
              : (current as SlotKey);
          }, project.scheduledStartSlot) as SlotKey;

        const computed = advanceWorkingDuration(
          requestedStart,
          project.scheduledDurationHalfDays,
          state.closures
        );
        const previous = computations.get(project.id);

        computations.set(project.id, computed);
        traceLog(trace, `iteration.${iteration + 1}.${project.id}`, {
          teamId: team.id,
          previousReadySlot,
          dependencyReady,
          requestedStart,
          computedStartSlot: computed.startSlot,
          calendarEndSlot: computed.calendarEndSlot,
          readySlot: computed.readySlot,
          skippedDates: computed.skippedDates,
        });

        if (
          !previous ||
          previous.startSlot !== computed.startSlot ||
          previous.calendarEndSlot !== computed.calendarEndSlot ||
          previous.readySlot !== computed.readySlot ||
          project.scheduledStartSlot !== computed.startSlot
        ) {
          changed = true;
          project.scheduledStartSlot = computed.startSlot;
        }

        previousReadySlot = computed.readySlot;
      }
    }

    if (!changed) {
      break;
    }
  }

  const nextState = {
    ...state,
    projects: nextProjects,
  };

  traceLog(trace, "queues.after", summarizeTeamQueues(nextProjects));
  traceLog(trace, "changes", listScheduledChanges(previousProjects, nextProjects));

  if (ownsTrace) {
    finishSchedulerTrace(trace);
  }

  return nextState;
}

export function insertProjectIntoSequence(
  projects: Project[],
  projectId: string,
  placement: ProjectPlacement
) {
  const nextProjects = projects.map((project) => ({ ...project }));
  const movingProject = nextProjects.find((project) => project.id === projectId);

  if (!movingProject) {
    return nextProjects;
  }

  const previousTeam = isScheduledProject(movingProject) ? movingProject.scheduledTeam : null;

  if (previousTeam) {
    nextProjects
      .filter(isScheduledProject)
      .filter((project) => project.scheduledTeam === previousTeam && project.id !== movingProject.id)
      .sort((left, right) => left.sequenceOrder - right.sequenceOrder)
      .forEach((project, index) => {
        project.sequenceOrder = index;
      });
  }

  const targetTeamProjects = nextProjects
    .filter(isScheduledProject)
    .filter((project) => project.scheduledTeam === placement.teamId && project.id !== movingProject.id)
    .sort((left, right) => compareSlotKeys(left.scheduledStartSlot, right.scheduledStartSlot));

  const insertIndex = targetTeamProjects.findIndex(
    (candidate) => compareSlotKeys(placement.startSlot, candidate.scheduledStartSlot) < 0
  );
  const normalizedIndex = insertIndex === -1 ? targetTeamProjects.length : insertIndex;

  targetTeamProjects.splice(normalizedIndex, 0, {
    ...movingProject,
    status: "scheduled",
    scheduledTeam: placement.teamId,
    scheduledStartSlot: placement.startSlot,
    scheduledDurationHalfDays: placement.durationHalfDays,
    sequenceOrder: normalizedIndex,
  });

  for (const [index, project] of targetTeamProjects.entries()) {
    const target = nextProjects.find((candidate) => candidate.id === project.id);
    if (!target) {
      continue;
    }

    target.status = "scheduled";
    target.scheduledTeam = placement.teamId;
    target.scheduledStartSlot = project.scheduledStartSlot;
    target.scheduledDurationHalfDays = project.scheduledDurationHalfDays;
    target.sequenceOrder = index;
  }

  return nextProjects;
}

export function getEarlierShiftPrompt(
  state: PlannerState,
  projectId: string,
  placement: ProjectPlacement,
  interaction: Extract<ScheduledDragIntent, "move" | "resize-start">
): EarlierShiftPromptState | null {
  const normalizedPlacement = normalizePlacement(placement, state.closures);
  const project = state.projects.find((candidate) => candidate.id === projectId);

  if (!project || !isScheduledProject(project)) {
    return null;
  }

  if (project.scheduledTeam !== normalizedPlacement.teamId) {
    return null;
  }

  if (compareSlotKeys(normalizedPlacement.startSlot, project.scheduledStartSlot) >= 0) {
    return null;
  }

  const gapStart = normalizedPlacement.startSlot;
  const gapEnd = project.scheduledStartSlot;
  const overlappingProject = state.projects
    .filter(isScheduledProject)
    .filter(
      (candidate) => candidate.id !== projectId && candidate.scheduledTeam === project.scheduledTeam
    )
    .find((candidate) => {
      const computed = advanceWorkingDuration(
        candidate.scheduledStartSlot,
        candidate.scheduledDurationHalfDays,
        state.closures
      );

      return overlapExists(
        candidate.scheduledStartSlot,
        computed.calendarEndSlot,
        gapStart,
        gapEnd
      );
    });

  if (overlappingProject) {
    return null;
  }

  return {
    projectId,
    title: project.title,
    interaction,
    previousStartSlot: project.scheduledStartSlot,
    placement: normalizedPlacement,
  };
}

export function updateProjectPlacement(
  state: PlannerState,
  projectId: string,
  placement: ProjectPlacement,
  options?: ProjectPlacementOptions
) {
  const normalizedPlacement = normalizePlacement(placement, state.closures);
  const strategy = options?.strategy ?? "preserve";
  const trace = startSchedulerTrace("updateProjectPlacement", {
    projectId,
    source: options?.source ?? "unknown",
    strategy,
    rawPlacement: placement,
    normalizedPlacement,
  });

  traceLog(trace, "queues.before", summarizeTeamQueues(state.projects));

  const insertedProjects = insertProjectIntoSequence(state.projects, projectId, normalizedPlacement);
  const nextProjects =
    strategy === "compact-same-team"
      ? compactLaterSameTeamProjects(insertedProjects, projectId, normalizedPlacement.startSlot)
      : insertedProjects;

  if (strategy === "compact-same-team") {
    traceLog(trace, "compaction.anchor", {
      projectId,
      anchorStartSlot: normalizedPlacement.startSlot,
    });
  }

  const nextState = rescheduleProjects(
    {
      ...state,
      projects: nextProjects,
    },
    {
      trace,
    }
  );

  finishSchedulerTrace(trace);
  return nextState;
}

export function buildPlannerMetrics(state: PlannerState): ProjectMetrics {
  const scheduledCount = state.projects.filter((project) => project.status === "scheduled").length;
  const draftCount = state.projects.filter((project) => project.status === "draft").length;
  const blockedProjectIds = new Set(state.dependencies.map((dependency) => dependency.successorProjectId));

  return {
    scheduledCount,
    draftCount,
    blockedCount: state.projects.filter((project) => blockedProjectIds.has(project.id)).length,
    closureCount: state.closures.length,
  };
}

export function deleteProjectFromState(
  state: PlannerState,
  projectId: string,
  mode: ProjectDeleteMode = "preserve-dates"
) {
  const trace = startSchedulerTrace("deleteProjectFromState", {
    projectId,
    mode,
  });
  const projectToDelete = state.projects.find((project) => project.id === projectId);
  if (!projectToDelete) {
    finishSchedulerTrace(trace);
    return state;
  }

  const nextDependencies = state.dependencies.filter(
    (dependency) =>
      dependency.predecessorProjectId !== projectId &&
      dependency.successorProjectId !== projectId
  );
  const nextProjects = state.projects
    .filter((project) => project.id !== projectId)
    .map((project) => ({ ...project }));
  const baseState = {
    ...state,
    projects: nextProjects,
    dependencies: nextDependencies,
  };

  traceLog(trace, "deleted.project", {
    id: projectToDelete.id,
    status: projectToDelete.status,
  });

  if (!isScheduledProject(projectToDelete) || mode === "preserve-dates") {
    const nextState = rescheduleProjects(baseState, { trace });
    finishSchedulerTrace(trace);
    return nextState;
  }

  const laterSameTeamIds = state.projects
    .filter(isScheduledProject)
    .filter(
      (project) =>
        project.scheduledTeam === projectToDelete.scheduledTeam &&
        project.sequenceOrder > projectToDelete.sequenceOrder
    )
    .map((project) => project.id);
  const deletedProjectSuccessors = state.dependencies
    .filter((dependency) => dependency.predecessorProjectId === projectId)
    .map((dependency) => dependency.successorProjectId);
  const affectedIds = collectTransitiveSuccessors(state.dependencies, [
    ...laterSameTeamIds,
    ...deletedProjectSuccessors,
  ]);

  traceLog(trace, "compaction.affectedProjectIds", [...affectedIds]);

  const compactedProjects = nextProjects.map((project) => {
    if (!isScheduledProject(project) || !affectedIds.has(project.id)) {
      return project;
    }

    return {
      ...project,
      scheduledStartSlot: projectToDelete.scheduledStartSlot,
    };
  });

  const nextState = rescheduleProjects(
    {
      ...baseState,
      projects: compactedProjects,
    },
    {
      trace,
    }
  );

  finishSchedulerTrace(trace);
  return nextState;
}

export function buildTimelineWindow(projects: Project[], closures: ClosurePeriod[]) {
  const datedValues = [
    ...projects.flatMap((project) => {
      const values: string[] = [];
      if (project.targetDateHint) {
        values.push(project.targetDateHint);
      }
      if (isScheduledProject(project)) {
        values.push(project.scheduledStartSlot.slice(0, 10));
      }
      return values;
    }),
    ...closures.flatMap((closure) => [closure.startDate, closure.endDate]),
  ].filter(Boolean);

  const today = "2026-03-23";
  const anchor = datedValues.length ? datedValues.sort()[0] : today;
  const latest = datedValues.length ? datedValues.sort().at(-1)! : today;
  const startDate = format(
    addDays(startOfWeek(parseISO(anchor), { weekStartsOn: 1 }), -7),
    "yyyy-MM-dd"
  );
  const endDate = format(addDays(parseISO(latest), 180), "yyyy-MM-dd");

  return {
    startDate,
    endDate,
  };
}

export function wouldCreateDependencyCycle(
  dependencies: ProjectDependency[],
  predecessorProjectId: string,
  successorProjectId: string
) {
  if (predecessorProjectId === successorProjectId) {
    return true;
  }

  const adjacency = new Map<string, string[]>();

  for (const dependency of dependencies) {
    const edges = adjacency.get(dependency.predecessorProjectId) ?? [];
    edges.push(dependency.successorProjectId);
    adjacency.set(dependency.predecessorProjectId, edges);
  }

  const extra = adjacency.get(predecessorProjectId) ?? [];
  extra.push(successorProjectId);
  adjacency.set(predecessorProjectId, extra);

  const seen = new Set<string>();
  const stack = [successorProjectId];

  while (stack.length) {
    const current = stack.pop()!;
    if (current === predecessorProjectId) {
      return true;
    }

    if (seen.has(current)) {
      continue;
    }

    seen.add(current);
    for (const next of adjacency.get(current) ?? []) {
      stack.push(next);
    }
  }

  return false;
}

export function findScheduledComputation(
  state: PlannerState,
  projectId: string
): ScheduledComputation | null {
  const scheduled = state.projects.find((project) => project.id === projectId);
  if (!scheduled || !isScheduledProject(scheduled)) {
    return null;
  }

  return advanceWorkingDuration(
    scheduled.scheduledStartSlot,
    scheduled.scheduledDurationHalfDays,
    state.closures
  );
}

export function getDefaultPlacementSlot(projects: Project[]) {
  const window = buildTimelineWindow(projects, []);
  return makeSlotKey(window.startDate, "AM");
}
