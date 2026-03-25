import { advanceWorkingDuration, parseSlotKey, previousCalendarSlot } from "@/lib/planner/calendar";
import { getTimelineMonthId } from "@/lib/planner/timeline-folding";
import type {
  ClosurePeriod,
  Project,
  ProjectPlacementRequest,
  ScheduledTimelineProject,
  TimelinePreviewDelta,
} from "@/lib/planner/types";
import { isScheduledProject } from "@/lib/planner/types";

function listMonthSectionIdsBetween(startDate: string, endDate: string) {
  const sectionIds: string[] = [];
  let cursor = startDate.slice(0, 7);
  const endSectionId = endDate.slice(0, 7);

  while (cursor <= endSectionId) {
    sectionIds.push(cursor);
    const [year, month] = cursor.split("-").map(Number);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    cursor = `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
  }

  return sectionIds;
}

export function getTimelineSectionIdsForScheduledProject(
  project: ScheduledTimelineProject,
  closures: ClosurePeriod[]
) {
  const computed = advanceWorkingDuration(
    project.scheduledStartSlot,
    project.scheduledDurationHalfDays,
    closures
  );
  const startDate = parseSlotKey(project.scheduledStartSlot).date;
  const endDate = parseSlotKey(previousCalendarSlot(computed.calendarEndSlot)).date;

  return listMonthSectionIdsBetween(getTimelineMonthId(startDate), getTimelineMonthId(endDate));
}

function didScheduledProjectChange(
  currentProject: ScheduledTimelineProject | undefined,
  previewProject: ScheduledTimelineProject
) {
  if (!currentProject) {
    return true;
  }

  return (
    currentProject.scheduledTeam !== previewProject.scheduledTeam ||
    currentProject.scheduledStartSlot !== previewProject.scheduledStartSlot ||
    currentProject.scheduledDurationHalfDays !== previewProject.scheduledDurationHalfDays ||
    currentProject.sequenceOrder !== previewProject.sequenceOrder
  );
}

function buildTimelinePreviewDeltaFromScheduledProjects(args: {
  currentProjects: Project[];
  previewProjects: ScheduledTimelineProject[];
  changedProjectIds?: string[] | null;
  closures: ClosurePeriod[];
  primaryProjectId: string | null;
}): TimelinePreviewDelta {
  const {
    currentProjects,
    previewProjects,
    changedProjectIds,
    closures,
    primaryProjectId,
  } = args;
  const currentById = new Map(
    currentProjects.filter(isScheduledProject).map((project) => [project.id, project] as const)
  );
  const previewById = new Map(previewProjects.map((project) => [project.id, project] as const));
  const changedProjects =
    changedProjectIds && changedProjectIds.length
      ? changedProjectIds
          .map((projectId) => previewById.get(projectId) ?? null)
          .filter(Boolean) as ScheduledTimelineProject[]
      : previewProjects.filter((project) =>
          didScheduledProjectChange(currentById.get(project.id), project)
        );
  const touchedTeamIds = new Set<string>();
  const touchedSectionIds = new Set<string>();

  for (const project of changedProjects) {
    touchedTeamIds.add(project.scheduledTeam);
    getTimelineSectionIdsForScheduledProject(project, closures).forEach((sectionId) =>
      touchedSectionIds.add(sectionId)
    );

    const currentProject = currentById.get(project.id);
    if (currentProject) {
      touchedTeamIds.add(currentProject.scheduledTeam);
      getTimelineSectionIdsForScheduledProject(currentProject, closures).forEach((sectionId) =>
        touchedSectionIds.add(sectionId)
      );
    }
  }

  return {
    projects: changedProjects,
    changedProjectIds: changedProjects.map((project) => project.id),
    primaryProjectId,
    touchedTeamIds: [...touchedTeamIds],
    touchedSectionIds: [...touchedSectionIds],
  };
}

export function buildTimelinePreviewDelta(args: {
  currentProjects: Project[];
  previewProjects: Project[];
  closures: ClosurePeriod[];
  primaryProjectId: string | null;
}): TimelinePreviewDelta {
  return buildTimelinePreviewDeltaFromScheduledProjects({
    ...args,
    previewProjects: args.previewProjects.filter(isScheduledProject),
  });
}

export function buildTimelinePreviewDeltaFromChangedProjectIds(args: {
  currentProjects: Project[];
  previewProjects: Project[];
  changedProjectIds: string[];
  closures: ClosurePeriod[];
  primaryProjectId: string | null;
}) {
  return buildTimelinePreviewDeltaFromScheduledProjects({
    currentProjects: args.currentProjects,
    previewProjects: args.previewProjects.filter(isScheduledProject),
    changedProjectIds: args.changedProjectIds,
    closures: args.closures,
    primaryProjectId: args.primaryProjectId,
  });
}

export function buildTimelinePreviewDeltaFromPlacementRequests(args: {
  currentProjects: Project[];
  placementRequests: ProjectPlacementRequest[];
  closures: ClosurePeriod[];
  primaryProjectId: string | null;
}) {
  const { currentProjects, placementRequests, closures, primaryProjectId } = args;
  const currentById = new Map(currentProjects.map((project) => [project.id, project] as const));
  const previewProjects: ScheduledTimelineProject[] = [];
  const changedProjectIds: string[] = [];

  for (const request of placementRequests) {
    const currentProject = currentById.get(request.projectId);
    if (!currentProject) {
      continue;
    }

    const previewProject = {
      ...currentProject,
      status: "scheduled" as const,
      scheduledTeam: request.placement.teamId,
      scheduledStartSlot: request.placement.startSlot,
      scheduledDurationHalfDays: request.placement.durationHalfDays,
      sequenceOrder:
        typeof currentProject.sequenceOrder === "number" ? currentProject.sequenceOrder : 0,
    } satisfies ScheduledTimelineProject;

    if (
      !isScheduledProject(currentProject) ||
      didScheduledProjectChange(currentProject, previewProject)
    ) {
      changedProjectIds.push(previewProject.id);
      previewProjects.push(previewProject);
    }
  }

  return buildTimelinePreviewDeltaFromScheduledProjects({
    currentProjects,
    previewProjects,
    changedProjectIds,
    closures,
    primaryProjectId,
  });
}
