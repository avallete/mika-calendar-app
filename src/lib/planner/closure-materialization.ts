import {
  addDays,
  compareAsc,
  differenceInCalendarDays,
  endOfMonth,
  format,
  getDate,
  getMonth,
  getYear,
  parseISO,
} from "date-fns";

import { buildFrancePublicHolidays } from "@/lib/planner/france-holidays";
import { buildTimelineYearRange } from "@/lib/planner/timeline-range";
import type {
  ClosurePeriod,
  CustomClosure,
  HolidaySource,
  PlannerState,
  Project,
} from "@/lib/planner/types";

function sortEffectiveClosures(left: ClosurePeriod, right: ClosurePeriod) {
  if (left.startDate !== right.startDate) {
    return left.startDate.localeCompare(right.startDate);
  }

  if (left.endDate !== right.endDate) {
    return left.endDate.localeCompare(right.endDate);
  }

  if (left.source !== right.source) {
    return left.source.localeCompare(right.source);
  }

  return left.title.localeCompare(right.title, "fr");
}

function buildRecurringDate(templateDate: string, year: number) {
  const parsed = parseISO(templateDate);
  const month = getMonth(parsed);
  const day = getDate(parsed);
  const monthStart = new Date(year, month, 1);
  const maxDay = getDate(endOfMonth(monthStart));
  return new Date(year, month, Math.min(day, maxDay));
}

function materializeSingleCustomClosure(template: CustomClosure): ClosurePeriod {
  return {
    id: template.id,
    title: template.title,
    type: template.type,
    startDate: template.startDate,
    endDate: template.endDate,
    impact: template.impact,
    details: template.details,
    source: "custom",
    editable: true,
  };
}

function materializeRecurringCustomClosure(
  template: CustomClosure,
  year: number
): ClosurePeriod {
  const templateStart = parseISO(template.startDate);
  const templateEnd = parseISO(template.endDate);
  const startDate = buildRecurringDate(template.startDate, year);
  const durationDays = differenceInCalendarDays(templateEnd, templateStart);
  const endDate = addDays(startDate, durationDays);

  return {
    id: `${template.id}::${year}`,
    title: template.title,
    type: template.type,
    startDate: format(startDate, "yyyy-MM-dd"),
    endDate: format(endDate, "yyyy-MM-dd"),
    impact: template.impact,
    details: template.details,
    source: "custom",
    editable: true,
  };
}

export function materializeCustomClosures(
  customClosures: CustomClosure[],
  years: number[]
) {
  return customClosures.flatMap((closure) => {
    if (!closure.repeatsAnnually) {
      return [materializeSingleCustomClosure(closure)];
    }

    return years.map((year) => materializeRecurringCustomClosure(closure, year));
  });
}

export function buildEffectiveClosures(params: {
  projects: Project[];
  holidaySources: HolidaySource[];
  customClosures: CustomClosure[];
  now?: Date;
}) {
  const { projects, holidaySources, customClosures, now = new Date() } = params;
  const { years } = buildTimelineYearRange(projects, customClosures, now);
  const generatedClosures = holidaySources.flatMap((source) => {
    if (!source.enabled || source.code !== "FR") {
      return [];
    }

    return years.flatMap((year) => buildFrancePublicHolidays(year));
  });
  const materializedCustomClosures = materializeCustomClosures(customClosures, years);

  return [...generatedClosures, ...materializedCustomClosures].sort(sortEffectiveClosures);
}

export function materializePlannerState(
  state: PlannerState,
  now: Date = new Date()
): PlannerState {
  return {
    ...state,
    closures: buildEffectiveClosures({
      projects: state.projects,
      holidaySources: state.holidaySources,
      customClosures: state.customClosures,
      now,
    }),
  };
}

export function closureSpansYear(template: CustomClosure) {
  return compareAsc(parseISO(template.endDate), parseISO(template.startDate)) >= 0
    ? getYear(parseISO(template.startDate)) !== getYear(parseISO(template.endDate))
    : false;
}
