import { addDays, format, parseISO, startOfWeek } from "date-fns";

import {
  addWorkingLag,
  advanceWorkingDuration,
  compareSlotKeys,
  makeSlotKey,
  maxSlotKey,
} from "@/lib/planner/calendar";
import {
  type ClosurePeriod,
  type PlannerState,
  type Project,
  type ProjectDependency,
  type ProjectDeleteMode,
  type ProjectPlacement,
  type ProjectMetrics,
  type SlotKey,
  type TeamId,
  isScheduledProject,
  teamOptions,
} from "@/lib/planner/types";

type ScheduledComputation = {
  startSlot: SlotKey;
  calendarEndSlot: SlotKey;
  readySlot: SlotKey;
};

const MAX_ITERATIONS = 12;

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

export function rescheduleProjects(state: PlannerState): PlannerState {
  const nextProjects = normalizeSequenceOrders(
    state.projects.map((project) => ({
      ...project,
    }))
  );
  const computations = new Map<string, ScheduledComputation>();

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

  return {
    ...state,
    projects: nextProjects,
  };
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

export function updateProjectPlacement(
  state: PlannerState,
  projectId: string,
  placement: ProjectPlacement
) {
  return rescheduleProjects({
    ...state,
    projects: insertProjectIntoSequence(state.projects, projectId, placement),
  });
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

export function deleteProjectFromState(
  state: PlannerState,
  projectId: string,
  mode: ProjectDeleteMode = "preserve-dates"
) {
  const projectToDelete = state.projects.find((project) => project.id === projectId);
  if (!projectToDelete) {
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

  if (!isScheduledProject(projectToDelete) || mode === "preserve-dates") {
    return rescheduleProjects(baseState);
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

  const compactedProjects = nextProjects.map((project) => {
    if (!isScheduledProject(project) || !affectedIds.has(project.id)) {
      return project;
    }

    return {
      ...project,
      scheduledStartSlot: projectToDelete.scheduledStartSlot,
    };
  });

  return rescheduleProjects({
    ...baseState,
    projects: compactedProjects,
  });
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
