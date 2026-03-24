import { advanceWorkingDuration, parseSlotKey, previousCalendarSlot } from "@/lib/planner/calendar";
import { getTimelineMonthId } from "@/lib/planner/timeline-folding";
import type {
  ClosurePeriod,
  Project,
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

export function buildTimelinePreviewDelta(args: {
  currentProjects: Project[];
  previewProjects: Project[];
  closures: ClosurePeriod[];
  primaryProjectId: string | null;
}): TimelinePreviewDelta {
  const { currentProjects, previewProjects, closures, primaryProjectId } = args;
  const currentById = new Map(
    currentProjects.filter(isScheduledProject).map((project) => [project.id, project] as const)
  );

  const changedProjects = previewProjects
    .filter(isScheduledProject)
    .filter((project) => didScheduledProjectChange(currentById.get(project.id), project));
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
