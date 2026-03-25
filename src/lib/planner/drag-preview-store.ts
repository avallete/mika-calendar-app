"use client";

import { useSyncExternalStore } from "react";

import {
  buildPlannerHoveredRowKey,
  getActivePlannerDragPreview,
  makePlannerDragPreviewRowKey,
  EMPTY_PLANNER_DRAG_PREVIEW_SNAPSHOT,
  type PlannerDragPreviewData,
  type PlannerDragPreviewMode,
  type PlannerDragPreviewSnapshot,
} from "@/lib/planner/drag-preview";
import { incrementPlannerPerformanceCounter } from "@/lib/planner/drag-performance";
import type { CalendarBucket, TeamId } from "@/lib/planner/types";

type Listener = () => void;

export type PlannerRowDragPreviewSnapshot = {
  activeDragId: string | null;
  mode: PlannerDragPreviewMode;
  hoveredBucket: CalendarBucket | null;
  preview: PlannerDragPreviewData | null;
};

export type PlannerSectionDragPreviewSnapshot = {
  activeDragId: string | null;
  mode: PlannerDragPreviewMode;
  hoveredBucket: CalendarBucket | null;
  preview: PlannerDragPreviewData | null;
};

let plannerDragPreviewSnapshot: PlannerDragPreviewSnapshot =
  EMPTY_PLANNER_DRAG_PREVIEW_SNAPSHOT;
const plannerDragPreviewListeners = new Set<Listener>();
const plannerRowDragPreviewListeners = new Map<string, Set<Listener>>();
const plannerSectionDragPreviewListeners = new Map<string, Set<Listener>>();
const plannerRowSnapshotCache = new WeakMap<
  PlannerDragPreviewSnapshot,
  Map<string, PlannerRowDragPreviewSnapshot>
>();
const plannerSectionSnapshotCache = new WeakMap<
  PlannerDragPreviewSnapshot,
  Map<string, PlannerSectionDragPreviewSnapshot>
>();

function subscribeScopedListener(
  listenersByKey: Map<string, Set<Listener>>,
  key: string,
  listener: Listener
) {
  const scopedListeners = listenersByKey.get(key) ?? new Set<Listener>();
  scopedListeners.add(listener);
  listenersByKey.set(key, scopedListeners);

  return () => {
    const currentListeners = listenersByKey.get(key);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (!currentListeners.size) {
      listenersByKey.delete(key);
    }
  };
}

function areBucketsEqual(
  left: CalendarBucket | null,
  right: CalendarBucket | null
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.bucketId === right.bucketId &&
    left.teamId === right.teamId &&
    left.startSlot === right.startSlot &&
    left.granularity === right.granularity
  );
}

function getAffectedRowKeys(snapshot: PlannerDragPreviewSnapshot) {
  const rowKeys = new Set<string>();
  const activePreview = getActivePlannerDragPreview(snapshot);

  if (activePreview) {
    for (const rowKey of activePreview.touchedRowKeySet) {
      rowKeys.add(rowKey);
    }
  }

  const hoveredRowKey = buildPlannerHoveredRowKey(snapshot.hoveredBucket);
  if (hoveredRowKey) {
    rowKeys.add(hoveredRowKey);
  }

  return rowKeys;
}

function getAffectedSectionIds(snapshot: PlannerDragPreviewSnapshot) {
  const sectionIds = new Set<string>();
  const activePreview = getActivePlannerDragPreview(snapshot);

  if (activePreview) {
    for (const sectionId of activePreview.touchedSectionIdSet) {
      sectionIds.add(sectionId);
    }
  }

  const hoveredSectionId = snapshot.hoveredBucket?.startSlot.slice(0, 7) ?? null;
  if (hoveredSectionId) {
    sectionIds.add(hoveredSectionId);
  }

  return sectionIds;
}

