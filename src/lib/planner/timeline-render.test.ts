import { describe, expect, test } from "bun:test";

import { makeSlotKey } from "@/lib/planner/calendar";
import { buildProjectSpanByIdFromProjects } from "@/lib/planner/planner-computed";
import {
  buildSectionTeamProjectMap,
  buildTimelineSectionOverlayViews,
  buildTimelineSectionRowViews,
  EMPTY_SECTION_TEAM_PROJECTS,
  EMPTY_TEAM_PROJECTS,
  scopeSectionPreviewState,
} from "@/lib/planner/timeline-render";
import type {
  CalendarBucket,
  ScheduledTimelineProject,
  Team,
  YearMonthSection,
} from "@/lib/planner/types";

const teams: Team[] = [
  {
    id: "team-a",
    slug: "team-a",
    nameFr: "Equipe A",
    displayOrder: 0,
    accentColor: "oklch(0.58 0.11 205)",
    softColor: "oklch(0.95 0.03 205)",
    isActive: true,
  },
  {
    id: "team-b",
    slug: "team-b",
    nameFr: "Equipe B",
    displayOrder: 1,
    accentColor: "oklch(0.68 0.13 55)",
    softColor: "oklch(0.96 0.04 55)",
    isActive: true,
  },
];

const marchSection: YearMonthSection = {
  id: "2026-03",
  year: 2026,
  label: "Mars 2026",
  startDate: "2026-03-01",
  endDate: "2026-03-31",
  dayCount: 31,
};

