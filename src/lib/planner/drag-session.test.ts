import { describe, expect, test } from "bun:test";

import { makeSlotKey } from "@/lib/planner/calendar";
import {
  extractPlannerHoveredBucket,
  isPointerWithinPlannerTimelineSurface,
  resolvePlannerDraftDropBucket,
  shouldEnablePlannerDragAutoScroll,
} from "@/lib/planner/drag-session";
import type { CalendarBucket, DragProjectMeta } from "@/lib/planner/types";

function makeBucket(overrides: Partial<CalendarBucket> = {}): CalendarBucket {
  return {
    bucketId: overrides.bucketId ?? `bucket:team-a:${makeSlotKey("2026-03-12", "AM")}`,
    teamId: overrides.teamId ?? "team-a",
    startSlot: overrides.startSlot ?? makeSlotKey("2026-03-12", "AM"),
    granularity: overrides.granularity ?? "slot",
  };
}

function makeDraftDrag(): Extract<DragProjectMeta, { type: "draft" }> {
  return {
    type: "draft",
    projectId: "draft-1",
    durationHalfDays: 4,
    title: "Draft",
  };
}

function makeScheduledDrag(): Extract<DragProjectMeta, { type: "scheduled" }> {
  return {
    type: "scheduled",
    intent: "move",
    projectId: "scheduled-1",
    teamId: "team-a",
    startSlot: makeSlotKey("2026-03-10", "AM"),
    durationHalfDays: 4,
    calendarEndSlot: makeSlotKey("2026-03-12", "AM"),
    title: "Scheduled",
  };
}

function makeDocumentLike(withinTimeline: boolean) {
  return {
    elementFromPoint: () => ({
      closest: (selector: string) =>
        selector === "[data-timeline-row-surface]" && withinTimeline ? {} : null,
    }),
  };
}

describe("planner drag session helpers", () => {
  test("prefers synthetic collision buckets over over data", () => {
    const collisionBucket = makeBucket({
      bucketId: `bucket:team-a:${makeSlotKey("2026-03-14", "AM")}`,
      startSlot: makeSlotKey("2026-03-14", "AM"),
    });
    const overBucket = makeBucket({
      bucketId: `bucket:team-b:${makeSlotKey("2026-03-18", "PM")}`,
      teamId: "team-b",
      startSlot: makeSlotKey("2026-03-18", "PM"),
    });

    expect(
      extractPlannerHoveredBucket({
        collisions: [{ data: { bucket: collisionBucket } }],
        over: { data: { current: overBucket } },
      })
    ).toEqual(collisionBucket);
  });

  test("falls back to direct bucket droppable data", () => {
    const bucket = makeBucket();

    expect(
      extractPlannerHoveredBucket({
        collisions: [],
        over: { data: { current: bucket } },
      })
    ).toEqual(bucket);
  });

  test("returns no bucket when neither collisions nor over target are timeline buckets", () => {
    expect(
      extractPlannerHoveredBucket({
        collisions: [{ data: { bucket: { teamId: "team-a" } } }],
        over: { data: { current: { surfaceId: "surface:2026-03:team-a" } } },
      })
    ).toBeNull();
  });

  test("disables auto-scroll for draft drags only", () => {
    expect(shouldEnablePlannerDragAutoScroll(makeDraftDrag())).toBe(false);
    expect(shouldEnablePlannerDragAutoScroll(makeScheduledDrag())).toBe(true);
    expect(shouldEnablePlannerDragAutoScroll(null)).toBe(true);
  });

  test("detects whether the final pointer is still over a timeline row surface", () => {
    expect(
      isPointerWithinPlannerTimelineSurface({
        documentLike: makeDocumentLike(true),
        pointerCoordinates: { x: 120, y: 240 },
      })
    ).toBe(true);

    expect(
      isPointerWithinPlannerTimelineSurface({
        documentLike: makeDocumentLike(false),
        pointerCoordinates: { x: 120, y: 240 },
      })
    ).toBe(false);

    expect(
      isPointerWithinPlannerTimelineSurface({
        documentLike: makeDocumentLike(true),
        pointerCoordinates: null,
      })
    ).toBe(false);
  });

  test("prefers the current hovered bucket when resolving a draft drop target", () => {
    const currentBucket = makeBucket({
      bucketId: `bucket:team-a:${makeSlotKey("2026-03-20", "AM")}`,
      startSlot: makeSlotKey("2026-03-20", "AM"),
    });
    const eventBucket = makeBucket({
      bucketId: `bucket:team-a:${makeSlotKey("2026-03-21", "AM")}`,
      startSlot: makeSlotKey("2026-03-21", "AM"),
    });
    const lastValidBucket = makeBucket({
      bucketId: `bucket:team-a:${makeSlotKey("2026-03-22", "AM")}`,
      startSlot: makeSlotKey("2026-03-22", "AM"),
    });

    expect(
      resolvePlannerDraftDropBucket({
        currentHoveredBucket: currentBucket,
        eventBucket,
        lastValidBucket,
        documentLike: makeDocumentLike(true),
        pointerCoordinates: { x: 10, y: 10 },
      })
    ).toEqual({
      bucket: currentBucket,
      source: "current-hover",
    });
  });

  test("falls back to the event bucket when the current hover was cleared", () => {
    const eventBucket = makeBucket({
      bucketId: `bucket:team-b:${makeSlotKey("2026-03-21", "PM")}`,
      teamId: "team-b",
      startSlot: makeSlotKey("2026-03-21", "PM"),
    });

    expect(
      resolvePlannerDraftDropBucket({
        currentHoveredBucket: null,
        eventBucket,
        lastValidBucket: makeBucket(),
        documentLike: makeDocumentLike(true),
        pointerCoordinates: { x: 10, y: 10 },
      })
    ).toEqual({
      bucket: eventBucket,
      source: "event-collision",
    });
  });

  test("uses the last valid bucket only when the final pointer is still over the timeline", () => {
    const lastValidBucket = makeBucket({
      bucketId: `bucket:team-a:${makeSlotKey("2026-03-24", "AM")}`,
      startSlot: makeSlotKey("2026-03-24", "AM"),
    });

    expect(
      resolvePlannerDraftDropBucket({
        currentHoveredBucket: null,
        eventBucket: null,
        lastValidBucket,
        documentLike: makeDocumentLike(true),
        pointerCoordinates: { x: 40, y: 80 },
      })
    ).toEqual({
      bucket: lastValidBucket,
      source: "last-valid-fallback",
    });

    expect(
      resolvePlannerDraftDropBucket({
        currentHoveredBucket: null,
        eventBucket: null,
        lastValidBucket,
        documentLike: makeDocumentLike(false),
        pointerCoordinates: { x: 40, y: 80 },
      })
    ).toEqual({
      bucket: null,
      source: "no-target",
    });
  });
});