function getPlannerRowDragPreviewSnapshotForSnapshot(
  snapshot: PlannerDragPreviewSnapshot,
  sectionId: string,
  teamId: TeamId
): PlannerRowDragPreviewSnapshot {
  const rowKey = makePlannerDragPreviewRowKey(sectionId, teamId);
  const cachedSnapshots = plannerRowSnapshotCache.get(snapshot);
  const cachedSnapshot = cachedSnapshots?.get(rowKey);
  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  const activePreview = getActivePlannerDragPreview(snapshot);
  const hoveredRowKey = buildPlannerHoveredRowKey(snapshot.hoveredBucket);
  const nextSnapshot = {
    activeDragId: snapshot.activeDragId,
    mode: snapshot.mode,
    hoveredBucket: hoveredRowKey === rowKey ? snapshot.hoveredBucket : null,
    preview: activePreview?.touchedRowKeySet.has(rowKey) ? activePreview : null,
  } satisfies PlannerRowDragPreviewSnapshot;

  const snapshotsByKey = cachedSnapshots ?? new Map<string, PlannerRowDragPreviewSnapshot>();
  snapshotsByKey.set(rowKey, nextSnapshot);
  if (!cachedSnapshots) {
    plannerRowSnapshotCache.set(snapshot, snapshotsByKey);
  }

  return nextSnapshot;
}

function getPlannerSectionDragPreviewSnapshotForSnapshot(
  snapshot: PlannerDragPreviewSnapshot,
  sectionId: string
): PlannerSectionDragPreviewSnapshot {
  const cachedSnapshots = plannerSectionSnapshotCache.get(snapshot);
  const cachedSnapshot = cachedSnapshots?.get(sectionId);
  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  const activePreview = getActivePlannerDragPreview(snapshot);
  const hoveredBucket =
    snapshot.hoveredBucket?.startSlot.slice(0, 7) === sectionId
      ? snapshot.hoveredBucket
      : null;

  const nextSnapshot = {
    activeDragId: snapshot.activeDragId,
    mode: snapshot.mode,
    hoveredBucket,
    preview: activePreview?.touchedSectionIdSet.has(sectionId) ? activePreview : null,
  } satisfies PlannerSectionDragPreviewSnapshot;

  const snapshotsByKey =
    cachedSnapshots ?? new Map<string, PlannerSectionDragPreviewSnapshot>();
  snapshotsByKey.set(sectionId, nextSnapshot);
  if (!cachedSnapshots) {
    plannerSectionSnapshotCache.set(snapshot, snapshotsByKey);
  }

  return nextSnapshot;
}

function areRowSnapshotsEqual(
  left: PlannerRowDragPreviewSnapshot,
  right: PlannerRowDragPreviewSnapshot
) {
  return (
    left.activeDragId === right.activeDragId &&
    left.mode === right.mode &&
    areBucketsEqual(left.hoveredBucket, right.hoveredBucket) &&
    left.preview === right.preview
  );
}

function areSectionSnapshotsEqual(
  left: PlannerSectionDragPreviewSnapshot,
  right: PlannerSectionDragPreviewSnapshot
) {
  return (
    left.activeDragId === right.activeDragId &&
    left.mode === right.mode &&
    areBucketsEqual(left.hoveredBucket, right.hoveredBucket) &&
    left.preview === right.preview
  );
}

