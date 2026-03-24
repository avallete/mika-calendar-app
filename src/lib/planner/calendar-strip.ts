import { parseISO } from "date-fns";

import type {
  ClosurePeriod,
  CustomClosure,
  HolidaySource,
} from "@/lib/planner/types";

export type CalendarFocusTarget = {
  id: string;
  startDate: string;
  endDate: string;
};

export type CalendarStripYearGroup<T> = {
  year: number;
  items: T[];
};

export type FranceHolidayStripSummary = {
  code: string;
  labelFr: string;
  closureCount: number;
  startYear: number | null;
  endYear: number | null;
  upcomingClosures: ClosurePeriod[];
  upcomingYearGroups: CalendarStripYearGroup<ClosurePeriod>[];
};

function compareByDateRange(left: ClosurePeriod, right: ClosurePeriod) {
  if (left.startDate !== right.startDate) {
    return left.startDate.localeCompare(right.startDate);
  }

  if (left.endDate !== right.endDate) {
    return left.endDate.localeCompare(right.endDate);
  }

  return left.title.localeCompare(right.title, "fr");
}

function compareFocusCandidates(
  left: ClosurePeriod,
  right: ClosurePeriod,
  activeDate: string
) {
  const activeTime = parseISO(activeDate).getTime();
  const leftDiff = Math.abs(parseISO(left.startDate).getTime() - activeTime);
  const rightDiff = Math.abs(parseISO(right.startDate).getTime() - activeTime);

  if (leftDiff !== rightDiff) {
    return leftDiff - rightDiff;
  }

  const activeYear = parseISO(activeDate).getFullYear();
  const leftYear = parseISO(left.startDate).getFullYear();
  const rightYear = parseISO(right.startDate).getFullYear();
  const leftSameYear = leftYear === activeYear ? 1 : 0;
  const rightSameYear = rightYear === activeYear ? 1 : 0;

  if (leftSameYear !== rightSameYear) {
    return rightSameYear - leftSameYear;
  }

  return compareByDateRange(left, right);
}

function isIncomingRange(endDate: string, todayDate: string) {
  return endDate >= todayDate;
}

function isIncomingRangeInCurrentYear(
  closure: ClosurePeriod,
  todayDate: string
) {
  return (
    isIncomingRange(closure.endDate, todayDate) &&
    parseISO(closure.startDate).getFullYear() === parseISO(todayDate).getFullYear()
  );
}

function groupClosuresByYear(
  closures: ClosurePeriod[]
): CalendarStripYearGroup<ClosurePeriod>[] {
  const groups = new Map<number, ClosurePeriod[]>();

  for (const closure of closures) {
    const year = parseISO(closure.startDate).getFullYear();
    const current = groups.get(year) ?? [];
    current.push(closure);
    groups.set(year, current);
  }

  return [...groups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([year, items]) => ({
      year,
      items: items.sort(compareByDateRange),
    }));
}

function getIncomingCustomClosureOccurrences(params: {
  closure: CustomClosure;
  closures: ClosurePeriod[];
  todayDate: string;
}) {
  const { closure, closures, todayDate } = params;

  return closures
    .filter(
      (effectiveClosure) =>
        effectiveClosure.source === "custom" &&
        isIncomingRange(effectiveClosure.endDate, todayDate) &&
        (effectiveClosure.id === closure.id ||
          effectiveClosure.id.startsWith(`${closure.id}::`))
    )
    .sort(compareByDateRange);
}

export function buildFranceHolidayStripSummary(params: {
  holidaySources: HolidaySource[];
  closures: ClosurePeriod[];
  todayDate: string;
}) {
  const { holidaySources, closures, todayDate } = params;
  const franceSource = holidaySources.find(
    (source) => source.code === "FR" && source.enabled
  );

  if (!franceSource) {
    return null;
  }

  const upcomingClosures = closures
    .filter(
      (closure) =>
        closure.source === "fr-public-holiday" &&
        isIncomingRangeInCurrentYear(closure, todayDate)
    )
    .sort(compareByDateRange);

  if (!upcomingClosures.length) {
    return null;
  }

  const coveredYears = upcomingClosures.flatMap((closure) => [
    parseISO(closure.startDate).getFullYear(),
    parseISO(closure.endDate).getFullYear(),
  ]);

  return {
    code: franceSource.code,
    labelFr: franceSource.labelFr,
    closureCount: upcomingClosures.length,
    startYear: coveredYears.length ? Math.min(...coveredYears) : null,
    endYear: coveredYears.length ? Math.max(...coveredYears) : null,
    upcomingClosures,
    upcomingYearGroups: groupClosuresByYear(upcomingClosures),
  } satisfies FranceHolidayStripSummary;
}

export function shouldShowCustomClosureInStrip(params: {
  closure: CustomClosure;
  closures: ClosurePeriod[];
  todayDate: string;
}) {
  const { closure, closures, todayDate } = params;

  if (!closure.repeatsAnnually) {
    return isIncomingRange(closure.endDate, todayDate);
  }

  return getIncomingCustomClosureOccurrences({
    closure,
    closures,
    todayDate,
  }).length > 0;
}

export function getNextCustomClosureOccurrence(params: {
  closure: CustomClosure;
  closures: ClosurePeriod[];
  todayDate: string;
}) {
  const { closure, closures, todayDate } = params;

  return (
    getIncomingCustomClosureOccurrences({
      closure,
      closures,
      todayDate,
    })[0] ?? null
  );
}

export function resolveCustomClosureFocusTarget(params: {
  closure: CustomClosure;
  closures: ClosurePeriod[];
  activeDate: string;
  todayDate: string;
}) {
  const { closure, closures, activeDate, todayDate } = params;
  const matchingClosures = getIncomingCustomClosureOccurrences({
    closure,
    closures,
    todayDate,
  }).sort((left, right) => compareFocusCandidates(left, right, activeDate));

  const resolved = matchingClosures[0];
  if (resolved) {
    return {
      id: resolved.id,
      startDate: resolved.startDate,
      endDate: resolved.endDate,
    } satisfies CalendarFocusTarget;
  }

  if (isIncomingRange(closure.endDate, todayDate)) {
    return {
      id: closure.id,
      startDate: closure.startDate,
      endDate: closure.endDate,
    } satisfies CalendarFocusTarget;
  }

  return null;
}
