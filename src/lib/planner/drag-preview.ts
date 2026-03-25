import { buildSectionTeamProjectMap, type SectionTeamProjectMap } from "@/lib/planner/timeline-render";
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
  changedProjectIdSet: ReadonlySet<string>;
  touchedSectionIdSet: ReadonlySet<string>;
  touchedTeamIdSet: ReadonlySet<TeamId>;
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

export function buildPlannerDragPreviewData(
  signature: string,
  delta: TimelinePreviewDelta,
  closures: ClosurePeriod[]
): PlannerDragPreviewData {
  return {
    signature,
    delta,
    projectsBySection: buildSectionTeamProjectMap(delta.projects, closures),
    changedProjectIdSet: new Set(delta.changedProjectIds),
    touchedSectionIdSet: new Set(delta.touchedSectionIds),
    touchedTeamIdSet: new Set(delta.touchedTeamIds),
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

  return buildPlannerDragPreviewData(args.signature, delta, args.closures);
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

  return buildPlannerDragPreviewData(args.signature, delta, args.closures);
}

export function getActivePlannerDragPreview(
  snapshot: PlannerDragPreviewSnapshot
) {
  return snapshot.exactPreview?.signature === snapshot.signature
    ? snapshot.exactPreview
    : snapshot.fastPreview;
}
