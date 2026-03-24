import { describe, expect, test } from "bun:test";

import {
  buildTimelineYearSummaries,
  getTimelineMonthId,
  shiftTimelineDate,
} from "@/lib/planner/timeline-folding";
import { buildTimelineSections } from "@/lib/planner/timeline-range";
import type { ClosurePeriod, Project, TimelineViewMode } from "@/lib/planner/types";

const fixedNow = new Date("2026-03-24T10:00:00");

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? "project-1",
    title: overrides.title ?? "Projet",
    status: overrides.status ?? "scheduled",
    plannedTeam: overrides.plannedTeam ?? "team-a",
    estimatedDurationHalfDays: overrides.estimatedDurationHalfDays ?? 2,
    scheduledTeam: overrides.scheduledTeam ?? "team-a",
    scheduledStartSlot: overrides.scheduledStartSlot ?? "2026-03-24-AM",
    scheduledDurationHalfDays: overrides.scheduledDurationHalfDays ?? 2,
    sequenceOrder: overrides.sequenceOrder ?? 0,
    targetDateHint: overrides.targetDateHint,
    notes: overrides.notes,
  };
}

function makeClosure(overrides: Partial<ClosurePeriod> = {}): ClosurePeriod {
  return {
    id: overrides.id ?? "closure-1",
    title: overrides.title ?? "Closure",
    type: overrides.type ?? "company_closure",
    startDate: overrides.startDate ?? "2026-03-25",
    endDate: overrides.endDate ?? "2026-03-25",
    impact: overrides.impact ?? "blocking",
    details: overrides.details,
    source: overrides.source ?? "custom",
    editable: overrides.editable ?? true,
  };
}

function buildSummaries(viewMode: TimelineViewMode) {
  const sections = buildTimelineSections(
    [
      makeProject({ targetDateHint: "2026-03-24" }),
      makeProject({
        id: "future",
        scheduledStartSlot: "2027-04-05-AM",
      }),
    ],
    [makeClosure({ startDate: "2027-04-06", endDate: "2027-04-06" })],
    fixedNow
  );

  return buildTimelineYearSummaries({
    sections,
    projects: [
      makeProject({ scheduledStartSlot: "2026-03-24-AM" }),
      makeProject({ id: "future", scheduledStartSlot: "2027-04-05-AM" }),
    ],
    closures: [makeClosure({ startDate: "2027-04-06", endDate: "2027-04-06" })],
    activeDate: "2026-03-24",
    todayDate: "2026-03-24",
    focusDate: "2027-04-06",
    viewMode,
  });
}

describe("timeline folding", () => {
  test("marks exactly one active month in month mode", () => {
    const summaries = buildSummaries("month");
    const activeMonths = summaries.flatMap((year) => year.months.filter((month) => month.isActive));

    expect(activeMonths).toHaveLength(1);
    expect(activeMonths[0]?.section.id).toBe("2026-03");
  });

  test("marks exactly one active year in year mode", () => {
    const summaries = buildSummaries("year");
    const activeYears = summaries.filter((year) => year.isActive);

    expect(activeYears).toHaveLength(1);
    expect(activeYears[0]?.year).toBe(2026);
  });

  test("annotates today and focus in folded summaries", () => {
    const summaries = buildSummaries("month");
    const todayMonth = summaries.flatMap((year) => year.months).find((month) => month.containsToday);
    const focusMonth = summaries.flatMap((year) => year.months).find((month) => month.containsFocus);

    expect(todayMonth?.section.id).toBe("2026-03");
    expect(focusMonth?.section.id).toBe("2027-04");
  });

  test("shifts active date by the selected navigation mode", () => {
    expect(shiftTimelineDate("2026-03-24", "month", 1)).toBe("2026-04-24");
    expect(shiftTimelineDate("2026-03-24", "year", 1)).toBe("2027-03-24");
    expect(getTimelineMonthId("2026-03-24")).toBe("2026-03");
  });
});
