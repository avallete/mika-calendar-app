import { addMonths, addYears, format, parseISO } from "date-fns";

import { advanceWorkingDuration, parseSlotKey, previousCalendarSlot } from "@/lib/planner/calendar";
import type { ProjectScheduleSpan } from "@/lib/planner/planner-computed";
import type {
  ClosurePeriod,
  Project,
  TimelineViewMode,
  YearMonthSection,
} from "@/lib/planner/types";
import { isScheduledProject } from "@/lib/planner/types";

export type TimelineMonthSummary = {
  section: YearMonthSection;
  projectCount: number;
  closureCount: number;
  containsToday: boolean;
  containsFocus: boolean;
  isActive: boolean;
};

export type TimelineYearSummary = {
  year: number;
  projectCount: number;
  closureCount: number;
  containsToday: boolean;
  containsFocus: boolean;
  isActive: boolean;
  months: TimelineMonthSummary[];
};

function overlapsRange(
  rangeStart: string,
  rangeEnd: string,
  sectionStart: string,
  sectionEnd: string
) {
  return rangeStart <= sectionEnd && rangeEnd >= sectionStart;
}

function getScheduledProjectRanges(
  projects: Project[],
  closures: ClosurePeriod[],
  projectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null
) {
  return projects.filter(isScheduledProject).map((project) => {
    const computed =
      projectSpanById?.get(project.id) ??
      advanceWorkingDuration(
        project.scheduledStartSlot,
        project.scheduledDurationHalfDays,
        closures
      );

    return {
      id: project.id,
      startDate: parseSlotKey(project.scheduledStartSlot).date,
      endDate: parseSlotKey(previousCalendarSlot(computed.calendarEndSlot)).date,
    };
  });
}

export function getTimelineMonthId(date: string) {
  return date.slice(0, 7);
}

export function shiftTimelineDate(
  activeDate: string,
  viewMode: TimelineViewMode,
  amount: number
) {
  const baseDate = parseISO(activeDate);
  return format(
    viewMode === "month" ? addMonths(baseDate, amount) : addYears(baseDate, amount),
    "yyyy-MM-dd"
  );
}

export function buildTimelineYearSummaries(params: {
  sections: YearMonthSection[];
  projects: Project[];
  closures: ClosurePeriod[];
  projectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null;
  activeDate: string;
  todayDate: string;
  focusDate?: string | null;
  viewMode: TimelineViewMode;
}) {
  const {
    sections,
    projects,
    closures,
    projectSpanById,
    activeDate,
    todayDate,
    focusDate,
    viewMode,
  } = params;
  const activeMonthId = getTimelineMonthId(activeDate);
  const activeYear = parseISO(activeDate).getFullYear();
  const projectRanges = getScheduledProjectRanges(projects, closures, projectSpanById);
  const groupedSections = new Map<number, YearMonthSection[]>();

  for (const section of sections) {
    const current = groupedSections.get(section.year) ?? [];
    current.push(section);
    groupedSections.set(section.year, current);
  }

  return [...groupedSections.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([year, yearSections]) => {
      const months = yearSections.map((section) => {
        const projectCount = projectRanges.filter((projectRange) =>
          overlapsRange(projectRange.startDate, projectRange.endDate, section.startDate, section.endDate)
        ).length;
        const closureCount = closures.filter((closure) =>
          overlapsRange(closure.startDate, closure.endDate, section.startDate, section.endDate)
        ).length;

        return {
          section,
          projectCount,
          closureCount,
          containsToday: todayDate >= section.startDate && todayDate <= section.endDate,
          containsFocus: Boolean(
            focusDate && focusDate >= section.startDate && focusDate <= section.endDate
          ),
          isActive: section.id === activeMonthId,
        } satisfies TimelineMonthSummary;
      });

      return {
        year,
        projectCount: months.reduce((sum, month) => sum + month.projectCount, 0),
        closureCount: months.reduce((sum, month) => sum + month.closureCount, 0),
        containsToday: months.some((month) => month.containsToday),
        containsFocus: months.some((month) => month.containsFocus),
        isActive: viewMode === "year" ? year === activeYear : months.some((month) => month.isActive),
        months,
      } satisfies TimelineYearSummary;
    });
}
