import {
  compareSlotKeys,
  countWorkingHalfDays,
  countWorkingSlotDistance,
  isNonWorkingDate,
  makeSlotKey,
  nextCalendarSlot,
  normalizeToWorkingSlot,
  parseSlotKey,
  shiftWorkingSlot,
} from "@/lib/planner/calendar";
import type {
  CalendarBucket,
  ClosurePeriod,
  DragProjectMeta,
  Project,
  ProjectPlacement,
  ProjectPlacementRequest,
  SlotKey,
} from "@/lib/planner/types";
import { isScheduledProject } from "@/lib/planner/types";

export function normalizePlacementRequest(
  request: ProjectPlacementRequest,
  closures: ClosurePeriod[]
): ProjectPlacementRequest {
  return {
    ...request,
    placement: {
      ...request.placement,
      startSlot: normalizeToWorkingSlot(request.placement.startSlot, closures),
      durationHalfDays: Math.max(1, request.placement.durationHalfDays),
    },
  };
}

function getLatestAllowedResizeStartSlot(
  calendarEndSlot: SlotKey,
  closures: ClosurePeriod[]
) {
  return shiftWorkingSlot(calendarEndSlot, -1, closures);
}

export function buildScheduledPlacement(
  active: Extract<DragProjectMeta, { type: "scheduled" }>,
  bucket: CalendarBucket,
  closures: ClosurePeriod[]
): ProjectPlacement | null {
  if (active.intent === "move") {
    return {
      teamId: bucket.teamId,
      startSlot: bucket.startSlot,
      durationHalfDays: active.durationHalfDays,
    };
  }

  if (bucket.teamId !== active.teamId) {
    return null;
  }

  if (active.intent === "resize-start") {
    const latestAllowedStart = getLatestAllowedResizeStartSlot(active.calendarEndSlot, closures);
    const requestedStart = normalizeToWorkingSlot(bucket.startSlot, closures);
    const startSlot =
      compareSlotKeys(requestedStart, latestAllowedStart) > 0
        ? latestAllowedStart
        : requestedStart;

    return {
      teamId: active.teamId,
      startSlot,
      durationHalfDays: Math.max(
        1,
        countWorkingHalfDays(startSlot, active.calendarEndSlot, closures)
      ),
    };
  }

  const { date } = parseSlotKey(bucket.startSlot);
  const endSlotExclusive = isNonWorkingDate(date, closures)
    ? nextCalendarSlot(shiftWorkingSlot(makeSlotKey(date, "AM"), -1, closures))
    : nextCalendarSlot(bucket.startSlot);

  return {
    teamId: active.teamId,
    startSlot: active.startSlot,
    durationHalfDays: Math.max(
      1,
      countWorkingHalfDays(active.startSlot, endSlotExclusive, closures)
    ),
  };
}

export function buildMovePlacementRequests(
  active: Extract<DragProjectMeta, { type: "scheduled" }>,
  bucket: CalendarBucket,
  projects: Project[],
  closures: ClosurePeriod[]
) {
  const selectionProjectIds =
    active.selectionProjectIds && active.selectionProjectIds.length
      ? active.selectionProjectIds
      : [active.projectId];

  if (selectionProjectIds.length > 1 && bucket.teamId !== active.teamId) {
    return null;
  }

  const rawRequests = selectionProjectIds
    .map((projectId) => {
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project || !isScheduledProject(project)) {
        return null;
      }

      const relativeOffset = countWorkingSlotDistance(
        active.startSlot,
        project.scheduledStartSlot,
        closures
      );

      return {
        projectId,
        placement: {
          teamId: bucket.teamId,
          startSlot: shiftWorkingSlot(bucket.startSlot, relativeOffset, closures),
          durationHalfDays: project.scheduledDurationHalfDays,
        },
      } satisfies ProjectPlacementRequest;
    })
    .filter(Boolean) as ProjectPlacementRequest[];

  const normalizedRequests = rawRequests.map((request) =>
    normalizePlacementRequest(request, closures)
  );

  return {
    projectIds: selectionProjectIds,
    rawRequests,
    normalizedRequests,
    snappedRequests: normalizedRequests,
    snapTarget: null,
  };
}

export function arePlacementRequestsNoop(
  projects: Project[],
  placementRequests: ProjectPlacementRequest[],
  closures: ClosurePeriod[]
) {
  const projectsById = new Map(projects.map((project) => [project.id, project] as const));

  return placementRequests.every((request) => {
    const current = projectsById.get(request.projectId);
    if (!current || !isScheduledProject(current)) {
      return false;
    }

    const normalized = normalizePlacementRequest(request, closures);
    return (
      current.scheduledTeam === normalized.placement.teamId &&
      current.scheduledStartSlot === normalized.placement.startSlot &&
      current.scheduledDurationHalfDays === normalized.placement.durationHalfDays
    );
  });
}
