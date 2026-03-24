import { describe, expect, test } from "bun:test";

import {
  buildFrancePublicHolidays,
  getCoveredYears,
} from "@/lib/planner/france-holidays";

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
});
