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