function makeScheduledProject(
  overrides: Partial<ScheduledTimelineProject> = {}
): ScheduledTimelineProject {
  return {
    id: overrides.id ?? "project-1",
    title: overrides.title ?? "Projet",
    status: "scheduled",
    plannedTeam: overrides.plannedTeam ?? "team-a",
    estimatedDurationHalfDays: overrides.estimatedDurationHalfDays ?? 2,
    scheduledTeam: overrides.scheduledTeam ?? "team-a",
    scheduledStartSlot: overrides.scheduledStartSlot ?? makeSlotKey("2026-03-10", "AM"),
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

function buildProjectSpanById(projects: ScheduledTimelineProject[]) {
  return buildProjectSpanByIdFromProjects({
    snapshot: {
      teams,
      holidaySources: [],
      projects,
      dependencies: [],
      customClosures: [],
      closures: [],
      history: {
        canUndo: false,
        canRedo: false,
      },
    },
    projects,
  });
}

describe("timeline render helpers", () => {
  test("scopes preview data to touched sections but keeps hovered bucket highlights", () => {
    const hoveredBucket = makeBucket(makeSlotKey("2026-03-12", "AM"));
    const previewProjects = [
      makeScheduledProject({
        id: "project-1",
        scheduledStartSlot: makeSlotKey("2026-03-12", "AM"),
      }),
    ];
    const previewProjectsBySection = buildSectionTeamProjectMap(
      previewProjects,
      buildProjectSpanById(previewProjects)
    );
    const previewChangedProjectIdSet = new Set(["project-1"]);

    const untouchedState = scopeSectionPreviewState({
      section: marchSection,
      previewTouchedSectionIdSet: new Set<string>(),
      previewProjectsBySection,
      previewChangedProjectIdSet,
      previewPrimaryProjectId: "project-1",
      hoveredBucket,
    });

    expect(untouchedState.previewProjectsBySection).toBe(EMPTY_SECTION_TEAM_PROJECTS);
    expect(untouchedState.previewChangedProjectIdSet.size).toBe(0);
    expect(untouchedState.previewPrimaryProjectId).toBeNull();
    expect(untouchedState.hoveredBucket).toEqual(hoveredBucket);

    const touchedState = scopeSectionPreviewState({
      section: marchSection,
      previewTouchedSectionIdSet: new Set([marchSection.id]),
      previewProjectsBySection,
      previewChangedProjectIdSet,
      previewPrimaryProjectId: "project-1",
      hoveredBucket,
    });

    expect(touchedState.previewProjectsBySection).toBe(previewProjectsBySection);
    expect(touchedState.previewChangedProjectIdSet).toBe(previewChangedProjectIdSet);
    expect(touchedState.previewPrimaryProjectId).toBe("project-1");
    expect(touchedState.hoveredBucket).toEqual(hoveredBucket);
  });

  test("builds static row views once from committed scheduled cards", () => {
    const committedProjects = [
      makeScheduledProject({
        id: "project-1",
        scheduledTeam: "team-a",
        scheduledStartSlot: makeSlotKey("2026-03-10", "AM"),
      }),
    ];
    const committedProjectsBySection = buildSectionTeamProjectMap(
      committedProjects,
      buildProjectSpanById(committedProjects)
    );
    const rowViews = buildTimelineSectionRowViews({
      teams,
      section: marchSection,
      committedSectionProjects:
        committedProjectsBySection.get(marchSection.id) ?? EMPTY_TEAM_PROJECTS,
      dependencyCountByProjectId: new Map([["project-1", 2]]),
      selectedProjectIdSet: new Set(["project-1"]),
      projectSpanById: buildProjectSpanById(committedProjects),
    });

    expect(rowViews).toHaveLength(2);

    const teamARow = rowViews[0];
    expect(teamARow.team.id).toBe("team-a");
    expect(teamARow.scheduledCards).toHaveLength(1);
    expect(teamARow.scheduledCards[0]?.project.id).toBe("project-1");
    expect(teamARow.scheduledCards[0]?.selected).toBe(true);
    expect(teamARow.scheduledCards[0]?.dependencyCount).toBe(2);

    const teamBRow = rowViews[1];
    expect(teamBRow.team.id).toBe("team-b");
    expect(teamBRow.scheduledCards).toHaveLength(0);
  });

  test("builds overlay views from preview, hover, and pending state without mutating static rows", () => {
    const committedProjects = [
      makeScheduledProject({
        id: "project-1",
        scheduledTeam: "team-a",
        scheduledStartSlot: makeSlotKey("2026-03-10", "AM"),
      }),
    ];
    const committedProjectsBySection = buildSectionTeamProjectMap(
      committedProjects,
      buildProjectSpanById(committedProjects)
    );
    const previewProjects = [
      makeScheduledProject({
        id: "project-1",
        scheduledTeam: "team-a",
        scheduledStartSlot: makeSlotKey("2026-03-11", "AM"),
      }),
      makeScheduledProject({
        id: "project-2",
        scheduledTeam: "team-a",
        scheduledStartSlot: makeSlotKey("2026-03-20", "AM"),
      }),
    ];
    const previewProjectsBySection = buildSectionTeamProjectMap(
      previewProjects,
      buildProjectSpanById(previewProjects)
    );
    const rowViews = buildTimelineSectionRowViews({
      teams,
      section: marchSection,
      committedSectionProjects:
        committedProjectsBySection.get(marchSection.id) ?? EMPTY_TEAM_PROJECTS,
      dependencyCountByProjectId: new Map([["project-1", 2]]),
      selectedProjectIdSet: new Set(["project-1"]),
      projectSpanById: buildProjectSpanById(committedProjects),
    });

    const overlayViews = buildTimelineSectionOverlayViews({
      rowViews,
      section: marchSection,
      previewProjectsBySection,
      previewChangedProjectIdSet: new Set(["project-1", "project-2"]),
      previewPrimaryProjectId: "project-1",
      previewProjectSpanById: buildProjectSpanById(previewProjects),
      pendingPlacement: {
        projectId: "draft-1",
        title: "Brouillon",
        triggerId: "pending-slot",
        placement: {
          teamId: "team-a",
          startSlot: makeSlotKey("2026-03-12", "AM"),
          durationHalfDays: 2,
        },
      },
      hoveredBucket: makeBucket(makeSlotKey("2026-03-12", "AM")),
    });

    const teamAOverlay = overlayViews[0];
    expect(teamAOverlay.team.id).toBe("team-a");
    expect(teamAOverlay.hoveredBucket?.bucketId).toBe(
      makeBucket(makeSlotKey("2026-03-12", "AM")).bucketId
    );
    expect(teamAOverlay.pendingBucket?.bucketId).toBe("pending-slot");
    expect(teamAOverlay.dimmedCards.map((card) => card.projectId)).toEqual(["project-1"]);
    expect(teamAOverlay.previewCards.map((card) => card.project.id)).toEqual([
      "project-1",
      "project-2",
    ]);
    expect(teamAOverlay.previewCards[0]?.primary).toBe(true);

    const teamBOverlay = overlayViews[1];
    expect(teamBOverlay.team.id).toBe("team-b");
    expect(teamBOverlay.previewCards).toHaveLength(0);
    expect(teamBOverlay.dimmedCards).toHaveLength(0);
  });

  test("reuses unchanged section project maps when previous projections are provided", () => {
    const previousProjects = [
      makeScheduledProject({
        id: "project-march",
        scheduledTeam: "team-a",
        scheduledStartSlot: makeSlotKey("2026-03-10", "AM"),
      }),
      makeScheduledProject({
        id: "project-april",
        scheduledTeam: "team-b",
        scheduledStartSlot: makeSlotKey("2026-04-14", "AM"),
      }),
    ];
    const previousProjectsBySection = buildSectionTeamProjectMap(
      previousProjects,
      buildProjectSpanById(previousProjects)
    );

    const nextProjects = [
      makeScheduledProject({
        id: "project-march",
        scheduledTeam: "team-a",
        scheduledStartSlot: makeSlotKey("2026-03-12", "AM"),
      }),
      makeScheduledProject({
        id: "project-april",
        scheduledTeam: "team-b",
        scheduledStartSlot: makeSlotKey("2026-04-14", "AM"),
      }),
    ];
    const nextProjectsBySection = buildSectionTeamProjectMap(
      nextProjects,
      buildProjectSpanById(nextProjects),
      previousProjectsBySection
    );

    expect(nextProjectsBySection.get("2026-04")).toBe(previousProjectsBySection.get("2026-04"));
    expect(nextProjectsBySection.get("2026-03")).not.toBe(
      previousProjectsBySection.get("2026-03")
    );
  });
});
