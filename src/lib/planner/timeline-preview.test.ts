import { describe, expect, test } from "bun:test";

import { makeSlotKey } from "@/lib/planner/calendar";
import {
  buildTimelinePreviewDelta,
  buildTimelinePreviewDeltaFromChangedProjectIds,
  buildTimelinePreviewDeltaFromPlacementRequests,
} from "@/lib/planner/timeline-preview";
import type { Project } from "@/lib/planner/types";

function makeDraftProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? "draft-1",
    title: overrides.title ?? "Brouillon",
    status: "draft",
    plannedTeam: overrides.plannedTeam ?? "team-a",
    estimatedDurationHalfDays: overrides.estimatedDurationHalfDays ?? 4,
    targetDateHint: overrides.targetDateHint,
    notes: overrides.notes,
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

describe("timeline preview delta", () => {
  test("emits only changed scheduled projects", () => {
    const currentProjects = [
      makeScheduledProject({
        id: "active",
        scheduledStartSlot: makeSlotKey("2026-03-27", "AM"),
      }),
      makeScheduledProject({
        id: "stable",
        scheduledStartSlot: makeSlotKey("2026-04-03", "AM"),
      }),
    ];
    const previewProjects = [
      makeScheduledProject({
        id: "active",
        scheduledStartSlot: makeSlotKey("2026-03-30", "AM"),
      }),
      makeScheduledProject({
        id: "stable",
        scheduledStartSlot: makeSlotKey("2026-04-03", "AM"),
      }),
    ];

    const delta = buildTimelinePreviewDelta({
      currentProjects,
      previewProjects,
      closures: [],
      primaryProjectId: "active",
    });

    expect(delta.projects.map((project) => project.id)).toEqual(["active"]);
    expect(delta.changedProjectIds).toEqual(["active"]);
    expect(delta.primaryProjectId).toBe("active");
  });

  test("tracks touched month ids and teams from both current and preview placements", () => {
    const currentProjects = [
      makeScheduledProject({
        id: "active",
        scheduledTeam: "team-a",
        scheduledStartSlot: makeSlotKey("2026-03-31", "PM"),
        scheduledDurationHalfDays: 4,
      }),
      makeScheduledProject({
        id: "stable",
        scheduledTeam: "team-c",
        scheduledStartSlot: makeSlotKey("2026-06-02", "AM"),
      }),
    ];
    const previewProjects = [
      makeScheduledProject({
        id: "active",
        scheduledTeam: "team-b",
        scheduledStartSlot: makeSlotKey("2026-04-30", "PM"),
        scheduledDurationHalfDays: 4,
      }),
      makeScheduledProject({
        id: "stable",
        scheduledTeam: "team-c",
        scheduledStartSlot: makeSlotKey("2026-06-02", "AM"),
      }),
    ];

    const delta = buildTimelinePreviewDelta({
      currentProjects,
      previewProjects,
      closures: [],
      primaryProjectId: "active",
    });

    expect(delta.touchedTeamIds.sort()).toEqual(["team-a", "team-b"]);
    expect(delta.touchedSectionIds.sort()).toEqual(["2026-03", "2026-04", "2026-05"]);
  });

  test("includes drafts that become scheduled in preview", () => {
    const currentProjects = [
      makeDraftProject({
        id: "draft-1",
        plannedTeam: "team-b",
        estimatedDurationHalfDays: 5,
      }),
    ];
    const previewProjects = [
      makeScheduledProject({
        id: "draft-1",
        plannedTeam: "team-b",
        estimatedDurationHalfDays: 5,
        scheduledTeam: "team-c",
        scheduledStartSlot: makeSlotKey("2026-04-30", "PM"),
        scheduledDurationHalfDays: 5,
      }),
    ];

    const delta = buildTimelinePreviewDelta({
      currentProjects,
      previewProjects,
      closures: [],
      primaryProjectId: "draft-1",
    });

    expect(delta.projects.map((project) => project.id)).toEqual(["draft-1"]);
    expect(delta.changedProjectIds).toEqual(["draft-1"]);
    expect(delta.primaryProjectId).toBe("draft-1");
    expect(delta.touchedTeamIds).toEqual(["team-c"]);
    expect(delta.touchedSectionIds).toEqual(["2026-04", "2026-05"]);
  });

  test("builds a preview delta directly from normalized placement requests", () => {
    const currentProjects = [
      makeScheduledProject({
        id: "active",
        scheduledTeam: "team-a",
        scheduledStartSlot: makeSlotKey("2026-03-31", "PM"),
        scheduledDurationHalfDays: 4,
      }),
      makeScheduledProject({
        id: "stable",
        scheduledTeam: "team-b",
        scheduledStartSlot: makeSlotKey("2026-04-15", "AM"),
      }),
    ];

    const delta = buildTimelinePreviewDeltaFromPlacementRequests({
      currentProjects,
      placementRequests: [
        {
          projectId: "active",
          placement: {
            teamId: "team-b",
            startSlot: makeSlotKey("2026-04-30", "PM"),
            durationHalfDays: 4,
          },
        },
      ],
      closures: [],
      primaryProjectId: "active",
    });

    expect(delta.changedProjectIds).toEqual(["active"]);
    expect(delta.projects.map((project) => project.id)).toEqual(["active"]);
    expect(delta.touchedTeamIds.sort()).toEqual(["team-a", "team-b"]);
    expect(delta.touchedSectionIds.sort()).toEqual(["2026-03", "2026-04", "2026-05"]);
  });

  test("uses explicit changed ids to avoid scanning unchanged preview projects", () => {
    const currentProjects = [
      makeScheduledProject({
        id: "active",
        scheduledStartSlot: makeSlotKey("2026-03-27", "AM"),
      }),
      makeScheduledProject({
        id: "stable",
        scheduledStartSlot: makeSlotKey("2026-04-03", "AM"),
      }),
    ];
    const previewProjects = [
      makeScheduledProject({
        id: "active",
        scheduledStartSlot: makeSlotKey("2026-03-30", "AM"),
      }),
      makeScheduledProject({
        id: "stable",
        scheduledStartSlot: makeSlotKey("2026-04-03", "AM"),
      }),
    ];

    const delta = buildTimelinePreviewDeltaFromChangedProjectIds({
      currentProjects,
      previewProjects,
      changedProjectIds: ["active"],
      closures: [],
      primaryProjectId: "active",
    });

    expect(delta.changedProjectIds).toEqual(["active"]);
    expect(delta.projects.map((project) => project.id)).toEqual(["active"]);
    expect(delta.primaryProjectId).toBe("active");
  });
});
