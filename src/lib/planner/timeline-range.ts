import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { fr as localeFr } from "date-fns/locale";

import type { ClosurePeriod, Project, YearMonthSection } from "@/lib/planner/types";
import { isScheduledProject } from "@/lib/planner/types";

export type TimelineYearRange = {
  startYear: number;
  endYear: number;
  years: number[];
};

export function getTodayDateString(now: Date = new Date()) {
  return format(now, "yyyy-MM-dd");
}

export function collectTimelineRelevantDates(projects: Project[], closures: ClosurePeriod[]) {
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
    ...closures.flatMap((closure) => [closure.startDate, closure.endDate]),
  ].filter((value): value is string => Boolean(value));
}

export function buildTimelineYearRange(
  projects: Project[],
  closures: ClosurePeriod[],
  now: Date = new Date(),
  bufferYears = 1
): TimelineYearRange {
  const relevantDates = collectTimelineRelevantDates(projects, closures);
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
  closures: ClosurePeriod[],
  now: Date = new Date(),
  bufferYears = 1
): YearMonthSection[] {
  const { years } = buildTimelineYearRange(projects, closures, now, bufferYears);

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
