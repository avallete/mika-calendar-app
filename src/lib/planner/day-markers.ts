import { format, getDay, parseISO } from "date-fns";
import { fr as localeFr } from "date-fns/locale";

import type {
  CalendarDayMarker,
  CalendarDayMarkerTone,
  CalendarDayState,
  ClosureImpact,
  ClosurePeriod,
  ClosureType,
} from "@/lib/planner/types";
import { isDateInsideClosure } from "@/lib/planner/calendar";

const closureTypeLabels: Record<ClosureType, string> = {
  holiday: "Jour ferie",
  company_closure: "Fermeture globale",
  custom_time_off: "Indisponibilite globale",
  weather: "Meteo",
  annotation: "Annotation",
};

const tonePriority: Record<Exclude<CalendarDayMarkerTone, "working">, number> = {
  "custom-blocking": 0,
  "public-holiday": 1,
  weekend: 2,
  advisory: 3,
};

function sortMarkers(left: CalendarDayMarker, right: CalendarDayMarker) {
  if (tonePriority[left.tone] !== tonePriority[right.tone]) {
    return tonePriority[left.tone] - tonePriority[right.tone];
  }

  if (left.impact !== right.impact) {
    return left.impact === "blocking" ? -1 : 1;
  }

  return left.title.localeCompare(right.title, "fr");
}

export function getClosureTypeLabelFr(type: ClosureType) {
  return closureTypeLabels[type];
}

export function getClosureImpactLabelFr(impact: ClosureImpact) {
  return impact === "blocking" ? "Bloquant" : "Indicatif";
}

export function getClosureTone(closure: ClosurePeriod): Exclude<CalendarDayMarkerTone, "working"> {
  if (closure.source === "fr-public-holiday") {
    return "public-holiday";
  }

  return closure.impact === "blocking" ? "custom-blocking" : "advisory";
}

export function closureToDayMarker(closure: ClosurePeriod): CalendarDayMarker {
  return {
    id: closure.id,
    title: closure.title,
    shortLabelFr:
      closure.source === "fr-public-holiday" ? "Ferie national" : getClosureTypeLabelFr(closure.type),
    type: closure.type,
    source: closure.source,
    impact: closure.impact,
    startDate: closure.startDate,
    endDate: closure.endDate,
    details: closure.details,
    tone: getClosureTone(closure),
  };
}

export function buildWeekendMarker(date: string): CalendarDayMarker {
  return {
    id: `weekend:${date}`,
    title: `Weekend ${format(parseISO(date), "EEEE d MMMM", { locale: localeFr })}`,
    shortLabelFr: "Weekend",
    type: "weekend",
    source: "derived",
    impact: "blocking",
    startDate: date,
    endDate: date,
    tone: "weekend",
  };
}

export function collectCalendarDayMarkers(date: string, closures: ClosurePeriod[]) {
  const markers = closures
    .filter((closure) => isDateInsideClosure(date, closure))
    .map(closureToDayMarker);

  const day = getDay(parseISO(date));
  if (day === 0 || day === 6) {
    markers.push(buildWeekendMarker(date));
  }

  return markers.sort(sortMarkers);
}

export function buildCalendarDayState(date: string, closures: ClosurePeriod[]): CalendarDayState {
  const markers = collectCalendarDayMarkers(date, closures);
  const isBlocking = markers.some((marker) => marker.impact === "blocking");

  return {
    date,
    markers,
    isBlocking,
    tone: markers[0]?.tone ?? "working",
  };
}
