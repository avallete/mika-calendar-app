import { describe, expect, test } from "bun:test";

import { makeSlotKey } from "@/lib/planner/calendar";
import { buildMovePlacementRequests } from "@/lib/planner/drag-placements";
import {
  buildCalendarBucketFromRowSurfacePointer,
  makeCalendarRowSurfaceId,
} from "@/lib/planner/timeline-hover";
import type { CalendarRowSurface, DragProjectMeta, Project } from "@/lib/planner/types";

function makeSurface(overrides: Partial<CalendarRowSurface> = {}): CalendarRowSurface {
  return {
    surfaceId: overrides.surfaceId ?? makeCalendarRowSurfaceId("2026-03", "team-a"),
    sectionId: overrides.sectionId ?? "2026-03",
    teamId: overrides.teamId ?? "team-a",
    startDate: overrides.startDate ?? "2026-03-01",
    dayCount: overrides.dayCount ?? 31,
    granularity: "row-surface",
  };
}

function makeScheduledProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? "project-1",
    title: overrides.title ?? "Projet",
    status: "scheduled",
    plannedTeam: overrides.plannedTeam ?? "team-a",
    estimatedDurationHalfDays: overrides.estimatedDurationHalfDays ?? 2,
    scheduledTeam: overrides.scheduledTeam ?? "team-a",
    scheduledStartSlot: overrides.scheduledStartSlot ?? makeSlotKey("2026-03-27", "AM"),
    scheduledDurationHalfDays: overrides.scheduledDurationHalfDays ?? 2,
    sequenceOrder: overrides.sequenceOrder ?? 0,
    targetDateHint: overrides.targetDateHint,
    notes: overrides.notes,
  };
}

function makeActiveDrag(
  overrides: Partial<Extract<DragProjectMeta, { type: "scheduled" }>> = {}
): Extract<DragProjectMeta, { type: "scheduled" }> {
  return {
    type: "scheduled",
    intent: "move",
    projectId: overrides.projectId ?? "active",
    teamId: overrides.teamId ?? "team-a",
    startSlot: overrides.startSlot ?? makeSlotKey("2026-03-27", "AM"),
    durationHalfDays: overrides.durationHalfDays ?? 2,
    calendarEndSlot: overrides.calendarEndSlot ?? makeSlotKey("2026-03-28", "AM"),
    title: overrides.title ?? "Active",
    selectionProjectIds: overrides.selectionProjectIds,
  };
}

describe("timeline hover", () => {
  test("maps pointer positions to AM and PM half-days", () => {
    const surface = makeSurface({
      startDate: "2026-03-02",
      dayCount: 2,
    });

    expect(
      buildCalendarBucketFromRowSurfacePointer({
        surface,
        pointerX: 10,
        rectLeft: 0,
        rectWidth: 200,
      })?.startSlot
    ).toBe(makeSlotKey("2026-03-02", "AM"));
    expect(
      buildCalendarBucketFromRowSurfacePointer({
        surface,
        pointerX: 60,
        rectLeft: 0,
        rectWidth: 200,
      })?.startSlot
    ).toBe(makeSlotKey("2026-03-02", "PM"));
  });

  test("clamps pointer positions to the last visible slot", () => {
    const surface = makeSurface({
      startDate: "2026-03-02",
      dayCount: 2,
    });

    expect(
      buildCalendarBucketFromRowSurfacePointer({
        surface,
        pointerX: 999,
        rectLeft: 0,
        rectWidth: 200,
      })
    ).toEqual({
      bucketId: `bucket:team-a:${makeSlotKey("2026-03-03", "PM")}`,
      teamId: "team-a",
      startSlot: makeSlotKey("2026-03-03", "PM"),
      granularity: "slot",
    });
  });

  test("preserves the row team when building hover buckets", () => {
    const surface = makeSurface({
      teamId: "team-b",
      sectionId: "2026-04",
      startDate: "2026-04-01",
    });

    expect(
      buildCalendarBucketFromRowSurfacePointer({
        surface,
        pointerX: 25,
        rectLeft: 0,
        rectWidth: 310,
      })?.teamId
    ).toBe("team-b");
  });

  test("computed row-surface hover still normalizes non-working targets forward", () => {
    const surface = makeSurface({
      startDate: "2026-03-28",
      sectionId: "2026-03",
      dayCount: 3,
    });
    const bucket = buildCalendarBucketFromRowSurfacePointer({
      surface,
      pointerX: 10,
      rectLeft: 0,
      rectWidth: 300,
    });

    const movePlan = buildMovePlacementRequests(
      makeActiveDrag(),
      bucket!,
      [
        makeScheduledProject({
          id: "active",
          title: "Active",
          scheduledStartSlot: makeSlotKey("2026-03-27", "AM"),
        }),
      ],
      []
    );

    expect(bucket?.startSlot).toBe(makeSlotKey("2026-03-28", "AM"));
    expect(movePlan?.normalizedRequests[0].placement.startSlot).toBe(makeSlotKey("2026-03-30", "AM"));
  });
});
