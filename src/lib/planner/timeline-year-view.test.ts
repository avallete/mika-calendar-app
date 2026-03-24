import { describe, expect, test } from "bun:test";

import {
  buildYearSectionRenderData,
  getDayHeaderTooltipState,
  getVirtualizedMonthTranslateY,
} from "@/lib/planner/timeline-year-view";
import type { ClosurePeriod, YearMonthSection } from "@/lib/planner/types";

function makeSection(overrides: Partial<YearMonthSection> = {}): YearMonthSection {
  return {
    id: overrides.id ?? "2026-01",
    year: overrides.year ?? 2026,
    label: overrides.label ?? "janvier 2026",
    startDate: overrides.startDate ?? "2026-01-01",
    endDate: overrides.endDate ?? "2026-01-31",
    dayCount: overrides.dayCount ?? 31,
  };
}

function makeClosure(overrides: Partial<ClosurePeriod> = {}): ClosurePeriod {
  return {
    id: overrides.id ?? "closure-1",
    title: overrides.title ?? "Closure",
    type: overrides.type ?? "company_closure",
    startDate: overrides.startDate ?? "2026-01-02",
    endDate: overrides.endDate ?? overrides.startDate ?? "2026-01-02",
    impact: overrides.impact ?? "blocking",
    details: overrides.details,
    source: overrides.source ?? "custom",
    editable: overrides.editable ?? true,
  };
}

describe("timeline year view helpers", () => {
  test("subtracts the scroll margin from a virtualized item offset", () => {
    expect(getVirtualizedMonthTranslateY(1480, 320)).toBe(1160);
  });

  test("does not introduce a top gap when the first item starts at the scroll margin", () => {
    expect(getVirtualizedMonthTranslateY(420, 420)).toBe(0);
  });

  test("builds ordered render metadata for each section", () => {
    const sections = [
      makeSection(),
      makeSection({
        id: "2026-02",
        label: "fevrier 2026",
        startDate: "2026-02-01",
        endDate: "2026-02-28",
        dayCount: 28,
      }),
    ];

    const renderData = buildYearSectionRenderData(sections, []);

    expect(renderData.map((entry) => entry.section.id)).toEqual(["2026-01", "2026-02"]);
    expect(renderData[0]?.days).toHaveLength(31);
    expect(renderData[1]?.days).toHaveLength(28);
    expect(renderData[0]?.days[0]).toBe("2026-01-01");
    expect(renderData[1]?.days.at(-1)).toBe("2026-02-28");
  });

  test("includes closure-aware day states for each rendered section", () => {
    const renderData = buildYearSectionRenderData(
      [makeSection()],
      [makeClosure({ startDate: "2026-01-12", endDate: "2026-01-12" })]
    );

    const blockingDay = renderData[0]?.dayStates["2026-01-12"];
    const ordinaryDay = renderData[0]?.dayStates["2026-01-13"];

    expect(blockingDay?.isBlocking).toBe(true);
    expect(blockingDay?.markers.length).toBeGreaterThan(0);
    expect(ordinaryDay?.date).toBe("2026-01-13");
  });

  test("returns tooltip state for marked days only", () => {
    const renderData = buildYearSectionRenderData(
      [makeSection()],
      [makeClosure({ startDate: "2026-01-12", endDate: "2026-01-12" })]
    );

    expect(getDayHeaderTooltipState(renderData[0]!.dayStates["2026-01-12"])).toBe(
      renderData[0]!.dayStates["2026-01-12"]
    );
    expect(getDayHeaderTooltipState(renderData[0]!.dayStates["2026-01-13"])).toBeNull();
  });

  test("suppresses header tooltips while dragging", () => {
    const renderData = buildYearSectionRenderData(
      [makeSection()],
      [makeClosure({ startDate: "2026-01-12", endDate: "2026-01-12" })]
    );

    expect(getDayHeaderTooltipState(renderData[0]!.dayStates["2026-01-12"], true)).toBeNull();
  });
});
