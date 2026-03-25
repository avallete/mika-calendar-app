import { describe, expect, test } from "bun:test";

import { makeSlotKey } from "@/lib/planner/calendar";
import {
  buildMovePlacementRequests,
  buildMovePlacementRequestsFromLookup,
  buildPlacementRequestsSignature,
  buildProjectsById,
} from "@/lib/planner/drag-placements";
import type { CalendarBucket, DragProjectMeta, Project } from "@/lib/planner/types";

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

function makeBucket(startSlot: CalendarBucket["startSlot"]): CalendarBucket {
  return {
    bucketId: `bucket:team-a:${startSlot}`,
    teamId: "team-a",
    startSlot,
    granularity: "slot",
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

describe("drag placements", () => {
  test("keeps the exact hovered slot for same-team moves", () => {
    const projects = [
      makeScheduledProject({
        id: "other",
        title: "Other",
        scheduledStartSlot: makeSlotKey("2026-03-30", "AM"),
        sequenceOrder: 0,
      }),
      makeScheduledProject({
        id: "active",
        title: "Active",
        scheduledStartSlot: makeSlotKey("2026-03-27", "AM"),
        sequenceOrder: 1,
      }),
    ];

    const movePlan = buildMovePlacementRequests(
      makeActiveDrag(),
      makeBucket(makeSlotKey("2026-03-31", "PM")),
      projects,
      []
    );

    expect(movePlan?.snappedRequests[0].placement.startSlot).toBe(makeSlotKey("2026-03-31", "PM"));
    expect(movePlan?.snapTarget).toBeNull();
  });

  test("preserves relative offsets for grouped moves", () => {
    const projects = [
      makeScheduledProject({
        id: "active",
        title: "Active",
        scheduledStartSlot: makeSlotKey("2026-03-27", "AM"),
        sequenceOrder: 0,
      }),
      makeScheduledProject({
        id: "follower",
        title: "Follower",
        scheduledStartSlot: makeSlotKey("2026-03-27", "PM"),
        sequenceOrder: 1,
      }),
    ];

    const movePlan = buildMovePlacementRequests(
      makeActiveDrag({
        selectionProjectIds: ["active", "follower"],
      }),
      makeBucket(makeSlotKey("2026-03-31", "AM")),
      projects,
      []
    );

    expect(movePlan?.snappedRequests.map((request) => request.placement.startSlot)).toEqual([
      makeSlotKey("2026-03-31", "AM"),
      makeSlotKey("2026-03-31", "PM"),
    ]);
  });

  test("normalizes non-working move targets forward", () => {
    const projects = [
      makeScheduledProject({
        id: "active",
        title: "Active",
        scheduledStartSlot: makeSlotKey("2026-03-27", "AM"),
      }),
    ];

    const movePlan = buildMovePlacementRequests(
      makeActiveDrag(),
      makeBucket(makeSlotKey("2026-03-28", "AM")),
      projects,
      []
    );

    expect(movePlan?.normalizedRequests[0].placement.startSlot).toBe(makeSlotKey("2026-03-30", "AM"));
    expect(movePlan?.snappedRequests[0].placement.startSlot).toBe(makeSlotKey("2026-03-30", "AM"));
  });

  test("builds the same move plan from a project lookup map", () => {
    const projects = [
      makeScheduledProject({
        id: "active",
        title: "Active",
        scheduledStartSlot: makeSlotKey("2026-03-27", "AM"),
        sequenceOrder: 0,
      }),
      makeScheduledProject({
        id: "follower",
        title: "Follower",
        scheduledStartSlot: makeSlotKey("2026-03-27", "PM"),
        sequenceOrder: 1,
      }),
    ];

    const movePlan = buildMovePlacementRequestsFromLookup(
      makeActiveDrag({
        selectionProjectIds: ["active", "follower"],
      }),
      makeBucket(makeSlotKey("2026-03-31", "AM")),
      buildProjectsById(projects),
      []
    );

    expect(movePlan?.snappedRequests.map((request) => request.placement.startSlot)).toEqual([
      makeSlotKey("2026-03-31", "AM"),
      makeSlotKey("2026-03-31", "PM"),
    ]);
  });

  test("produces the same signature for raw hover buckets that normalize to the same placement", () => {
    const projects = [
      makeScheduledProject({
        id: "active",
        title: "Active",
        scheduledStartSlot: makeSlotKey("2026-03-27", "AM"),
      }),
    ];

    const weekendMovePlan = buildMovePlacementRequests(
      makeActiveDrag(),
      makeBucket(makeSlotKey("2026-03-28", "AM")),
      projects,
      []
    );
    const mondayMovePlan = buildMovePlacementRequests(
      makeActiveDrag(),
      makeBucket(makeSlotKey("2026-03-30", "AM")),
      projects,
      []
    );

    expect(
      buildPlacementRequestsSignature(weekendMovePlan?.normalizedRequests ?? [])
    ).toBe(buildPlacementRequestsSignature(mondayMovePlan?.normalizedRequests ?? []));
  });
});
