import { getTodayDateString } from "@/lib/planner/timeline-range";
import type { TimelineViewMode } from "@/lib/planner/types";

export const PLANNER_VIEWPORT_PREFERENCES_STORAGE_KEY =
  "planner-viewport-preferences";
export const PLANNER_VIEWPORT_PREFERENCES_COOKIE_NAME =
  "planner-viewport-preferences";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type PlannerViewportPreferences = {
  activeDate: string;
  viewMode: TimelineViewMode;
  traceEnabled: boolean;
  holidayListExpanded: boolean;
};

export function getDefaultPlannerViewportPreferences(
  now: Date = new Date()
): PlannerViewportPreferences {
  return {
    activeDate: getTodayDateString(now),
    viewMode: "month",
    traceEnabled: false,
    holidayListExpanded: false,
  };
}

function isTimelineViewMode(value: unknown): value is TimelineViewMode {
  return value === "month" || value === "year";
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizePlannerViewportPreferences(
  value: unknown,
  fallback: PlannerViewportPreferences = getDefaultPlannerViewportPreferences()
): PlannerViewportPreferences {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as Partial<PlannerViewportPreferences>;

  return {
    activeDate: isDateString(candidate.activeDate)
      ? candidate.activeDate
      : fallback.activeDate,
    viewMode: isTimelineViewMode(candidate.viewMode)
      ? candidate.viewMode
      : fallback.viewMode,
    traceEnabled:
      typeof candidate.traceEnabled === "boolean"
        ? candidate.traceEnabled
        : fallback.traceEnabled,
    holidayListExpanded:
      typeof candidate.holidayListExpanded === "boolean"
        ? candidate.holidayListExpanded
        : fallback.holidayListExpanded,
  };
}

export function arePlannerViewportPreferencesEqual(
  left: PlannerViewportPreferences,
  right: PlannerViewportPreferences
) {
  return (
    left.activeDate === right.activeDate &&
    left.viewMode === right.viewMode &&
    left.traceEnabled === right.traceEnabled &&
    left.holidayListExpanded === right.holidayListExpanded
  );
}

function parsePlannerViewportPreferences(
  serialized: string | null | undefined,
  fallback: PlannerViewportPreferences,
  decode: boolean
) {
  if (!serialized) {
    return fallback;
  }

  try {
    const raw = decode ? decodeURIComponent(serialized) : serialized;
    return normalizePlannerViewportPreferences(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

export function readPlannerViewportPreferencesFromCookie(
  serialized: string | null | undefined,
  fallback: PlannerViewportPreferences = getDefaultPlannerViewportPreferences()
) {
  return parsePlannerViewportPreferences(serialized, fallback, true);
}

export function readPlannerViewportPreferencesFromLocalStorage(
  fallback: PlannerViewportPreferences = getDefaultPlannerViewportPreferences()
) {
  if (typeof window === "undefined") {
    return fallback;
  }

  return parsePlannerViewportPreferences(
    window.localStorage.getItem(PLANNER_VIEWPORT_PREFERENCES_STORAGE_KEY),
    fallback,
    false
  );
}

export function writePlannerViewportPreferences(
  preferences: PlannerViewportPreferences
) {
  if (typeof window === "undefined") {
    return;
  }

  const serialized = JSON.stringify(preferences);
  window.localStorage.setItem(
    PLANNER_VIEWPORT_PREFERENCES_STORAGE_KEY,
    serialized
  );
  document.cookie = `${PLANNER_VIEWPORT_PREFERENCES_COOKIE_NAME}=${encodeURIComponent(
    serialized
  )}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}
