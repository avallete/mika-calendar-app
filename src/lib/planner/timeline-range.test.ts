import { describe, expect, test } from "bun:test";

import {
  buildTimelineSections,
  buildTimelineYearRange,
  collectTimelineRelevantDates,
  getTodayDateString,
} from "@/lib/planner/timeline-range";
import type { ClosurePeriod, Project } from "@/lib/planner/types";

const fixedNow = new Date("2026-03-24T10:00:00");

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? "project-1",
    title: overrides.title ?? "Projet",
    status: overrides.status ?? "draft",
    plannedTeam: overrides.plannedTeam ?? "team-a",
    estimatedDurationHalfDays: overrides.estimatedDurationHalfDays ?? 2,
    targetDateHint: overrides.targetDateHint,
    scheduledTeam: overrides.scheduledTeam,
    scheduledStartSlot: overrides.scheduledStartSlot,
    scheduledDurationHalfDays: overrides.scheduledDurationHalfDays,
    sequenceOrder: overrides.sequenceOrder,
    notes: overrides.notes,
  };
}

function makeClosure(overrides: Partial<ClosurePeriod> = {}): ClosurePeriod {
  return {
    id: overrides.id ?? "closure-1",
    title: overrides.title ?? "Closure",
    type: overrides.type ?? "company_closure",
    startDate: overrides.startDate ?? "2026-01-01",
    endDate: overrides.endDate ?? overrides.startDate ?? "2026-01-01",
    impact: overrides.impact ?? "blocking",
    details: overrides.details,
    source: overrides.source ?? "custom",
    editable: overrides.editable ?? true,
  };
}

describe("timeline range", () => {
  test("collects target dates, scheduled dates, and closure dates", () => {
    const relevantDates = collectTimelineRelevantDates(
      [
        makeProject({ id: "draft", targetDateHint: "2026-06-10" }),
        makeProject({
          id: "scheduled",
          status: "scheduled",
          scheduledTeam: "team-a",
          scheduledStartSlot: "2027-02-14-AM",
          scheduledDurationHalfDays: 3,
          sequenceOrder: 0,
        }),
      ],
      [makeClosure({ startDate: "2028-01-05", endDate: "2028-01-09" })]
    );

    expect(relevantDates).toEqual([
      "2026-06-10",
      "2027-02-14",
      "2028-01-05",
      "2028-01-09",
    ]);
  });

  test("builds a padded single-year range", () => {
    expect(
      buildTimelineYearRange(
        [makeProject({ targetDateHint: "2026-06-10" })],
        [],
        fixedNow
      )
    ).toEqual({
      startYear: 2025,
      endYear: 2027,
      years: [2025, 2026, 2027],
    });
  });

  test("builds ordered monthly sections across multiple years", () => {
    const sections = buildTimelineSections(
      [
        makeProject({ targetDateHint: "2026-06-10" }),
        makeProject({
          id: "scheduled",
          status: "scheduled",
          scheduledTeam: "team-a",
          scheduledStartSlot: "2027-02-14-AM",
          scheduledDurationHalfDays: 3,
          sequenceOrder: 0,
        }),
      ],
      [],
      fixedNow
    );

    expect(sections[0]).toMatchObject({
      id: "2025-01",
      year: 2025,
      startDate: "2025-01-01",
      endDate: "2025-01-31",
    });
    expect(sections.at(-1)).toMatchObject({
      id: "2028-12",
      year: 2028,
      startDate: "2028-12-01",
      endDate: "2028-12-31",
    });
    expect(sections).toHaveLength(48);
  });

  test("falls back to the current year with a one-year buffer when no data exists", () => {
    expect(buildTimelineYearRange([], [], fixedNow)).toEqual({
      startYear: 2025,
      endYear: 2027,
      years: [2025, 2026, 2027],
    });
  });

  test("extends the range when closures reach beyond project dates", () => {
    expect(
      buildTimelineYearRange(
        [makeProject({ targetDateHint: "2026-06-10" })],
        [makeClosure({ startDate: "2029-01-03", endDate: "2029-01-10" })],
        fixedNow
      )
    ).toEqual({
      startYear: 2025,
      endYear: 2030,
      years: [2025, 2026, 2027, 2028, 2029, 2030],
    });
  });

  test("formats today's date using local calendar formatting", () => {
    expect(getTodayDateString(fixedNow)).toBe("2026-03-24");
  });
});
