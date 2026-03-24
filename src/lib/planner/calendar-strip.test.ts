import { describe, expect, test } from "bun:test";

import {
  buildFranceHolidayStripSummary,
  resolveCustomClosureFocusTarget,
} from "@/lib/planner/calendar-strip";
import type {
  ClosurePeriod,
  CustomClosure,
  HolidaySource,
} from "@/lib/planner/types";

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
  test("builds a single France holiday summary from materialized holidays", () => {
    expect(
      buildFranceHolidayStripSummary({
        holidaySources: [makeHolidaySource()],
        closures: [
          makeClosure({ startDate: "2025-01-01", endDate: "2025-01-01" }),
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
      })
    ).toEqual({
      code: "FR",
      labelFr: "Jours feries France",
      closureCount: 2,
      startYear: 2025,
      endYear: 2027,
    });
  });

  test("omits the France holiday summary when the source is disabled", () => {
    expect(
      buildFranceHolidayStripSummary({
        holidaySources: [makeHolidaySource({ enabled: false })],
        closures: [makeClosure()],
      })
    ).toBeNull();
  });

  test("resolves a recurring custom closure to the closest visible occurrence", () => {
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
            startDate: "2026-04-11",
            endDate: "2026-04-12",
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
        ],
        activeDate: "2026-12-20",
      })
    ).toEqual({
      id: "annual-close::2027",
      startDate: "2027-04-11",
      endDate: "2027-04-12",
    });
  });

  test("falls back to the template range when no materialized occurrence is available", () => {
    const closure = makeCustomClosure({
      id: "one-shot",
      startDate: "2026-07-08",
      endDate: "2026-07-09",
    });

    expect(
      resolveCustomClosureFocusTarget({
        closure,
        closures: [],
        activeDate: "2026-07-01",
      })
    ).toEqual({
      id: "one-shot",
      startDate: "2026-07-08",
      endDate: "2026-07-09",
    });
  });
});
