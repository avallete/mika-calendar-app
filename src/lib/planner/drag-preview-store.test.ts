import { afterEach, describe, expect, test } from "bun:test";

import {
  makePlannerDragPreviewRowKey,
  type PlannerDragPreviewData,
} from "@/lib/planner/drag-preview";
import {
  getPlannerRowDragPreviewSnapshot,
  getPlannerSectionDragPreviewSnapshot,
  publishPlannerDragPreviewHover,
  publishPlannerFastDragPreview,
  resetPlannerDragPreviewSession,
  startPlannerDragPreviewSession,
  subscribePlannerRowDragPreview,
  subscribePlannerSectionDragPreview,
} from "@/lib/planner/drag-preview-store";
import type { CalendarBucket, TeamId, TimelinePreviewDelta } from "@/lib/planner/types";

function makeBucket(teamId: TeamId, startSlot: string): CalendarBucket {
  return {
    bucketId: `bucket:${teamId}:${startSlot}`,
    teamId,
    startSlot: startSlot as CalendarBucket["startSlot"],
    granularity: "slot",
  };
}

function makePreviewData(overrides: Partial<PlannerDragPreviewData> = {}): PlannerDragPreviewData {
  const delta: TimelinePreviewDelta = {
    projects: [],
    changedProjectIds: ["project-1"],
    primaryProjectId: "project-1",
    touchedTeamIds: ["team-a", "team-b"],
    touchedSectionIds: ["2026-03", "2026-04"],
  };

  return {
    signature: overrides.signature ?? "sig-1",
    delta: overrides.delta ?? delta,
    projectsBySection: overrides.projectsBySection ?? new Map(),
    projectSpanById: overrides.projectSpanById ?? new Map(),
    changedProjectIdSet: overrides.changedProjectIdSet ?? new Set(delta.changedProjectIds),
    touchedSectionIdSet:
      overrides.touchedSectionIdSet ?? new Set(delta.touchedSectionIds),
    touchedTeamIdSet: overrides.touchedTeamIdSet ?? new Set(delta.touchedTeamIds),
    touchedRowKeySet:
      overrides.touchedRowKeySet ??
      new Set([
        makePlannerDragPreviewRowKey("2026-03", "team-a"),
        makePlannerDragPreviewRowKey("2026-04", "team-b"),
      ]),
  };
}

afterEach(() => {
  resetPlannerDragPreviewSession();
});

describe("drag preview store", () => {
  test("notifies only rows and sections whose scoped snapshot changed", () => {
    startPlannerDragPreviewSession("drag-1");

    let marchRowNotifications = 0;
    let aprilRowNotifications = 0;
    let mayRowNotifications = 0;
    let marchSectionNotifications = 0;
    let aprilSectionNotifications = 0;
    let maySectionNotifications = 0;

    const unsubscribeMarchRow = subscribePlannerRowDragPreview(
      "2026-03",
      "team-a",
      () => {
        marchRowNotifications += 1;
      }
    );
    const unsubscribeAprilRow = subscribePlannerRowDragPreview(
      "2026-04",
      "team-b",
      () => {
        aprilRowNotifications += 1;
      }
    );
    const unsubscribeMayRow = subscribePlannerRowDragPreview(
      "2026-05",
      "team-a",
      () => {
        mayRowNotifications += 1;
      }
    );
    const unsubscribeMarchSection = subscribePlannerSectionDragPreview(
      "2026-03",
      () => {
        marchSectionNotifications += 1;
      }
    );
    const unsubscribeAprilSection = subscribePlannerSectionDragPreview(
      "2026-04",
      () => {
        aprilSectionNotifications += 1;
      }
    );
    const unsubscribeMaySection = subscribePlannerSectionDragPreview(
      "2026-05",
      () => {
        maySectionNotifications += 1;
      }
    );

    publishPlannerFastDragPreview({
      activeDragId: "drag-1",
      hoveredBucket: makeBucket("team-a", "2026-03-10-AM"),
      signature: "sig-1",
      preview: makePreviewData(),
      exactPending: true,
    });

    expect(marchRowNotifications).toBe(1);
    expect(aprilRowNotifications).toBe(1);
    expect(mayRowNotifications).toBe(0);
    expect(marchSectionNotifications).toBe(1);
    expect(aprilSectionNotifications).toBe(1);
    expect(maySectionNotifications).toBe(0);

    publishPlannerDragPreviewHover("drag-1", makeBucket("team-a", "2026-05-10-AM"));

    expect(marchRowNotifications).toBe(2);
    expect(aprilRowNotifications).toBe(1);
    expect(mayRowNotifications).toBe(1);
    expect(marchSectionNotifications).toBe(2);
    expect(aprilSectionNotifications).toBe(1);
    expect(maySectionNotifications).toBe(1);

    unsubscribeMarchRow();
    unsubscribeAprilRow();
    unsubscribeMayRow();
    unsubscribeMarchSection();
    unsubscribeAprilSection();
    unsubscribeMaySection();
  });

  test("returns scoped row and section snapshots", () => {
    startPlannerDragPreviewSession("drag-1");

    publishPlannerFastDragPreview({
      activeDragId: "drag-1",
      hoveredBucket: makeBucket("team-a", "2026-03-10-AM"),
      signature: "sig-1",
      preview: makePreviewData(),
      exactPending: true,
    });

    const marchRowSnapshot = getPlannerRowDragPreviewSnapshot("2026-03", "team-a");
    const aprilRowSnapshot = getPlannerRowDragPreviewSnapshot("2026-04", "team-b");
    const mayRowSnapshot = getPlannerRowDragPreviewSnapshot("2026-05", "team-a");
    const marchSectionSnapshot = getPlannerSectionDragPreviewSnapshot("2026-03");
    const maySectionSnapshot = getPlannerSectionDragPreviewSnapshot("2026-05");

    expect(marchRowSnapshot.preview?.signature).toBe("sig-1");
    expect(marchRowSnapshot.hoveredBucket?.bucketId).toBe("bucket:team-a:2026-03-10-AM");
    expect(aprilRowSnapshot.preview?.signature).toBe("sig-1");
    expect(aprilRowSnapshot.hoveredBucket).toBeNull();
    expect(mayRowSnapshot.preview).toBeNull();
    expect(marchSectionSnapshot.preview?.signature).toBe("sig-1");
    expect(maySectionSnapshot.preview).toBeNull();
  });

  test("reuses scoped snapshot objects while the store snapshot is unchanged", () => {
    startPlannerDragPreviewSession("drag-1");

    publishPlannerFastDragPreview({
      activeDragId: "drag-1",
      hoveredBucket: makeBucket("team-a", "2026-03-10-AM"),
      signature: "sig-1",
      preview: makePreviewData(),
      exactPending: true,
    });

    const firstRowSnapshot = getPlannerRowDragPreviewSnapshot("2026-03", "team-a");
    const secondRowSnapshot = getPlannerRowDragPreviewSnapshot("2026-03", "team-a");
    const firstSectionSnapshot = getPlannerSectionDragPreviewSnapshot("2026-03");
    const secondSectionSnapshot = getPlannerSectionDragPreviewSnapshot("2026-03");

    expect(secondRowSnapshot).toBe(firstRowSnapshot);
    expect(secondSectionSnapshot).toBe(firstSectionSnapshot);
  });
});