function emitPlannerDragPreviewSnapshot(
  previousSnapshot: PlannerDragPreviewSnapshot,
  nextSnapshot: PlannerDragPreviewSnapshot
) {
  const listenersToNotify = new Set<Listener>();

  for (const listener of plannerDragPreviewListeners) {
    listenersToNotify.add(listener);
  }

  const rowKeys = new Set([
    ...getAffectedRowKeys(previousSnapshot),
    ...getAffectedRowKeys(nextSnapshot),
  ]);
  let changedRowCount = 0;
  for (const rowKey of rowKeys) {
    const [sectionId, teamId] = rowKey.split("::") as [string, TeamId];
    const previousRowSnapshot = getPlannerRowDragPreviewSnapshotForSnapshot(
      previousSnapshot,
      sectionId,
      teamId
    );
    const nextRowSnapshot = getPlannerRowDragPreviewSnapshotForSnapshot(
      nextSnapshot,
      sectionId,
      teamId
    );
    if (areRowSnapshotsEqual(previousRowSnapshot, nextRowSnapshot)) {
      continue;
    }

    changedRowCount += 1;
    for (const listener of plannerRowDragPreviewListeners.get(rowKey) ?? []) {
      listenersToNotify.add(listener);
    }
  }
  if (changedRowCount) {
    incrementPlannerPerformanceCounter("timeline.overlay.notifyRows", changedRowCount);
  }

  const sectionIds = new Set([
    ...getAffectedSectionIds(previousSnapshot),
    ...getAffectedSectionIds(nextSnapshot),
  ]);
  let changedSectionCount = 0;
  for (const sectionId of sectionIds) {
    const previousSectionSnapshot = getPlannerSectionDragPreviewSnapshotForSnapshot(
      previousSnapshot,
      sectionId
    );
    const nextSectionSnapshot = getPlannerSectionDragPreviewSnapshotForSnapshot(
      nextSnapshot,
      sectionId
    );
    if (areSectionSnapshotsEqual(previousSectionSnapshot, nextSectionSnapshot)) {
      continue;
    }

    changedSectionCount += 1;
    for (const listener of plannerSectionDragPreviewListeners.get(sectionId) ?? []) {
      listenersToNotify.add(listener);
    }
  }
  if (changedSectionCount) {
    incrementPlannerPerformanceCounter(
      "timeline.overlay.notifySections",
      changedSectionCount
    );
  }

  for (const listener of listenersToNotify) {
    listener();
  }
}

function setPlannerDragPreviewSnapshot(nextSnapshot: PlannerDragPreviewSnapshot) {
  const previousSnapshot = plannerDragPreviewSnapshot;
  plannerDragPreviewSnapshot = nextSnapshot;
  emitPlannerDragPreviewSnapshot(previousSnapshot, nextSnapshot);
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

export function subscribePlannerRowDragPreview(
  sectionId: string,
  teamId: TeamId,
  listener: Listener
) {
  return subscribeScopedListener(
    plannerRowDragPreviewListeners,
    makePlannerDragPreviewRowKey(sectionId, teamId),
    listener
  );
}

export function getPlannerRowDragPreviewSnapshot(
  sectionId: string,
  teamId: TeamId
): PlannerRowDragPreviewSnapshot {
  return getPlannerRowDragPreviewSnapshotForSnapshot(
    plannerDragPreviewSnapshot,
    sectionId,
    teamId
  );
}

export function usePlannerRowDragPreview(sectionId: string, teamId: TeamId) {
  const getSnapshot = () => getPlannerRowDragPreviewSnapshot(sectionId, teamId);

  return useSyncExternalStore(
    (listener) => subscribePlannerRowDragPreview(sectionId, teamId, listener),
    getSnapshot,
    getSnapshot
  );
}

export function subscribePlannerSectionDragPreview(
  sectionId: string,
  listener: Listener
) {
  return subscribeScopedListener(
    plannerSectionDragPreviewListeners,
    sectionId,
    listener
  );
}

export function getPlannerSectionDragPreviewSnapshot(
  sectionId: string
): PlannerSectionDragPreviewSnapshot {
  return getPlannerSectionDragPreviewSnapshotForSnapshot(
    plannerDragPreviewSnapshot,
    sectionId
  );
}

export function usePlannerSectionDragPreview(sectionId: string) {
  const getSnapshot = () => getPlannerSectionDragPreviewSnapshot(sectionId);

  return useSyncExternalStore(
    (listener) => subscribePlannerSectionDragPreview(sectionId, listener),
    getSnapshot,
    getSnapshot
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
