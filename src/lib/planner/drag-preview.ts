import {
  buildSectionTeamProjectMap,
  type SectionTeamProjectMap,
} from "@/lib/planner/timeline-render";
import { buildProjectSpanByIdFromProjects, type ProjectScheduleSpan } from "@/lib/planner/planner-computed";
import {
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

export type PlannerDragPreviewMode = "idle" | "fast" | "exact-pending" | "exact-ready";

export type PlannerDragPreviewData = {
  signature: string;
  delta: TimelinePreviewDelta;
  projectsBySection: SectionTeamProjectMap;
  projectSpanById: ReadonlyMap<string, ProjectScheduleSpan>;
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
  currentProjectSpanById: ReadonlyMap<string, ProjectScheduleSpan>;
  delta: TimelinePreviewDelta;
  previewProjectSpanById: ReadonlyMap<string, ProjectScheduleSpan>;
}) {
  const currentById = new Map(
    args.currentProjects.map((project) => [project.id, project] as const)
  );
  const previewById = new Map(args.delta.projects.map((project) => [project.id, project] as const));
  const rowKeys = new Set<string>();

  for (const projectId of args.delta.changedProjectIds) {
    const currentProject = currentById.get(projectId);
    const currentSpan = args.currentProjectSpanById.get(projectId);
    if (currentProject?.scheduledTeam && currentSpan) {
      for (const sectionId of currentSpan.sectionIds) {
        rowKeys.add(makePlannerDragPreviewRowKey(sectionId, currentProject.scheduledTeam));
      }
    }

    const previewProject = previewById.get(projectId);
    const previewSpan = args.previewProjectSpanById.get(projectId);
    if (previewProject && previewSpan) {
      for (const sectionId of previewSpan.sectionIds) {
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
  currentProjectSpanById: ReadonlyMap<string, ProjectScheduleSpan>;
  delta: TimelinePreviewDelta;
  previewProjectSpanById: ReadonlyMap<string, ProjectScheduleSpan>;
}): PlannerDragPreviewData {
  return {
    signature: args.signature,
    delta: args.delta,
    projectsBySection: buildSectionTeamProjectMap(
      args.delta.projects,
      args.previewProjectSpanById
    ),
    projectSpanById: args.previewProjectSpanById,
    changedProjectIdSet: new Set(args.delta.changedProjectIds),
    touchedSectionIdSet: new Set(args.delta.touchedSectionIds),
    touchedTeamIdSet: new Set(args.delta.touchedTeamIds),
    touchedRowKeySet: buildTouchedRowKeySet({
      currentProjects: args.currentProjects,
      currentProjectSpanById: args.currentProjectSpanById,
      delta: args.delta,
      previewProjectSpanById: args.previewProjectSpanById,
    }),
  };
}

export function buildFastPlannerDragPreview(args: {
  signature: string;
  currentProjects: Project[];
  currentProjectSpanById: ReadonlyMap<string, ProjectScheduleSpan>;
  placementRequests: ProjectPlacementRequest[];
  closures: ClosurePeriod[];
  primaryProjectId: string | null;
}) {
  const delta = buildTimelinePreviewDeltaFromPlacementRequests({
    currentProjects: args.currentProjects,
    placementRequests: args.placementRequests,
    closures: args.closures,
    primaryProjectId: args.primaryProjectId,
    currentProjectSpanById: args.currentProjectSpanById,
  });
  const previewProjectSpanById = buildProjectSpanByIdFromProjects({
    snapshot: {
      teams: [],
      holidaySources: [],
      projects: args.currentProjects,
      dependencies: [],
      customClosures: [],
      closures: args.closures,
      history: {
        canUndo: false,
        canRedo: false,
      },
    },
    projects: delta.projects,
  });

  return buildPlannerDragPreviewData({
    signature: args.signature,
    currentProjects: args.currentProjects,
    currentProjectSpanById: args.currentProjectSpanById,
    delta,
    previewProjectSpanById,
  });
}

export function buildExactPlannerDragPreview(args: {
  signature: string;
  currentProjects: Project[];
  currentProjectSpanById: ReadonlyMap<string, ProjectScheduleSpan>;
  previewProjects: Project[];
  previewProjectSpanById: ReadonlyMap<string, ProjectScheduleSpan>;
  changedProjectIds: string[];
  changedSectionIds: string[];
  closures: ClosurePeriod[];
  primaryProjectId: string | null;
}) {
  const delta = buildTimelinePreviewDeltaFromChangedProjectIds({
    currentProjects: args.currentProjects,
    previewProjects: args.previewProjects,
    changedProjectIds: args.changedProjectIds,
    closures: args.closures,
    primaryProjectId: args.primaryProjectId,
    currentProjectSpanById: args.currentProjectSpanById,
    previewProjectSpanById: args.previewProjectSpanById,
    changedSectionIds: args.changedSectionIds,
  });

  return buildPlannerDragPreviewData({
    signature: args.signature,
    currentProjects: args.currentProjects,
    currentProjectSpanById: args.currentProjectSpanById,
    delta,
    previewProjectSpanById: args.previewProjectSpanById,
  });
}

export function getActivePlannerDragPreview(
  snapshot: PlannerDragPreviewSnapshot
) {
  return snapshot.exactPreview?.signature === snapshot.signature
    ? snapshot.exactPreview
    : snapshot.fastPreview;
}
