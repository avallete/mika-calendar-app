import { describe, expect, test } from "bun:test";

import {
  buildFrancePublicHolidays,
  getCoveredYears,
} from "@/lib/planner/france-holidays";
import { collectTimelineRelevantDates } from "@/lib/planner/timeline-range";

describe("france holidays", () => {
  test("builds known France public holidays for 2026", () => {
    const holidays = buildFrancePublicHolidays(2026);
    const byId = new Map(holidays.map((holiday) => [holiday.id, holiday]));

    expect(byId.get("fr-2026-new-year")?.startDate).toBe("2026-01-01");
    expect(byId.get("fr-2026-easter-monday")?.startDate).toBe("2026-04-06");
    expect(byId.get("fr-2026-ascension")?.startDate).toBe("2026-05-14");
    expect(byId.get("fr-2026-whit-monday")?.startDate).toBe("2026-05-25");
    expect(byId.get("fr-2026-christmas")?.startDate).toBe("2026-12-25");
  });

  test("derives a sorted year set from planner dates", () => {
    expect(
      getCoveredYears(["2026-03-24", "2028-01-02", "2027-06-11", "2026-05-01"])
    ).toEqual([2026, 2027, 2028]);
  });

  test("builds public holidays for every covered planner year", () => {
    const coveredYears = getCoveredYears(
      collectTimelineRelevantDates(
        [
          {
            id: "draft-2026",
            title: "Projet 2026",
            status: "draft",
            plannedTeam: "team-a",
            estimatedDurationHalfDays: 2,
            targetDateHint: "2026-06-11",
          },
          {
            id: "scheduled-2027",
            title: "Projet 2027",
            status: "scheduled",
            plannedTeam: "team-a",
            estimatedDurationHalfDays: 3,
            scheduledTeam: "team-a",
            scheduledStartSlot: "2027-02-02-AM",
            scheduledDurationHalfDays: 3,
            sequenceOrder: 0,
          },
        ],
        []
      )
    );
    const holidays = coveredYears.flatMap((year) => buildFrancePublicHolidays(year));

    expect(coveredYears).toEqual([2026, 2027]);
    expect(holidays.some((holiday) => holiday.id === "fr-2026-new-year")).toBe(true);
    expect(holidays.some((holiday) => holiday.id === "fr-2027-new-year")).toBe(true);
  });
});
