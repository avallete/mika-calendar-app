import { eachDayOfInterval, format, parseISO } from "date-fns";

import {
  buildCalendarDayState,
  shouldShowDayTooltip,
} from "@/lib/planner/day-markers";
import type {
  CalendarDayState,
  ClosurePeriod,
  YearMonthSection,
} from "@/lib/planner/types";

export type YearSectionRenderData = {
  section: YearMonthSection;
  days: string[];
  dayStates: Record<string, CalendarDayState>;
};

export type YearSectionRenderCache = {
  key: string;
  dataBySectionId: Map<string, YearSectionRenderData>;
};

export function buildSectionDays(section: YearMonthSection) {
  return eachDayOfInterval({
    start: parseISO(section.startDate),
    end: parseISO(section.endDate),
  }).map((value) => format(value, "yyyy-MM-dd"));
}

export function buildSectionDayStates(days: string[], closures: ClosurePeriod[]) {
  return Object.fromEntries(days.map((date) => [date, buildCalendarDayState(date, closures)]));
}

export function buildYearSectionRenderData(
  sections: YearMonthSection[],
  closures: ClosurePeriod[]
): YearSectionRenderData[] {
  return sections.map((section) => {
    const days = buildSectionDays(section);

    return {
      section,
      days,
      dayStates: buildSectionDayStates(days, closures),
    };
  });
}

export function buildYearSectionRenderCacheKey(
  sections: YearMonthSection[],
  closures: ClosurePeriod[]
) {
  const sectionKey = sections
    .map(
      (section) =>
        `${section.id}:${section.startDate}:${section.endDate}:${section.dayCount}`
    )
    .join("|");
  const closureKey = closures
    .map((closure) =>
      JSON.stringify({
        id: closure.id,
        title: closure.title,
        type: closure.type,
        startDate: closure.startDate,
        endDate: closure.endDate,
        impact: closure.impact,
        details: closure.details ?? null,
        source: closure.source,
        editable: closure.editable,
      })
    )
    .join("|");

  return `${sectionKey}__${closureKey}`;
}

export function resolveYearSectionRenderCache(
  previousCache: YearSectionRenderCache | null,
  sections: YearMonthSection[],
  closures: ClosurePeriod[]
) {
  const key = buildYearSectionRenderCacheKey(sections, closures);
  if (previousCache?.key === key) {
    return previousCache;
  }

  return {
    key,
    dataBySectionId: new Map(
      buildYearSectionRenderData(sections, closures).map((entry) => [
        entry.section.id,
        entry,
      ] as const)
    ),
  } satisfies YearSectionRenderCache;
}

export function getVirtualizedMonthTranslateY(itemStart: number, scrollMargin: number) {
  return itemStart - scrollMargin;
}

export function getDayHeaderTooltipState(
  dayState: CalendarDayState,
  dragActive = false
) {
  if (dragActive || !shouldShowDayTooltip(dayState)) {
    return null;
  }

  return dayState;
}
