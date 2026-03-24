import { describe, expect, test } from "bun:test";

import {
  arePlannerViewportPreferencesEqual,
  getDefaultPlannerViewportPreferences,
  normalizePlannerViewportPreferences,
  readPlannerViewportPreferencesFromCookie,
} from "@/lib/planner/viewport-preferences";

describe("viewport preferences", () => {
  test("normalizes only supported viewport fields", () => {
    const fallback = getDefaultPlannerViewportPreferences(
      new Date("2026-03-24T10:00:00")
    );

    expect(
      normalizePlannerViewportPreferences(
        {
          activeDate: "2027-04-12",
          viewMode: "year",
          traceEnabled: true,
          holidayListExpanded: true,
          ignored: "value",
        },
        fallback
      )
    ).toEqual({
      activeDate: "2027-04-12",
      viewMode: "year",
      traceEnabled: true,
      holidayListExpanded: true,
    });
  });

  test("falls back when cookie content is invalid", () => {
    const fallback = getDefaultPlannerViewportPreferences(
      new Date("2026-03-24T10:00:00")
    );

    expect(readPlannerViewportPreferencesFromCookie("not-json", fallback)).toEqual(
      fallback
    );
  });

  test("decodes a persisted cookie payload", () => {
    const fallback = getDefaultPlannerViewportPreferences(
      new Date("2026-03-24T10:00:00")
    );
    const encoded = encodeURIComponent(
      JSON.stringify({
        activeDate: "2028-01-08",
        viewMode: "month",
        traceEnabled: true,
        holidayListExpanded: false,
      })
    );

    expect(readPlannerViewportPreferencesFromCookie(encoded, fallback)).toEqual({
      activeDate: "2028-01-08",
      viewMode: "month",
      traceEnabled: true,
      holidayListExpanded: false,
    });
  });

  test("compares viewport preferences by persisted fields", () => {
    const left = {
      activeDate: "2026-03-24",
      viewMode: "month" as const,
      traceEnabled: false,
      holidayListExpanded: false,
    };
    const right = {
      activeDate: "2026-03-24",
      viewMode: "month" as const,
      traceEnabled: false,
      holidayListExpanded: false,
    };
    const different = {
      ...right,
      traceEnabled: true,
    };

    expect(arePlannerViewportPreferencesEqual(left, right)).toBe(true);
    expect(arePlannerViewportPreferencesEqual(left, different)).toBe(false);
  });
});
