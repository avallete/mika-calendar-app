import { advanceWorkingDuration } from "@/lib/planner/calendar";
import { buildProjectSpanByIdFromProjects, type ProjectScheduleSpan } from "@/lib/planner/planner-computed";
import type {
  ClosurePeriod,
  Project,
  ProjectPlacementRequest,
  ScheduledTimelineProject,
  TimelinePreviewDelta,
} from "@/lib/planner/types";
import { isScheduledProject } from "@/lib/planner/types";

function getSectionIdsForProject(args: {
  project: ScheduledTimelineProject;
  closures: ClosurePeriod[];
  projectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null;
}) {
  return (
    args.projectSpanById?.get(args.project.id)?.sectionIds ??
    advanceWorkingDuration(
      args.project.scheduledStartSlot,
      args.project.scheduledDurationHalfDays,
      args.closures
    ).sectionIds
  );
}

export function getTimelineSectionIdsForScheduledProject(
  project: ScheduledTimelineProject,
  closures: ClosurePeriod[],
  projectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null
) {
  return getSectionIdsForProject({
    project,
    closures,
    projectSpanById,
  });
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
  currentProjectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null;
  previewProjectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null;
  changedSectionIds?: string[] | null;
}): TimelinePreviewDelta {
  const {
    currentProjects,
    previewProjects,
    changedProjectIds,
    closures,
    primaryProjectId,
    currentProjectSpanById,
    previewProjectSpanById,
    changedSectionIds,
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
  const touchedSectionIds = new Set<string>(changedSectionIds ?? []);

  for (const project of changedProjects) {
    touchedTeamIds.add(project.scheduledTeam);
    getSectionIdsForProject({
      project,
      closures,
      projectSpanById: previewProjectSpanById,
    }).forEach((sectionId) => touchedSectionIds.add(sectionId));

    const currentProject = currentById.get(project.id);
    if (currentProject) {
      touchedTeamIds.add(currentProject.scheduledTeam);
      getSectionIdsForProject({
        project: currentProject,
        closures,
        projectSpanById: currentProjectSpanById,
      }).forEach((sectionId) => touchedSectionIds.add(sectionId));
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
  currentProjectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null;
  previewProjectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null;
  changedSectionIds?: string[] | null;
}) {
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
  currentProjectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null;
  previewProjectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null;
  changedSectionIds?: string[] | null;
}) {
  return buildTimelinePreviewDeltaFromScheduledProjects({
    currentProjects: args.currentProjects,
    previewProjects: args.previewProjects.filter(isScheduledProject),
    changedProjectIds: args.changedProjectIds,
    closures: args.closures,
    primaryProjectId: args.primaryProjectId,
    currentProjectSpanById: args.currentProjectSpanById,
    previewProjectSpanById: args.previewProjectSpanById,
    changedSectionIds: args.changedSectionIds,
  });
}

export function buildTimelinePreviewDeltaFromPlacementRequests(args: {
  currentProjects: Project[];
  placementRequests: ProjectPlacementRequest[];
  closures: ClosurePeriod[];
  primaryProjectId: string | null;
  currentProjectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null;
  previewProjectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null;
}) {
  const {
    currentProjects,
    placementRequests,
    closures,
    primaryProjectId,
    currentProjectSpanById,
  } = args;
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

  const previewProjectSpanById =
    args.previewProjectSpanById ??
    buildProjectSpanByIdFromProjects({
      snapshot: {
        teams: [],
        holidaySources: [],
        projects: currentProjects,
        dependencies: [],
        customClosures: [],
        closures,
        history: {
          canUndo: false,
          canRedo: false,
        },
      },
      projects: previewProjects,
    });

  return buildTimelinePreviewDeltaFromScheduledProjects({
    currentProjects,
    previewProjects,
    changedProjectIds,
    closures,
    primaryProjectId,
    currentProjectSpanById,
    previewProjectSpanById,
  });
}
