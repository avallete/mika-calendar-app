import { addDays, format, parseISO, startOfWeek } from "date-fns";

import {
  addWorkingLag,
  advanceWorkingDuration,
  compareSlotKeys,
  getWorkingCalendarIndex,
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
import { materializePlannerState } from "@/lib/planner/closure-materialization";
import {
  collectTimelineRelevantDates,
  getTodayDateString,
} from "@/lib/planner/timeline-range";
import { measurePlannerPerformance } from "@/lib/planner/drag-performance";
import {
  getPlannerComputedSnapshot,
  registerPlannerComputedSnapshot,
  type ProjectScheduleSpan,
} from "@/lib/planner/planner-computed";
import { recordPlannerPerfProbeCount } from "@/lib/planner/planner-perf";
import {
  addPlannerTraceContextFields,
  normalizePlannerTraceSource,
  type PlannerTraceContext,
  type PlannerTraceLike,
} from "@/lib/planner/planner-trace";

type ScheduledComputation = ReturnType<typeof advanceWorkingDuration>;

type SchedulerTrace = {
  id: number;
  action: string;
  traceContext?: PlannerTraceLike;
};

type RescheduleOptions = {
  trace?: SchedulerTrace | null;
  action?: string;
  metadata?: Record<string, unknown>;
  summaryOnly?: boolean;
  traceContext?: PlannerTraceLike;
};

type ScheduledProjectLike = Project & {
  scheduledTeam: TeamId;
  scheduledStartSlot: SlotKey;
  scheduledDurationHalfDays: number;
  sequenceOrder: number;
};

type PlacementUpdateResult = {
  nextState: PlannerState;
  changedProjectIds: string[];
  changedSectionIds: string[];
  projectSpanById: Map<string, ProjectScheduleSpan>;
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
  metadata?: Record<string, unknown>,
  traceContext?: PlannerTraceLike
): SchedulerTrace | null {
  if (
    (!schedulerTraceEnabled && !traceContext) ||
    typeof console === "undefined"
  ) {
    return null;
  }

  const trace = {
    id: (schedulerTraceSequence += 1),
    action,
    traceContext,
  };

  const traceFields = addPlannerTraceContextFields(traceContext);
  const traceIdSuffix =
    typeof traceFields.traceId === "string"
      ? ` traceId=${traceFields.traceId}`
      : "";
  console.groupCollapsed(`[planner trace #${trace.id}] ${action}${traceIdSuffix}`);
  const traceMeta = addPlannerTraceContextFields(traceContext, metadata ?? {});
  if (Object.keys(traceMeta).length) {
    console.log(`meta ${stringifyTracePayload(traceMeta)}`);
  }

  return trace;
}

function traceLog(trace: SchedulerTrace | null, label: string, payload: unknown) {
  if (!trace || typeof console === "undefined") {
    return;
  }

  console.log(`${label} ${stringifyTracePayload(payload)}`);
}

function measureSchedulerStage<T>(
  trace: SchedulerTrace | null,
  label: string,
  fn: () => T,
  payload?: Record<string, unknown>
) {
  if (!trace) {
    return fn();
  }

  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  try {
    return fn();
  } finally {
    const finishedAt =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    traceLog(trace, `${label}.duration`, {
      ...addPlannerTraceContextFields(trace.traceContext, payload),
      durationMs: Number((finishedAt - startedAt).toFixed(2)),
    });
  }
}

function finishSchedulerTrace(trace: SchedulerTrace | null) {
  if (!trace || typeof console === "undefined") {
    return;
  }

  console.groupEnd();
}

function shouldLogVerboseSchedulerTrace(summaryOnly: boolean) {
  return schedulerTraceEnabled && !summaryOnly;
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

function normalizedRequestsLabel(requestCount: number) {
  return requestCount === 1
    ? "updateProjectPlacement"
    : "updateProjectPlacements";
}

function buildPlacementTraceLabel(
  requestCount: number,
  normalizedSource: string,
  traceContext?: PlannerTraceLike
) {
  const traceFields = addPlannerTraceContextFields(traceContext);
  if (normalizedSource === "preview" || traceFields.phase === "preview") {
    return "updateProjectPlacement.preview";
  }

  if (traceFields.runtime === "browser" && traceFields.phase === "optimistic") {
    return `${normalizedRequestsLabel(requestCount)}.optimistic-client`;
  }

  if (
    traceFields.runtime === "server" &&
    (traceFields.phase === "server-action" ||
      traceFields.phase === "store" ||
      traceFields.phase === "persistence")
  ) {
    return `${normalizedRequestsLabel(requestCount)}.server-commit`;
  }

  return normalizedRequestsLabel(requestCount);
}

function buildDependencyAdjacency(dependencies: ProjectDependency[]) {
  const incomingBySuccessorId = new Map<string, ProjectDependency[]>();
  const successorIdsByProjectId = new Map<string, string[]>();

  for (const dependency of dependencies) {
    const incoming = incomingBySuccessorId.get(dependency.successorProjectId) ?? [];
    incoming.push(dependency);
    incomingBySuccessorId.set(dependency.successorProjectId, incoming);

    const successors = successorIdsByProjectId.get(dependency.predecessorProjectId) ?? [];
    successors.push(dependency.successorProjectId);
    successorIdsByProjectId.set(dependency.predecessorProjectId, successors);
  }

  return {
    incomingBySuccessorId,
    successorIdsByProjectId,
  };
}

function seedMinSequenceOrder(
  seeds: Map<TeamId, number>,
  teamId: TeamId,
  sequenceOrder: number
) {
  const previous = seeds.get(teamId);
  if (previous === undefined || sequenceOrder < previous) {
    seeds.set(teamId, sequenceOrder);
  }
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
  incomingBySuccessorId: Map<string, ProjectDependency[]>,
  computations: Map<string, ScheduledComputation>,
  closures: ClosurePeriod[]
) {
  const incoming = incomingBySuccessorId.get(projectId) ?? [];

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

function listChangedSectionIds(
  previousProjectSpanById: ReadonlyMap<string, ProjectScheduleSpan>,
  nextProjectSpanById: ReadonlyMap<string, ProjectScheduleSpan>,
  changedProjectIds: string[],
) {
  const sectionIds = new Set<string>();

  for (const projectId of changedProjectIds) {
    const previous = previousProjectSpanById.get(projectId);
    if (previous) {
      for (const sectionId of previous.sectionIds) {
        sectionIds.add(sectionId);
      }
    }

    const next = nextProjectSpanById.get(projectId);
    if (next) {
      for (const sectionId of next.sectionIds) {
        sectionIds.add(sectionId);
      }
    }
  }

  return [...sectionIds].sort();
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

function buildPlacementIncrementalScope(args: {
  previousState: PlannerState;
  nextProjects: Project[];
  dependencies: ProjectDependency[];
  movedProjectIds: string[];
}) {
  const previousProjectsById = new Map(
    args.previousState.projects.map((project) => [project.id, project] as const)
  );
  const nextProjectsById = new Map(
    args.nextProjects.map((project) => [project.id, project] as const)
  );
  const nextScheduledProjectsByTeam = new Map<TeamId, ScheduledProjectLike[]>();
  const teamSequenceSeeds = new Map<TeamId, number>();
  const affectedProjectIds = new Set<string>(args.movedProjectIds);
  const { successorIdsByProjectId } = buildDependencyAdjacency(args.dependencies);

  for (const teamProject of args.nextProjects.filter(isScheduledProject)) {
    const teamProjects = nextScheduledProjectsByTeam.get(teamProject.scheduledTeam) ?? [];
    teamProjects.push(teamProject);
    nextScheduledProjectsByTeam.set(teamProject.scheduledTeam, teamProjects);
  }

  for (const teamProjects of nextScheduledProjectsByTeam.values()) {
    teamProjects.sort(compareScheduledProjectsByPlacement);
  }

  for (const movedProjectId of args.movedProjectIds) {
    const previousProject = previousProjectsById.get(movedProjectId);
    if (previousProject && isScheduledProject(previousProject)) {
      seedMinSequenceOrder(
        teamSequenceSeeds,
        previousProject.scheduledTeam,
        previousProject.sequenceOrder
      );
    }

    const nextProject = nextProjectsById.get(movedProjectId);
    if (nextProject && isScheduledProject(nextProject)) {
      seedMinSequenceOrder(
        teamSequenceSeeds,
        nextProject.scheduledTeam,
        nextProject.sequenceOrder
      );
    }
  }

  let expanded = true;
  while (expanded) {
    expanded = false;

    for (const [teamId, minSequenceOrder] of teamSequenceSeeds) {
      for (const project of nextScheduledProjectsByTeam.get(teamId) ?? []) {
        if (project.sequenceOrder < minSequenceOrder || affectedProjectIds.has(project.id)) {
          continue;
        }

        affectedProjectIds.add(project.id);
        expanded = true;
      }
    }

    for (const projectId of [...affectedProjectIds]) {
      for (const successorProjectId of successorIdsByProjectId.get(projectId) ?? []) {
        const successorProject = nextProjectsById.get(successorProjectId);
        if (!successorProject || !isScheduledProject(successorProject)) {
          continue;
        }

        if (!affectedProjectIds.has(successorProjectId)) {
          affectedProjectIds.add(successorProjectId);
          expanded = true;
        }

        const previousSeed = teamSequenceSeeds.get(successorProject.scheduledTeam);
        if (
          previousSeed === undefined ||
          successorProject.sequenceOrder < previousSeed
        ) {
          teamSequenceSeeds.set(
            successorProject.scheduledTeam,
            successorProject.sequenceOrder
          );
          expanded = true;
        }
      }
    }
  }

  return {
    affectedProjectIds,
    teamSequenceSeeds,
  };
}

function seedUnaffectedProjectComputations(args: {
  projects: Project[];
  affectedProjectIds: ReadonlySet<string>;
  previousProjectSpanById: ReadonlyMap<string, ProjectScheduleSpan>;
}) {
  const computations = new Map<string, ScheduledComputation>();

  for (const project of args.projects) {
    if (!isScheduledProject(project) || args.affectedProjectIds.has(project.id)) {
      continue;
    }

    const previousSpan = args.previousProjectSpanById.get(project.id);
    if (!previousSpan) {
      recordPlannerPerfProbeCount("seededUnaffectedProjectCount");
      continue;
    }

    computations.set(project.id, previousSpan);
    recordPlannerPerfProbeCount("reusedSpanCount");
  }

  return computations;
}

function buildProjectSpanByIdFromComputations(
  projects: Project[],
  computations: ReadonlyMap<string, ScheduledComputation>
) {
  const projectSpanById = new Map<string, ProjectScheduleSpan>();

  for (const project of projects) {
    if (!isScheduledProject(project)) {
      continue;
    }

    const computation = computations.get(project.id);
    if (!computation) {
      continue;
    }

    projectSpanById.set(project.id, computation);
  }

  return projectSpanById;
}

function reschedulePlacementProjectsIncremental(args: {
  previousState: PlannerState;
  nextState: PlannerState;
  trace: SchedulerTrace | null;
  summaryOnly: boolean;
  movedProjectIds: string[];
}): PlacementUpdateResult {
  const verboseTrace = shouldLogVerboseSchedulerTrace(args.summaryOnly);
  const previousComputed = getPlannerComputedSnapshot(args.previousState);
  const previousProjects = args.previousState.projects.map((project) => ({ ...project }));
  const nextProjects = measureSchedulerStage(
    args.trace,
    "reschedule.normalizeSequenceOrders",
    () =>
      normalizeSequenceOrders(
        args.nextState.projects.map((project) => ({ ...project })),
        args.nextState.dependencies,
        args.nextState.teams,
        verboseTrace ? args.trace : null
      ),
    {
      teamCount: args.nextState.teams.length,
      projectCount: args.nextState.projects.length,
    }
  );
  const { incomingBySuccessorId } = buildDependencyAdjacency(args.nextState.dependencies);
  const { affectedProjectIds, teamSequenceSeeds } = measureSchedulerStage(
    args.trace,
    "reschedule.incremental.scope",
    () =>
      buildPlacementIncrementalScope({
        previousState: args.previousState,
        nextProjects,
        dependencies: args.nextState.dependencies,
        movedProjectIds: args.movedProjectIds,
      }),
    {
      movedProjectCount: args.movedProjectIds.length,
      scheduledProjectCount: nextProjects.filter(isScheduledProject).length,
    }
  );
  const computations = measureSchedulerStage(
    args.trace,
    "reschedule.incremental.seedComputations",
    () =>
      seedUnaffectedProjectComputations({
        projects: nextProjects,
        affectedProjectIds,
        previousProjectSpanById: previousComputed.projectSpanById,
      }),
    {
      unaffectedScheduledProjectCount: nextProjects.filter(
        (project) => isScheduledProject(project) && !affectedProjectIds.has(project.id)
      ).length,
      affectedScheduledProjectCount: nextProjects.filter(
        (project) => isScheduledProject(project) && affectedProjectIds.has(project.id)
      ).length,
    }
  );
  let iterationCount = 0;

  if (verboseTrace) {
    traceLog(args.trace, "queues.before", summarizeTeamQueues(previousProjects, args.nextState.teams));
  }

  const { stabilized } = measureSchedulerStage(
    args.trace,
    "reschedule.mainLoop",
    () => {
      let stabilized = false;

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
        iterationCount = iteration + 1;
        let changed = false;

        for (const team of getSortedTeams(args.nextState.teams)) {
          if (!teamSequenceSeeds.has(team.id)) {
            continue;
          }

          const teamProjects = sortScheduledProjects(nextProjects, team.id);
          let previousReadySlot: SlotKey | null = null;

          for (const project of teamProjects) {
            const previousComputation = computations.get(project.id);

            if (!affectedProjectIds.has(project.id)) {
              previousReadySlot = previousComputation?.readySlot ?? previousReadySlot;
              continue;
            }

            const dependencyReady = getPredecessorReadySlot(
              project.id,
              incomingBySuccessorId,
              computations,
              args.nextState.closures
            );
            const requestedStart = [
              project.scheduledStartSlot,
              previousReadySlot,
              dependencyReady,
            ]
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
              args.nextState.closures
            );

            computations.set(project.id, computed);
            if (verboseTrace) {
              traceLog(args.trace, `iteration.${iteration + 1}.${project.id}`, {
                teamId: team.id,
                previousReadySlot,
                dependencyReady,
                requestedStart,
                computedStartSlot: computed.startSlot,
                calendarEndSlot: computed.calendarEndSlot,
                readySlot: computed.readySlot,
                skippedDates: computed.skippedDates,
              });
            }

            if (
              !previousComputation ||
              previousComputation.startSlot !== computed.startSlot ||
              previousComputation.calendarEndSlot !== computed.calendarEndSlot ||
              previousComputation.readySlot !== computed.readySlot ||
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

      return { stabilized };
    },
    {
      teamCount: args.nextState.teams.length,
      scheduledProjectCount: args.nextState.projects.filter(isScheduledProject).length,
      dependencyCount: args.nextState.dependencies.length,
      closureCount: args.nextState.closures.length,
      affectedProjectCount: affectedProjectIds.size,
      touchedTeamCount: teamSequenceSeeds.size,
    }
  );

  if (!stabilized && verboseTrace) {
    traceLog(args.trace, "reschedule.unstable", {
      maxIterations: MAX_ITERATIONS,
      queues: summarizeTeamQueues(nextProjects, args.nextState.teams),
    });
  }

  const materializedNextState = measureSchedulerStage(
    args.trace,
    "reschedule.materialize.output",
    () =>
      materializePlannerState({
        ...args.nextState,
        projects: nextProjects,
      }),
    {
      projectCount: nextProjects.length,
      closureCount: args.nextState.closures.length,
    }
  );
  const nextProjectSpanById = buildProjectSpanByIdFromComputations(
    nextProjects,
    computations
  );
  const changes = measureSchedulerStage(
    args.trace,
    "reschedule.changedProjectDiff",
    () => listScheduledChanges(previousProjects, nextProjects),
    {
      previousProjectCount: previousProjects.length,
      nextProjectCount: nextProjects.length,
    }
  );
  const changedProjectIds = changes.map((change) => change.id);
  recordPlannerPerfProbeCount("changedProjectCount", changedProjectIds.length);
  const changedSectionIds = measureSchedulerStage(
    args.trace,
    "placement.changedSectionIds",
    () =>
      listChangedSectionIds(
        previousComputed.projectSpanById,
        nextProjectSpanById,
        changedProjectIds
      ),
    {
      changedProjectCount: changedProjectIds.length,
    }
  );
  recordPlannerPerfProbeCount("changedSectionCount", changedSectionIds.length);

  registerPlannerComputedSnapshot(materializedNextState, {
    snapshot: materializedNextState,
    calendarIndex: getWorkingCalendarIndex(materializedNextState.closures),
    projectSpanById: nextProjectSpanById,
  });

  traceLog(args.trace, "summary", {
    iterationCount,
    changedProjectCount: changes.length,
    teamCount: args.nextState.teams.length,
    scheduledProjectCount: args.nextState.projects.filter(isScheduledProject).length,
    dependencyCount: args.nextState.dependencies.length,
    closureCount: args.nextState.closures.length,
    affectedProjectCount: affectedProjectIds.size,
    touchedTeamCount: teamSequenceSeeds.size,
  });

  if (verboseTrace) {
    traceLog(args.trace, "queues.after", summarizeTeamQueues(nextProjects, args.nextState.teams));
    traceLog(args.trace, "changes", changes);
  }

  return {
    nextState: materializedNextState,
    changedProjectIds,
    changedSectionIds,
    projectSpanById: nextProjectSpanById,
  };
}

export function getTouchingProjectChain(state: PlannerState, projectId: string) {
  const preparedState = materializePlannerState(state);
  const project = preparedState.projects.find((candidate) => candidate.id === projectId);
  if (!project || !isScheduledProject(project)) {
    return [];
  }

  const teamProjects = preparedState.projects
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
      preparedState.closures
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
      preparedState.closures
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
  const anticipatedState = materializePlannerState({
    ...state,
    projects: applyPlacementRequests(state.projects, placementRequests),
  });
  const normalizedRequests = placementRequests.map((request) =>
    normalizePlacementRequest(request, anticipatedState.closures)
  );
  const movedProjectIds = new Set(normalizedRequests.map((request) => request.projectId));
  const nextProjects = applyPlacementRequests(anticipatedState.projects, normalizedRequests);
  const nextProjectsById = new Map(nextProjects.map((project) => [project.id, project] as const));

  const conflicts: DependencyConflict[] = [];

  for (const dependency of anticipatedState.dependencies) {
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
        anticipatedState.closures
      ).readySlot,
      dependency.lagHalfDays,
      anticipatedState.closures
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
  recordPlannerPerfProbeCount("fullRescheduleCallCount");
  const summaryOnly = options?.summaryOnly ?? false;
  const verboseTrace = shouldLogVerboseSchedulerTrace(summaryOnly);
  const trace =
    options?.trace ??
    startSchedulerTrace(
      options?.action ?? "rescheduleProjects",
      options?.metadata,
      options?.traceContext
    );
  const ownsTrace = !options?.trace;
  const preparedState = measureSchedulerStage(
    trace,
    "reschedule.materialize.input",
    () => materializePlannerState(state),
    addPlannerTraceContextFields(options?.traceContext, {
      source:
        typeof addPlannerTraceContextFields(options?.traceContext).traceSource ===
        "string"
          ? addPlannerTraceContextFields(options?.traceContext).traceSource
          : null,
    })
  );
  const previousProjects = preparedState.projects.map((project) => ({ ...project }));
  const nextProjects = measureSchedulerStage(
    trace,
    "reschedule.normalizeSequenceOrders",
    () =>
      normalizeSequenceOrders(
        preparedState.projects.map((project) => ({
          ...project,
        })),
        preparedState.dependencies,
        preparedState.teams,
        verboseTrace ? trace : null
      ),
    {
      teamCount: preparedState.teams.length,
      projectCount: preparedState.projects.length,
    }
  );
  const { incomingBySuccessorId } = buildDependencyAdjacency(preparedState.dependencies);
  const computations = new Map<string, ScheduledComputation>();
  let iterationCount = 0;

  if (verboseTrace) {
    traceLog(trace, "queues.before", summarizeTeamQueues(previousProjects, preparedState.teams));
  }

  const { stabilized } = measureSchedulerStage(
    trace,
    "reschedule.mainLoop",
    () => {
      let stabilized = false;
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
        iterationCount = iteration + 1;
        let changed = false;

        for (const team of getSortedTeams(preparedState.teams)) {
          const teamProjects = sortScheduledProjects(nextProjects, team.id);
          let previousReadySlot: SlotKey | null = null;

          for (const project of teamProjects) {
            const dependencyReady = getPredecessorReadySlot(
              project.id,
              incomingBySuccessorId,
              computations,
              preparedState.closures
            );

            const requestedStart = [
              project.scheduledStartSlot,
              previousReadySlot,
              dependencyReady,
            ]
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
              preparedState.closures
            );
            const previous = computations.get(project.id);

            computations.set(project.id, computed);
            if (verboseTrace) {
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
            }

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

      return { stabilized };
    },
    {
      teamCount: preparedState.teams.length,
      scheduledProjectCount: preparedState.projects.filter(isScheduledProject).length,
      dependencyCount: preparedState.dependencies.length,
      closureCount: preparedState.closures.length,
    }
  );

  if (!stabilized && verboseTrace) {
    traceLog(trace, "reschedule.unstable", {
      maxIterations: MAX_ITERATIONS,
      queues: summarizeTeamQueues(nextProjects, preparedState.teams),
    });
  }

  const nextState = measureSchedulerStage(
    trace,
    "reschedule.materialize.output",
    () =>
      materializePlannerState({
        ...preparedState,
        projects: nextProjects,
      }),
    {
      projectCount: nextProjects.length,
      closureCount: preparedState.closures.length,
    }
  );
  const changes = measureSchedulerStage(
    trace,
    "reschedule.changedProjectDiff",
    () => listScheduledChanges(previousProjects, nextProjects),
    {
      previousProjectCount: previousProjects.length,
      nextProjectCount: nextProjects.length,
    }
  );

  traceLog(trace, "summary", {
    iterationCount,
    changedProjectCount: changes.length,
    teamCount: preparedState.teams.length,
    scheduledProjectCount: preparedState.projects.filter(isScheduledProject).length,
    dependencyCount: preparedState.dependencies.length,
    closureCount: preparedState.closures.length,
  });

  if (verboseTrace) {
    traceLog(trace, "queues.after", summarizeTeamQueues(nextProjects, preparedState.teams));
    traceLog(trace, "changes", changes);
  }

  if (ownsTrace) {
    finishSchedulerTrace(trace);
  }

  registerPlannerComputedSnapshot(nextState, {
    snapshot: nextState,
    calendarIndex: getWorkingCalendarIndex(nextState.closures),
    projectSpanById: buildProjectSpanByIdFromComputations(nextProjects, computations),
  });

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
  const preparedState = materializePlannerState(state);
  const normalizedPlacement = normalizePlacement(placement, preparedState.closures);
  const project = preparedState.projects.find((candidate) => candidate.id === projectId);

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
  const overlappingProject = preparedState.projects
    .filter(isScheduledProject)
    .filter(
      (candidate) => candidate.id !== projectId && candidate.scheduledTeam === project.scheduledTeam
    )
    .find((candidate) => {
      const computed = advanceWorkingDuration(
        candidate.scheduledStartSlot,
        candidate.scheduledDurationHalfDays,
        preparedState.closures
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
  options?: ProjectPlacementOptions,
  traceContext?: PlannerTraceContext | null
): PlannerState {
  return updateProjectPlacementsWithResult(
    state,
    placementRequests,
    options,
    traceContext
  ).nextState;
}

export function previewProjectPlacements(
  state: PlannerState,
  placementRequests: ProjectPlacementRequest[],
  options?: Omit<ProjectPlacementOptions, "source">,
  traceContext?: PlannerTraceContext | null
) {
  return updateProjectPlacementsWithResult(state, placementRequests, {
    ...options,
    source: "preview",
  }, traceContext);
}

function updateProjectPlacementsWithResult(
  state: PlannerState,
  placementRequests: ProjectPlacementRequest[],
  options?: ProjectPlacementOptions,
  traceContext?: PlannerTraceContext | null
): PlacementUpdateResult {
  const strategy = options?.strategy ?? "preserve";
  const dependencyResolution =
    options?.dependencyResolution ?? "preserve-dependencies";
  const summaryOnly = options?.source === "preview";
  const normalizedSource = normalizePlannerTraceSource(options?.source ?? "unknown");
  const trace = startSchedulerTrace(
    buildPlacementTraceLabel(
      placementRequests.length,
      normalizedSource,
      traceContext
    ),
    addPlannerTraceContextFields(traceContext, {
      source: normalizedSource,
      strategy,
      dependencyResolution,
      selectionSize: placementRequests.length,
      placementCount: placementRequests.length,
      ...(summaryOnly ? {} : options?.traceMetadata),
    }),
    traceContext
  );
  const anticipatedState = measureSchedulerStage(
    trace,
    "placement.materializeAnticipatedState",
    () =>
      materializePlannerState({
        ...state,
        projects: applyPlacementRequests(state.projects, placementRequests),
      }),
    {
      source: normalizedSource,
      placementCount: placementRequests.length,
    }
  );
  const normalizedRequests = measureSchedulerStage(
    trace,
    "placement.normalizeRequests",
    () =>
      placementRequests.map((request) =>
        normalizePlacementRequest(request, anticipatedState.closures)
      ),
    {
      placementCount: placementRequests.length,
    }
  );
  const nextDependencies =
    dependencyResolution === "break-conflicting-links"
      ? measureSchedulerStage(
          trace,
          "placement.resolveDependencies",
          () => removeDependencies(state.dependencies, options?.removeDependencyIds),
          {
            brokenDependencyCount: options?.removeDependencyIds?.length ?? 0,
          }
        )
      : anticipatedState.dependencies;
  const traceMetadata = summaryOnly
    ? {
        projectIds: normalizedRequests.map((request) => request.projectId),
        source: normalizedSource,
        strategy,
        dependencyResolution,
        selectionSize: normalizedRequests.length,
        placementCount: normalizedRequests.length,
      }
    : {
        projectIds: normalizedRequests.map((request) => request.projectId),
        source: normalizedSource,
        strategy,
        dependencyResolution,
        rawPlacements: placementRequests,
        normalizedPlacements: normalizedRequests,
        brokenDependencyIds: options?.removeDependencyIds ?? [],
        ...options?.traceMetadata,
      };
  traceLog(trace, "placement.summary", traceMetadata);

  const insertedProjects = measureSchedulerStage(
    trace,
    "placement.applyRequests",
    () => applyPlacementRequests(anticipatedState.projects, normalizedRequests),
    {
      placementCount: normalizedRequests.length,
    }
  );
  const nextProjects = measureSchedulerStage(
    trace,
    strategy === "compact-same-team" && normalizedRequests.length === 1
      ? "placement.compaction"
      : "placement.sequencePrepare",
    () =>
      strategy === "compact-same-team" && normalizedRequests.length === 1
        ? compactLaterSameTeamProjects(
            insertedProjects,
            normalizedRequests[0].projectId,
            normalizedRequests[0].placement.startSlot
          )
        : insertedProjects,
    {
      strategy,
      projectId: normalizedRequests[0]?.projectId ?? null,
    }
  );

  if (strategy === "compact-same-team" && normalizedRequests.length === 1) {
    traceLog(trace, "compaction.anchor", {
      projectId: normalizedRequests[0].projectId,
      anchorStartSlot: normalizedRequests[0].placement.startSlot,
    });
  }

  if (options?.removeDependencyIds?.length) {
    traceLog(trace, "dependencies.broken", options.removeDependencyIds);
  }

  const placementState = {
    ...anticipatedState,
    dependencies: nextDependencies,
    projects: nextProjects,
  };
  const result = summaryOnly
    ? measurePlannerPerformance(
        "drag.preview.exact.scheduler",
        () =>
          reschedulePlacementProjectsIncremental({
            previousState: state,
            nextState: placementState,
            trace,
            summaryOnly,
            movedProjectIds: normalizedRequests.map((request) => request.projectId),
          }),
        {
          source: normalizedSource,
          strategy,
          dependencyResolution,
          selectionSize: normalizedRequests.length,
        }
      )
    : reschedulePlacementProjectsIncremental({
        previousState: state,
        nextState: placementState,
        trace,
        summaryOnly,
        movedProjectIds: normalizedRequests.map((request) => request.projectId),
      });
  finishSchedulerTrace(trace);
  return {
    nextState: result.nextState,
    changedProjectIds: result.changedProjectIds,
    changedSectionIds: result.changedSectionIds,
    projectSpanById: result.projectSpanById,
  };
}

export function updateProjectPlacement(
  state: PlannerState,
  projectId: string,
  placement: ProjectPlacement,
  options?: ProjectPlacementOptions,
  traceContext?: PlannerTraceContext | null
) {
  return updateProjectPlacements(
    state,
    [
      {
        projectId,
        placement,
      },
    ],
    options,
    traceContext
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
  mode: ProjectDeleteMode = "preserve-dates",
  traceContext?: PlannerTraceContext | null
) {
  const trace = startSchedulerTrace("deleteProjectFromState", {
    projectId,
    mode,
    ...addPlannerTraceContextFields(traceContext),
  }, traceContext);
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
    const nextState = rescheduleProjects(baseState, { trace, traceContext });
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
      traceContext,
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
  const preparedState = materializePlannerState(state);
  const scheduled = preparedState.projects.find((project) => project.id === projectId);
  if (!scheduled || !isScheduledProject(scheduled)) {
    return null;
  }

  return advanceWorkingDuration(
    scheduled.scheduledStartSlot,
    scheduled.scheduledDurationHalfDays,
    preparedState.closures
  );
}

export function getDefaultPlacementSlot(projects: Project[]) {
  const window = buildTimelineWindow(projects, []);
  return makeSlotKey(window.startDate, "AM");
}
