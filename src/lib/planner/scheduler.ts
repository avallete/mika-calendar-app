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
  type DependencyConflict,
  type EarlierShiftPromptState,
  type PlannerState,
  type Project,
  type ProjectDeleteMode,
  type ProjectDependency,
  type ProjectMetrics,
  type ProjectPlacement,
  type ProjectPlacementRequest,
  type ProjectPlacementOptions,
  type ScheduledDragIntent,
  type SlotKey,
  type Team,
  type TeamId,
  getSortedTeams,
  isScheduledProject,
} from "@/lib/planner/types";
import {
  collectTimelineRelevantDates,
  getTodayDateString,
} from "@/lib/planner/timeline-range";

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

type ScheduledProjectLike = Project & {
  scheduledTeam: TeamId;
  scheduledStartSlot: SlotKey;
  scheduledDurationHalfDays: number;
  sequenceOrder: number;
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

function summarizeTeamQueues(projects: Project[], teams: Team[]) {
  return Object.fromEntries(
    getSortedTeams(teams).map((team) => [
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

function summarizeDependencyEdgesForTeam(
  projects: Project[],
  dependencies: ProjectDependency[],
  teamId: TeamId
) {
  const scheduledById = new Map(
    projects
      .filter(isScheduledProject)
      .filter((project) => project.scheduledTeam === teamId)
      .map((project) => [project.id, project] as const)
  );

  return dependencies
    .filter(
      (dependency) =>
        scheduledById.has(dependency.predecessorProjectId) &&
        scheduledById.has(dependency.successorProjectId)
    )
    .map((dependency) => ({
      id: dependency.id,
      predecessorProjectId: dependency.predecessorProjectId,
      successorProjectId: dependency.successorProjectId,
      lagHalfDays: dependency.lagHalfDays,
    }));
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

function compareScheduledProjectsByPlacement(
  left: ScheduledProjectLike,
  right: ScheduledProjectLike
) {
  const startComparison = compareSlotKeys(left.scheduledStartSlot, right.scheduledStartSlot);
  if (startComparison !== 0) {
    return startComparison;
  }

  if (left.sequenceOrder !== right.sequenceOrder) {
    return left.sequenceOrder - right.sequenceOrder;
  }

  return left.id.localeCompare(right.id);
}

function buildDependencySafeTeamOrder(
  projects: Project[],
  dependencies: ProjectDependency[],
  teamId: TeamId
) {
  const teamProjects = projects
    .filter(isScheduledProject)
    .filter((project) => project.scheduledTeam === teamId)
    .sort(compareScheduledProjectsByPlacement);

  if (teamProjects.length < 2) {
    return {
      requestedOrder: teamProjects,
      enforcedOrder: teamProjects,
    };
  }

  const requestedOrder = [...teamProjects];
  const requestedIndex = new Map(requestedOrder.map((project, index) => [project.id, index]));
  const projectIds = new Set(requestedOrder.map((project) => project.id));
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const project of requestedOrder) {
    adjacency.set(project.id, []);
    indegree.set(project.id, 0);
  }

  for (const dependency of dependencies) {
    if (
      !projectIds.has(dependency.predecessorProjectId) ||
      !projectIds.has(dependency.successorProjectId)
    ) {
      continue;
    }

    adjacency.get(dependency.predecessorProjectId)?.push(dependency.successorProjectId);
    indegree.set(
      dependency.successorProjectId,
      (indegree.get(dependency.successorProjectId) ?? 0) + 1
    );
  }

  const available = requestedOrder
    .filter((project) => (indegree.get(project.id) ?? 0) === 0)
    .map((project) => project.id);
  const enforcedOrderIds: string[] = [];

  while (available.length) {
    available.sort(
      (left, right) => (requestedIndex.get(left) ?? 0) - (requestedIndex.get(right) ?? 0)
    );
    const nextId = available.shift()!;
    enforcedOrderIds.push(nextId);

    for (const successorId of adjacency.get(nextId) ?? []) {
      const nextIndegree = (indegree.get(successorId) ?? 0) - 1;
      indegree.set(successorId, nextIndegree);
      if (nextIndegree === 0) {
        available.push(successorId);
      }
    }
  }

  if (enforcedOrderIds.length !== requestedOrder.length) {
    return {
      requestedOrder,
      enforcedOrder: requestedOrder,
    };
  }

  const enforcedOrder = enforcedOrderIds
    .map((projectId) => requestedOrder.find((project) => project.id === projectId) ?? null)
    .filter(Boolean) as ScheduledProjectLike[];

  return {
    requestedOrder,
    enforcedOrder,
  };
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

function normalizePlacementRequest(
  request: ProjectPlacementRequest,
  closures: ClosurePeriod[]
): ProjectPlacementRequest {
  return {
    ...request,
    placement: normalizePlacement(request.placement, closures),
  };
}

function applyPlacementRequests(
  projects: Project[],
  placementRequests: ProjectPlacementRequest[]
) {
  const requestMap = new Map(placementRequests.map((request) => [request.projectId, request]));

  return projects.map((project) => {
    const request = requestMap.get(project.id);
    if (!request) {
      return { ...project };
    }

    return {
      ...project,
      status: "scheduled" as const,
      scheduledTeam: request.placement.teamId,
      scheduledStartSlot: request.placement.startSlot,
      scheduledDurationHalfDays: request.placement.durationHalfDays,
      sequenceOrder: typeof project.sequenceOrder === "number" ? project.sequenceOrder : 0,
    };
  });
}

function removeDependencies(
  dependencies: ProjectDependency[],
  dependencyIds: string[] | undefined
) {
  if (!dependencyIds?.length) {
    return dependencies;
  }

  const dependencyIdSet = new Set(dependencyIds);
  return dependencies.filter((dependency) => !dependencyIdSet.has(dependency.id));
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

export function getTouchingProjectChain(state: PlannerState, projectId: string) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  if (!project || !isScheduledProject(project)) {
    return [];
  }

  const teamProjects = state.projects
    .filter(isScheduledProject)
    .filter((candidate) => candidate.scheduledTeam === project.scheduledTeam)
    .sort(compareScheduledProjectsByPlacement);
  const currentIndex = teamProjects.findIndex((candidate) => candidate.id === projectId);

  if (currentIndex === -1) {
    return [];
  }

  let startIndex = currentIndex;
  let endIndex = currentIndex;

  while (startIndex > 0) {
    const previousProject = teamProjects[startIndex - 1];
    const currentProject = teamProjects[startIndex];
    const previousReadySlot = advanceWorkingDuration(
      previousProject.scheduledStartSlot,
      previousProject.scheduledDurationHalfDays,
      state.closures
    ).readySlot;

    if (compareSlotKeys(previousReadySlot, currentProject.scheduledStartSlot) !== 0) {
      break;
    }

    startIndex -= 1;
  }

  while (endIndex < teamProjects.length - 1) {
    const currentProject = teamProjects[endIndex];
    const nextProject = teamProjects[endIndex + 1];
    const currentReadySlot = advanceWorkingDuration(
      currentProject.scheduledStartSlot,
      currentProject.scheduledDurationHalfDays,
      state.closures
    ).readySlot;

    if (compareSlotKeys(currentReadySlot, nextProject.scheduledStartSlot) !== 0) {
      break;
    }

    endIndex += 1;
  }

  return teamProjects.slice(startIndex, endIndex + 1).map((candidate) => candidate.id);
}

export function detectDependencyConflicts(
  state: PlannerState,
  placementRequests: ProjectPlacementRequest[]
) {
  const normalizedRequests = placementRequests.map((request) =>
    normalizePlacementRequest(request, state.closures)
  );
  const movedProjectIds = new Set(normalizedRequests.map((request) => request.projectId));
  const nextProjects = applyPlacementRequests(state.projects, normalizedRequests);
  const nextProjectsById = new Map(nextProjects.map((project) => [project.id, project] as const));

  const conflicts: DependencyConflict[] = [];

  for (const dependency of state.dependencies) {
    const touchesMovedSelection =
      movedProjectIds.has(dependency.predecessorProjectId) ||
      movedProjectIds.has(dependency.successorProjectId);
    const entirelyInsideSelection =
      movedProjectIds.has(dependency.predecessorProjectId) &&
      movedProjectIds.has(dependency.successorProjectId);

    if (!touchesMovedSelection || entirelyInsideSelection) {
      continue;
    }

    const predecessor = nextProjectsById.get(dependency.predecessorProjectId);
    const successor = nextProjectsById.get(dependency.successorProjectId);
    if (!predecessor || !successor || !isScheduledProject(predecessor) || !isScheduledProject(successor)) {
      continue;
    }

    const predecessorReadySlot = addWorkingLag(
      advanceWorkingDuration(
        predecessor.scheduledStartSlot,
        predecessor.scheduledDurationHalfDays,
        state.closures
      ).readySlot,
      dependency.lagHalfDays,
      state.closures
    );

    if (compareSlotKeys(successor.scheduledStartSlot, predecessorReadySlot) >= 0) {
      continue;
    }

    conflicts.push({
      id: dependency.id,
      predecessorProjectId: dependency.predecessorProjectId,
      predecessorTitle: predecessor.title,
      successorProjectId: dependency.successorProjectId,
      successorTitle: successor.title,
      lagHalfDays: dependency.lagHalfDays,
    });
  }

  return conflicts;
}

export function setSchedulerTraceEnabled(enabled: boolean) {
  schedulerTraceEnabled = enabled;
}

export function normalizeSequenceOrders(
  projects: Project[],
  dependencies: ProjectDependency[],
  teams: Team[],
  trace?: SchedulerTrace | null
) {
  const nextProjects = [...projects];

  for (const team of getSortedTeams(teams)) {
    const { requestedOrder, enforcedOrder } = buildDependencySafeTeamOrder(
      nextProjects,
      dependencies,
      team.id
    );

    if (
      trace &&
      requestedOrder.map((project) => project.id).join("|") !==
        enforcedOrder.map((project) => project.id).join("|")
    ) {
      traceLog(trace, `sequence.enforced.${team.id}`, {
        requestedOrder: requestedOrder.map((project) => ({
          id: project.id,
          startSlot: project.scheduledStartSlot,
          sequenceOrder: project.sequenceOrder,
        })),
        enforcedOrder: enforcedOrder.map((project) => ({
          id: project.id,
          startSlot: project.scheduledStartSlot,
          sequenceOrder: project.sequenceOrder,
        })),
        dependencyEdges: summarizeDependencyEdgesForTeam(nextProjects, dependencies, team.id),
      });
    }

    enforcedOrder.forEach((project, index) => {
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
    })),
    state.dependencies,
    state.teams,
    trace
  );
  const computations = new Map<string, ScheduledComputation>();

  traceLog(trace, "queues.before", summarizeTeamQueues(previousProjects, state.teams));

  let stabilized = false;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    let changed = false;

    for (const team of getSortedTeams(state.teams)) {
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
      stabilized = true;
      break;
    }
  }

  if (!stabilized) {
    traceLog(trace, "reschedule.unstable", {
      maxIterations: MAX_ITERATIONS,
      queues: summarizeTeamQueues(nextProjects, state.teams),
    });
  }

  const nextState = {
    ...state,
    projects: nextProjects,
  };

  traceLog(trace, "queues.after", summarizeTeamQueues(nextProjects, state.teams));
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
  return applyPlacementRequests(projects, [
    {
      projectId,
      placement,
    },
  ]);
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

export function updateProjectPlacements(
  state: PlannerState,
  placementRequests: ProjectPlacementRequest[],
  options?: ProjectPlacementOptions
) {
  const normalizedRequests = placementRequests.map((request) =>
    normalizePlacementRequest(request, state.closures)
  );
  const strategy = options?.strategy ?? "preserve";
  const dependencyResolution =
    options?.dependencyResolution ?? "preserve-dependencies";
  const nextDependencies =
    dependencyResolution === "break-conflicting-links"
      ? removeDependencies(state.dependencies, options?.removeDependencyIds)
      : state.dependencies;
  const trace = startSchedulerTrace(
    normalizedRequests.length === 1 ? "updateProjectPlacement" : "updateProjectPlacements",
    {
      projectIds: normalizedRequests.map((request) => request.projectId),
      source: options?.source ?? "unknown",
      strategy,
      dependencyResolution,
      rawPlacements: placementRequests,
      normalizedPlacements: normalizedRequests,
      brokenDependencyIds: options?.removeDependencyIds ?? [],
      ...options?.traceMetadata,
    }
  );

  traceLog(trace, "queues.before", summarizeTeamQueues(state.projects, state.teams));

  const insertedProjects = applyPlacementRequests(state.projects, normalizedRequests);
  const nextProjects =
    strategy === "compact-same-team" && normalizedRequests.length === 1
      ? compactLaterSameTeamProjects(
          insertedProjects,
          normalizedRequests[0].projectId,
          normalizedRequests[0].placement.startSlot
        )
      : insertedProjects;

  if (strategy === "compact-same-team" && normalizedRequests.length === 1) {
    traceLog(trace, "compaction.anchor", {
      projectId: normalizedRequests[0].projectId,
      anchorStartSlot: normalizedRequests[0].placement.startSlot,
    });
  }

  if (options?.removeDependencyIds?.length) {
    traceLog(trace, "dependencies.broken", options.removeDependencyIds);
  }

  const nextState = rescheduleProjects(
    {
      ...state,
      dependencies: nextDependencies,
      projects: nextProjects,
    },
    {
      trace,
    }
  );

  finishSchedulerTrace(trace);
  return nextState;
}

export function updateProjectPlacement(
  state: PlannerState,
  projectId: string,
  placement: ProjectPlacement,
  options?: ProjectPlacementOptions
) {
  return updateProjectPlacements(
    state,
    [
      {
        projectId,
        placement,
      },
    ],
    options
  );
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
  const datedValues = collectTimelineRelevantDates(projects, closures).sort();
  const today = getTodayDateString();
  const anchor = datedValues[0] ?? today;
  const latest = datedValues.at(-1) ?? today;
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
