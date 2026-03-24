import { describe, expect, test } from "bun:test";

import {
  buildFranceHolidayStripSummary,
  getNextCustomClosureOccurrence,
  resolveCustomClosureFocusTarget,
  shouldShowCustomClosureInStrip,
} from "@/lib/planner/calendar-strip";
import type {
  ClosurePeriod,
  CustomClosure,
  HolidaySource,
} from "@/lib/planner/types";

const todayDate = "2026-03-24";

function makeHolidaySource(
  overrides: Partial<HolidaySource> = {}
): HolidaySource {
  return {
    id: overrides.id ?? "holiday-fr",
    code: overrides.code ?? "FR",
    labelFr: overrides.labelFr ?? "Jours feries France",
    enabled: overrides.enabled ?? true,
  };
}

function makeCustomClosure(
  overrides: Partial<CustomClosure> = {}
): CustomClosure {
  return {
    id: overrides.id ?? "closure-1",
    title: overrides.title ?? "Fermeture atelier",
    type: overrides.type ?? "company_closure",
    startDate: overrides.startDate ?? "2026-04-11",
    endDate: overrides.endDate ?? "2026-04-12",
    impact: overrides.impact ?? "blocking",
    details: overrides.details,
    repeatsAnnually: overrides.repeatsAnnually ?? false,
  };
}

function makeClosure(
  overrides: Partial<ClosurePeriod> = {}
): ClosurePeriod {
  return {
    id: overrides.id ?? "effective-closure-1",
    title: overrides.title ?? "Jour ferie",
    type: overrides.type ?? "holiday",
    startDate: overrides.startDate ?? "2026-05-01",
    endDate: overrides.endDate ?? overrides.startDate ?? "2026-05-01",
    impact: overrides.impact ?? "blocking",
    details: overrides.details,
    source: overrides.source ?? "fr-public-holiday",
    editable: overrides.editable ?? false,
  };
}

describe("calendar strip", () => {
  test("builds a future-filtered France holiday summary from materialized holidays", () => {
    expect(
      buildFranceHolidayStripSummary({
        holidaySources: [makeHolidaySource()],
        closures: [
          makeClosure({ startDate: "2026-01-01", endDate: "2026-01-01" }),
          makeClosure({ startDate: "2026-04-21", endDate: "2026-04-21" }),
          makeClosure({ startDate: "2027-12-25", endDate: "2027-12-25" }),
          makeClosure({
            id: "custom",
            title: "Formation",
            type: "custom_time_off",
            startDate: "2026-03-12",
            endDate: "2026-03-12",
            source: "custom",
            editable: true,
          }),
        ],
        todayDate,
      })
    ).toEqual({
      code: "FR",
      labelFr: "Jours feries France",
      closureCount: 1,
      startYear: 2026,
      endYear: 2026,
      upcomingClosures: [
        makeClosure({ startDate: "2026-04-21", endDate: "2026-04-21" }),
      ],
      upcomingYearGroups: [
        {
          year: 2026,
          items: [makeClosure({ startDate: "2026-04-21", endDate: "2026-04-21" })],
        },
      ],
    });
  });

  test("omits the France holiday summary when the source is disabled", () => {
    expect(
      buildFranceHolidayStripSummary({
        holidaySources: [makeHolidaySource({ enabled: false })],
        closures: [makeClosure()],
        todayDate,
      })
    ).toBeNull();
  });

  test("hides past one-shot custom closures from the strip", () => {
    expect(
      shouldShowCustomClosureInStrip({
        closure: makeCustomClosure({
          id: "past-one-shot",
          startDate: "2026-02-01",
          endDate: "2026-02-02",
          repeatsAnnually: false,
        }),
        closures: [],
        todayDate,
      })
    ).toBe(false);
  });

  test("keeps recurring custom closures visible only when they have a non-past occurrence", () => {
    const recurringClosure = makeCustomClosure({
      id: "annual-close",
      repeatsAnnually: true,
    });

    expect(
      shouldShowCustomClosureInStrip({
        closure: recurringClosure,
        closures: [
          makeClosure({
            id: "annual-close::2026",
            title: recurringClosure.title,
            type: recurringClosure.type,
            startDate: "2026-02-01",
            endDate: "2026-02-02",
            source: "custom",
            editable: true,
          }),
          makeClosure({
            id: "annual-close::2027",
            title: recurringClosure.title,
            type: recurringClosure.type,
            startDate: "2027-04-11",
            endDate: "2027-04-12",
            source: "custom",
            editable: true,
          }),
        ],
        todayDate,
      })
    ).toBe(true);
  });

  test("returns the next non-past occurrence for a recurring closure", () => {
    const recurringClosure = makeCustomClosure({
      id: "annual-close",
      repeatsAnnually: true,
    });

    expect(
      getNextCustomClosureOccurrence({
        closure: recurringClosure,
        closures: [
          makeClosure({
            id: "annual-close::2026",
            title: recurringClosure.title,
            type: recurringClosure.type,
            startDate: "2026-02-01",
            endDate: "2026-02-02",
            source: "custom",
            editable: true,
          }),
          makeClosure({
            id: "annual-close::2027",
            title: recurringClosure.title,
            type: recurringClosure.type,
            startDate: "2027-04-11",
            endDate: "2027-04-12",
            source: "custom",
            editable: true,
          }),
        ],
        todayDate,
      })
    ).toEqual(
      makeClosure({
        id: "annual-close::2027",
        title: recurringClosure.title,
        type: recurringClosure.type,
        startDate: "2027-04-11",
        endDate: "2027-04-12",
        source: "custom",
        editable: true,
      })
    );
  });

  test("resolves a recurring custom closure to the closest non-past occurrence", () => {
    const closure = makeCustomClosure({
      id: "annual-close",
      repeatsAnnually: true,
    });

    expect(
      resolveCustomClosureFocusTarget({
        closure,
        closures: [
          makeClosure({
            id: "annual-close::2026",
            title: closure.title,
            type: closure.type,
            startDate: "2026-02-01",
            endDate: "2026-02-02",
            source: "custom",
            editable: true,
          }),
          makeClosure({
            id: "annual-close::2027",
            title: closure.title,
            type: closure.type,
            startDate: "2027-04-11",
            endDate: "2027-04-12",
            source: "custom",
            editable: true,
          }),
          makeClosure({
            id: "annual-close::2028",
            title: closure.title,
            type: closure.type,
            startDate: "2028-04-11",
            endDate: "2028-04-12",
            source: "custom",
            editable: true,
          }),
        ],
        activeDate: "2027-12-20",
        todayDate,
      })
    ).toEqual({
      id: "annual-close::2028",
      startDate: "2028-04-11",
      endDate: "2028-04-12",
    });
  });

  test("returns null when only past occurrences remain", () => {
    expect(
      resolveCustomClosureFocusTarget({
        closure: makeCustomClosure({
          id: "past-recurring",
          startDate: "2026-02-01",
          endDate: "2026-02-02",
          repeatsAnnually: true,
        }),
        closures: [
          makeClosure({
            id: "past-recurring::2026",
            startDate: "2026-02-01",
            endDate: "2026-02-02",
            source: "custom",
            editable: true,
          }),
        ],
        activeDate: "2026-03-24",
        todayDate,
      })
    ).toBeNull();
  });
});
