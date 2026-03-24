import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { fr as localeFr } from "date-fns/locale";

import type { Project, YearMonthSection } from "@/lib/planner/types";
import { isScheduledProject } from "@/lib/planner/types";

export type TimelineYearRange = {
  startYear: number;
  endYear: number;
  years: number[];
};

export type TimelineDateRange = {
  startDate: string;
  endDate: string;
};

export function getTodayDateString(now: Date = new Date()) {
  return format(now, "yyyy-MM-dd");
}

export function collectTimelineRelevantDates(
  projects: Project[],
  ranges: TimelineDateRange[]
) {
  return [
    ...projects.flatMap((project) => {
      const values: string[] = [];
      if (project.targetDateHint) {
        values.push(project.targetDateHint);
      }
      if (isScheduledProject(project)) {
        values.push(project.scheduledStartSlot.slice(0, 10));
      }
      return values;
    }),
    ...ranges.flatMap((range) => [range.startDate, range.endDate]),
  ].filter((value): value is string => Boolean(value));
}

export function buildTimelineYearRange(
  projects: Project[],
  ranges: TimelineDateRange[],
  now: Date = new Date(),
  bufferYears = 1
): TimelineYearRange {
  const relevantDates = collectTimelineRelevantDates(projects, ranges);
  const fallbackYear = now.getFullYear();
  const coveredYears = relevantDates.map((date) => parseISO(date).getFullYear());
  const minYear = coveredYears.length ? Math.min(...coveredYears) : fallbackYear;
  const maxYear = coveredYears.length ? Math.max(...coveredYears) : fallbackYear;
  const startYear = minYear - bufferYears;
  const endYear = maxYear + bufferYears;

  return {
    startYear,
    endYear,
    years: Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index),
  };
}

export function buildTimelineSections(
  projects: Project[],
  ranges: TimelineDateRange[],
  now: Date = new Date(),
  bufferYears = 1
): YearMonthSection[] {
  const { years } = buildTimelineYearRange(projects, ranges, now, bufferYears);

  return years.flatMap((year) =>
    Array.from({ length: 12 }, (_, index) => {
      const monthStart = startOfMonth(new Date(year, index, 1));
      const monthEnd = endOfMonth(monthStart);

      return {
        id: `${year}-${String(index + 1).padStart(2, "0")}`,
        year,
        label: format(monthStart, "MMMM yyyy", { locale: localeFr }),
        startDate: format(monthStart, "yyyy-MM-dd"),
        endDate: format(monthEnd, "yyyy-MM-dd"),
        dayCount: monthEnd.getDate(),
      } satisfies YearMonthSection;
    })
  );
}
