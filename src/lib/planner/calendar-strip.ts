import { parseISO } from "date-fns";

import type {
  ClosurePeriod,
  CustomClosure,
  HolidaySource,
} from "@/lib/planner/types";

export type FranceHolidayStripSummary = {
  code: string;
  labelFr: string;
  closureCount: number;
  startYear: number | null;
  endYear: number | null;
};

export type CalendarFocusTarget = {
  id: string;
  startDate: string;
  endDate: string;
};

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

  if (left.startDate !== right.startDate) {
    return left.startDate.localeCompare(right.startDate);
  }

  return left.endDate.localeCompare(right.endDate);
}

export function buildFranceHolidayStripSummary(params: {
  holidaySources: HolidaySource[];
  closures: ClosurePeriod[];
}) {
  const { holidaySources, closures } = params;
  const franceSource = holidaySources.find(
    (source) => source.code === "FR" && source.enabled
  );

  if (!franceSource) {
    return null;
  }

  const franceClosures = closures.filter(
    (closure) => closure.source === "fr-public-holiday"
  );
  const coveredYears = franceClosures.flatMap((closure) => [
    parseISO(closure.startDate).getFullYear(),
    parseISO(closure.endDate).getFullYear(),
  ]);

  return {
    code: franceSource.code,
    labelFr: franceSource.labelFr,
    closureCount: franceClosures.length,
    startYear: coveredYears.length ? Math.min(...coveredYears) : null,
    endYear: coveredYears.length ? Math.max(...coveredYears) : null,
  } satisfies FranceHolidayStripSummary;
}

export function resolveCustomClosureFocusTarget(params: {
  closure: CustomClosure;
  closures: ClosurePeriod[];
  activeDate: string;
}) {
  const { closure, closures, activeDate } = params;
  const matchingClosures = closures
    .filter(
      (effectiveClosure) =>
        effectiveClosure.source === "custom" &&
        (effectiveClosure.id === closure.id ||
          effectiveClosure.id.startsWith(`${closure.id}::`))
    )
    .sort((left, right) => compareFocusCandidates(left, right, activeDate));

  const resolved = matchingClosures[0];
  if (!resolved) {
    return {
      id: closure.id,
      startDate: closure.startDate,
      endDate: closure.endDate,
    } satisfies CalendarFocusTarget;
  }

  return {
    id: resolved.id,
    startDate: resolved.startDate,
    endDate: resolved.endDate,
  } satisfies CalendarFocusTarget;
}
