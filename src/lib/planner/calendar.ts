import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  getDay,
  isAfter,
  isBefore,
  parseISO,
} from "date-fns";

import type { ClosurePeriod, SlotKey, SlotPart, ZoomLevel } from "@/lib/planner/types";

export const PART_SEQUENCE: SlotPart[] = ["AM", "PM"];

export type ParsedSlot = {
  date: string;
  part: SlotPart;
};

export function makeSlotKey(date: string, part: SlotPart): SlotKey {
  return `${date}-${part}`;
}

export function parseSlotKey(slotKey: SlotKey): ParsedSlot {
  const date = slotKey.slice(0, 10);
  const part = slotKey.endsWith("-PM") ? "PM" : "AM";
  return { date, part };
}

export function compareSlotKeys(a: SlotKey, b: SlotKey) {
  const parsedA = parseSlotKey(a);
  const parsedB = parseSlotKey(b);

  if (parsedA.date === parsedB.date) {
    return PART_SEQUENCE.indexOf(parsedA.part) - PART_SEQUENCE.indexOf(parsedB.part);
  }

  return parsedA.date.localeCompare(parsedB.date);
}

export function maxSlotKey(...values: SlotKey[]) {
  return values.sort(compareSlotKeys).at(-1) ?? values[0];
}

export function nextCalendarSlot(slotKey: SlotKey): SlotKey {
  const { date, part } = parseSlotKey(slotKey);

  if (part === "AM") {
    return makeSlotKey(date, "PM");
  }

  return makeSlotKey(format(addDays(parseISO(date), 1), "yyyy-MM-dd"), "AM");
}

export function previousCalendarSlot(slotKey: SlotKey): SlotKey {
  const { date, part } = parseSlotKey(slotKey);

  if (part === "PM") {
    return makeSlotKey(date, "AM");
  }

  return makeSlotKey(format(addDays(parseISO(date), -1), "yyyy-MM-dd"), "PM");
}

export function isDateInsideClosure(date: string, closure: ClosurePeriod) {
  const value = parseISO(date);
  return !isBefore(value, parseISO(closure.startDate)) && !isAfter(value, parseISO(closure.endDate));
}

export function isNonWorkingDate(date: string, closures: ClosurePeriod[]) {
  const day = getDay(parseISO(date));
  if (day === 0 || day === 6) {
    return true;
  }

  return closures.some((closure) => isDateInsideClosure(date, closure));
}

export function normalizeToWorkingSlot(slotKey: SlotKey, closures: ClosurePeriod[]) {
  let cursor = slotKey;

  while (isNonWorkingDate(parseSlotKey(cursor).date, closures)) {
    const nextDate = format(addDays(parseISO(parseSlotKey(cursor).date), 1), "yyyy-MM-dd");
    cursor = makeSlotKey(nextDate, "AM");
  }

  return cursor;
}

export function advanceWorkingDuration(
  requestedStart: SlotKey,
  durationHalfDays: number,
  closures: ClosurePeriod[]
) {
  let cursor = normalizeToWorkingSlot(requestedStart, closures);
  let remaining = Math.max(1, durationHalfDays);

  while (remaining > 0) {
    if (!isNonWorkingDate(parseSlotKey(cursor).date, closures)) {
      remaining -= 1;
    }

    cursor = nextCalendarSlot(cursor);
  }

  return {
    startSlot: normalizeToWorkingSlot(requestedStart, closures),
    calendarEndSlot: cursor,
    readySlot: normalizeToWorkingSlot(cursor, closures),
  };
}

export function addWorkingLag(
  startSlot: SlotKey,
  lagHalfDays: number,
  closures: ClosurePeriod[]
) {
  let cursor = normalizeToWorkingSlot(startSlot, closures);
  let remaining = lagHalfDays;

  while (remaining > 0) {
    cursor = nextCalendarSlot(cursor);
    if (!isNonWorkingDate(parseSlotKey(cursor).date, closures)) {
      remaining -= 1;
    }
  }

  return normalizeToWorkingSlot(cursor, closures);
}

export function slotIndexFromDate(startDate: string, slotKey: SlotKey) {
  const { date, part } = parseSlotKey(slotKey);
  const dayOffset = differenceInCalendarDays(parseISO(date), parseISO(startDate));
  return dayOffset * 2 + (part === "PM" ? 1 : 0);
}

export function slotKeyFromIndex(startDate: string, slotIndex: number): SlotKey {
  const date = format(addDays(parseISO(startDate), Math.floor(slotIndex / 2)), "yyyy-MM-dd");
  const part = slotIndex % 2 === 0 ? "AM" : "PM";
  return makeSlotKey(date, part);
}

export function buildVisibleDays(startDate: string, dayCount: number) {
  return eachDayOfInterval({
    start: parseISO(startDate),
    end: addDays(parseISO(startDate), dayCount - 1),
  }).map((value) => format(value, "yyyy-MM-dd"));
}

export function formatSlotLabel(slotKey: SlotKey, zoom: ZoomLevel) {
  const { date, part } = parseSlotKey(slotKey);
  const parsedDate = parseISO(date);

  if (zoom === "half-day") {
    return `${format(parsedDate, "dd MMM")} ${part}`;
  }

  if (zoom === "day") {
    return format(parsedDate, "EEE dd");
  }

  if (zoom === "week") {
    return format(parsedDate, "dd MMM");
  }

  if (zoom === "month") {
    return format(parsedDate, "MMM");
  }

  return format(parsedDate, "yyyy");
}
