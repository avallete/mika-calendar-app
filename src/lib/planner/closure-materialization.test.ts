import { describe, expect, test } from "bun:test";

import {
  buildEffectiveClosures,
  materializeCustomClosures,
} from "@/lib/planner/closure-materialization";
import type { CustomClosure, HolidaySource, Project } from "@/lib/planner/types";

const fixedNow = new Date("2026-03-24T10:00:00");

const holidaySources: HolidaySource[] = [
  {
    id: "holiday-fr",
    code: "FR",
    labelFr: "Jours feries France",
    enabled: true,
  },
];

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

function makeCustomClosure(overrides: Partial<CustomClosure> = {}): CustomClosure {
  return {
    id: overrides.id ?? "closure-1",
    title: overrides.title ?? "Closure",
    type: overrides.type ?? "company_closure",
    startDate: overrides.startDate ?? "2026-08-12",
    endDate: overrides.endDate ?? "2026-08-16",
    impact: overrides.impact ?? "blocking",
    details: overrides.details,
    repeatsAnnually: overrides.repeatsAnnually ?? false,
  };
}

describe("closure materialization", () => {
  test("keeps non recurring custom closures as single effective instances", () => {
    const materialized = materializeCustomClosures(
      [makeCustomClosure({ repeatsAnnually: false })],
      [2025, 2026, 2027]
    );

    expect(materialized).toHaveLength(1);
    expect(materialized[0]?.id).toBe("closure-1");
  });

  test("expands recurring custom closures for every visible year", () => {
    const materialized = materializeCustomClosures(
      [makeCustomClosure({ repeatsAnnually: true })],
      [2025, 2026, 2027]
    );

    expect(materialized.map((closure) => closure.id)).toEqual([
      "closure-1::2025",
      "closure-1::2026",
      "closure-1::2027",
    ]);
    expect(materialized[2]?.startDate).toBe("2027-08-12");
    expect(materialized[2]?.endDate).toBe("2027-08-16");
  });

  test("preserves cross-year recurring spans", () => {
    const materialized = materializeCustomClosures(
      [
        makeCustomClosure({
          id: "cross-year",
          startDate: "2026-12-29",
          endDate: "2027-01-02",
          repeatsAnnually: true,
        }),
      ],
      [2028]
    );

    expect(materialized[0]).toMatchObject({
      id: "cross-year::2028",
      startDate: "2028-12-29",
      endDate: "2029-01-02",
    });
  });

  test("builds public holidays for every visible year in the planner range", () => {
    const closures = buildEffectiveClosures({
      projects: [
        makeProject({ targetDateHint: "2026-06-11" }),
        makeProject({
          id: "scheduled-2027",
          status: "scheduled",
          plannedTeam: "team-a",
          estimatedDurationHalfDays: 3,
          scheduledTeam: "team-a",
          scheduledStartSlot: "2027-02-02-AM",
          scheduledDurationHalfDays: 3,
          sequenceOrder: 0,
        }),
      ],
      holidaySources,
      customClosures: [],
      now: fixedNow,
    });

    expect(closures.some((closure) => closure.id === "fr-2025-new-year")).toBe(true);
    expect(closures.some((closure) => closure.id === "fr-2026-new-year")).toBe(true);
    expect(closures.some((closure) => closure.id === "fr-2027-new-year")).toBe(true);
    expect(closures.some((closure) => closure.id === "fr-2028-new-year")).toBe(true);
  });
});
