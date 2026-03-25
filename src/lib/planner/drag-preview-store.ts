"use client";

import { useSyncExternalStore } from "react";

import {
  EMPTY_PLANNER_DRAG_PREVIEW_SNAPSHOT,
  type PlannerDragPreviewData,
  type PlannerDragPreviewSnapshot,
} from "@/lib/planner/drag-preview";
import type { CalendarBucket } from "@/lib/planner/types";

type Listener = () => void;

let plannerDragPreviewSnapshot: PlannerDragPreviewSnapshot =
  EMPTY_PLANNER_DRAG_PREVIEW_SNAPSHOT;
const plannerDragPreviewListeners = new Set<Listener>();

function emitPlannerDragPreviewSnapshot() {
  for (const listener of plannerDragPreviewListeners) {
    listener();
  }
}

function setPlannerDragPreviewSnapshot(nextSnapshot: PlannerDragPreviewSnapshot) {
  plannerDragPreviewSnapshot = nextSnapshot;
  emitPlannerDragPreviewSnapshot();
}

export function getPlannerDragPreviewSnapshot() {
  return plannerDragPreviewSnapshot;
}

export function subscribePlannerDragPreview(listener: Listener) {
  plannerDragPreviewListeners.add(listener);

  return () => {
    plannerDragPreviewListeners.delete(listener);
  };
}

export function usePlannerDragPreviewSnapshot() {
  return useSyncExternalStore(
    subscribePlannerDragPreview,
    getPlannerDragPreviewSnapshot,
    getPlannerDragPreviewSnapshot
  );
}

export function startPlannerDragPreviewSession(activeDragId: string) {
  setPlannerDragPreviewSnapshot({
    activeDragId,
    signature: null,
    hoveredBucket: null,
    mode: "idle",
    fastPreview: null,
    exactPreview: null,
  });
}

export function resetPlannerDragPreviewSession() {
  setPlannerDragPreviewSnapshot(EMPTY_PLANNER_DRAG_PREVIEW_SNAPSHOT);
}

export function publishPlannerDragPreviewHover(
  activeDragId: string,
  hoveredBucket: CalendarBucket | null
) {
  const currentSnapshot = plannerDragPreviewSnapshot;
  if (currentSnapshot.activeDragId !== activeDragId) {
    return;
  }

  setPlannerDragPreviewSnapshot({
    ...currentSnapshot,
    hoveredBucket,
  });
}

export function clearPlannerActiveDragPreview(
  activeDragId: string,
  hoveredBucket: CalendarBucket | null
) {
  const currentSnapshot = plannerDragPreviewSnapshot;
  if (currentSnapshot.activeDragId !== activeDragId) {
    return;
  }

  setPlannerDragPreviewSnapshot({
    ...currentSnapshot,
    signature: null,
    hoveredBucket,
    mode: "idle",
    fastPreview: null,
    exactPreview: null,
  });
}

export function publishPlannerFastDragPreview(args: {
  activeDragId: string;
  hoveredBucket: CalendarBucket | null;
  signature: string;
  preview: PlannerDragPreviewData | null;
  exactPending: boolean;
}) {
  const currentSnapshot = plannerDragPreviewSnapshot;
  if (currentSnapshot.activeDragId !== args.activeDragId) {
    return;
  }

  const exactPreview =
    currentSnapshot.exactPreview?.signature === args.signature
      ? currentSnapshot.exactPreview
      : null;

  setPlannerDragPreviewSnapshot({
    activeDragId: args.activeDragId,
    signature: args.signature,
    hoveredBucket: args.hoveredBucket,
    mode: exactPreview ? "exact-ready" : args.exactPending ? "exact-pending" : "fast",
    fastPreview: args.preview,
    exactPreview,
  });
}

export function publishPlannerExactPreviewPending(
  activeDragId: string,
  signature: string
) {
  const currentSnapshot = plannerDragPreviewSnapshot;
  if (
    currentSnapshot.activeDragId !== activeDragId ||
    currentSnapshot.signature !== signature
  ) {
    return;
  }

  setPlannerDragPreviewSnapshot({
    ...currentSnapshot,
    mode: "exact-pending",
    exactPreview: null,
  });
}

export function publishPlannerExactDragPreview(args: {
  activeDragId: string;
  signature: string;
  preview: PlannerDragPreviewData | null;
}) {
  const currentSnapshot = plannerDragPreviewSnapshot;
  if (
    currentSnapshot.activeDragId !== args.activeDragId ||
    currentSnapshot.signature !== args.signature
  ) {
    return;
  }

  setPlannerDragPreviewSnapshot({
    ...currentSnapshot,
    mode: args.preview ? "exact-ready" : currentSnapshot.fastPreview ? "fast" : "idle",
    exactPreview: args.preview,
  });
}
