import { buildSectionTeamProjectMap, type SectionTeamProjectMap } from "@/lib/planner/timeline-render";
import {
  getTimelineSectionIdsForScheduledProject,
  buildTimelinePreviewDeltaFromChangedProjectIds,
  buildTimelinePreviewDeltaFromPlacementRequests,
} from "@/lib/planner/timeline-preview";
import type {
  CalendarBucket,
  ClosurePeriod,
  Project,
  ProjectPlacementRequest,
  TeamId,
  TimelinePreviewDelta,
} from "@/lib/planner/types";
import { isScheduledProject } from "@/lib/planner/types";

export type PlannerDragPreviewMode = "idle" | "fast" | "exact-pending" | "exact-ready";

export type PlannerDragPreviewData = {
  signature: string;
  delta: TimelinePreviewDelta;
  projectsBySection: SectionTeamProjectMap;
  changedProjectIdSet: ReadonlySet<string>;
  touchedSectionIdSet: ReadonlySet<string>;
  touchedTeamIdSet: ReadonlySet<TeamId>;
  touchedRowKeySet: ReadonlySet<string>;
};

export type PlannerDragPreviewSnapshot = {
  activeDragId: string | null;
  signature: string | null;
  hoveredBucket: CalendarBucket | null;
  mode: PlannerDragPreviewMode;
  fastPreview: PlannerDragPreviewData | null;
  exactPreview: PlannerDragPreviewData | null;
};

export const EMPTY_PLANNER_DRAG_PREVIEW_SNAPSHOT: PlannerDragPreviewSnapshot = {
  activeDragId: null,
  signature: null,
  hoveredBucket: null,
  mode: "idle",
  fastPreview: null,
  exactPreview: null,
};

export function makePlannerDragPreviewRowKey(sectionId: string, teamId: TeamId) {
  return `${sectionId}::${teamId}`;
}

function buildTouchedRowKeySet(args: {
  currentProjects: Project[];
  delta: TimelinePreviewDelta;
  closures: ClosurePeriod[];
}) {
  const currentById = new Map(
    args.currentProjects
      .filter(isScheduledProject)
      .map((project) => [project.id, project] as const)
  );
  const previewById = new Map(args.delta.projects.map((project) => [project.id, project] as const));
  const rowKeys = new Set<string>();

  for (const projectId of args.delta.changedProjectIds) {
    const currentProject = currentById.get(projectId);
    if (currentProject) {
      for (const sectionId of getTimelineSectionIdsForScheduledProject(
        currentProject,
        args.closures
      )) {
        rowKeys.add(makePlannerDragPreviewRowKey(sectionId, currentProject.scheduledTeam));
      }
    }

    const previewProject = previewById.get(projectId);
    if (previewProject) {
      for (const sectionId of getTimelineSectionIdsForScheduledProject(
        previewProject,
        args.closures
      )) {
        rowKeys.add(makePlannerDragPreviewRowKey(sectionId, previewProject.scheduledTeam));
      }
    }
  }

  return rowKeys;
}

export function buildPlannerHoveredRowKey(hoveredBucket: CalendarBucket | null) {
  if (!hoveredBucket) {
    return null;
  }

  return makePlannerDragPreviewRowKey(
    hoveredBucket.startSlot.slice(0, 7),
    hoveredBucket.teamId
  );
}

export function buildPlannerDragPreviewData(args: {
  signature: string;
  currentProjects: Project[];
  delta: TimelinePreviewDelta;
  closures: ClosurePeriod[];
}): PlannerDragPreviewData {
  return {
    signature: args.signature,
    delta: args.delta,
    projectsBySection: buildSectionTeamProjectMap(args.delta.projects, args.closures),
    changedProjectIdSet: new Set(args.delta.changedProjectIds),
    touchedSectionIdSet: new Set(args.delta.touchedSectionIds),
    touchedTeamIdSet: new Set(args.delta.touchedTeamIds),
    touchedRowKeySet: buildTouchedRowKeySet({
      currentProjects: args.currentProjects,
      delta: args.delta,
      closures: args.closures,
    }),
  };
}

export function buildFastPlannerDragPreview(args: {
  signature: string;
  currentProjects: Project[];
  placementRequests: ProjectPlacementRequest[];
  closures: ClosurePeriod[];
  primaryProjectId: string | null;
}) {
  const delta = buildTimelinePreviewDeltaFromPlacementRequests({
    currentProjects: args.currentProjects,
    placementRequests: args.placementRequests,
    closures: args.closures,
    primaryProjectId: args.primaryProjectId,
  });

  return buildPlannerDragPreviewData({
    signature: args.signature,
    currentProjects: args.currentProjects,
    delta,
    closures: args.closures,
  });
}

export function buildExactPlannerDragPreview(args: {
  signature: string;
  currentProjects: Project[];
  previewProjects: Project[];
  changedProjectIds: string[];
  closures: ClosurePeriod[];
  primaryProjectId: string | null;
}) {
  const delta = buildTimelinePreviewDeltaFromChangedProjectIds({
    currentProjects: args.currentProjects,
    previewProjects: args.previewProjects,
    changedProjectIds: args.changedProjectIds,
    closures: args.closures,
    primaryProjectId: args.primaryProjectId,
  });

  return buildPlannerDragPreviewData({
    signature: args.signature,
    currentProjects: args.currentProjects,
    delta,
    closures: args.closures,
  });
}

export function getActivePlannerDragPreview(
  snapshot: PlannerDragPreviewSnapshot
) {
  return snapshot.exactPreview?.signature === snapshot.signature
    ? snapshot.exactPreview
    : snapshot.fastPreview;
}
