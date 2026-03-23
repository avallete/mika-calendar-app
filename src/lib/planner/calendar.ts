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

export function shiftWorkingSlot(
  slotKey: SlotKey,
  offsetHalfDays: number,
  closures: ClosurePeriod[]
) {
  if (offsetHalfDays === 0) {
    return slotKey;
  }

  let cursor = slotKey;
  let remaining = Math.abs(offsetHalfDays);
  const step = offsetHalfDays > 0 ? nextCalendarSlot : previousCalendarSlot;

  while (remaining > 0) {
    cursor = step(cursor);
    if (!isNonWorkingDate(parseSlotKey(cursor).date, closures)) {
      remaining -= 1;
    }
  }

  return cursor;
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

export function nextWorkingDate(date: string, closures: ClosurePeriod[]) {
  let cursor = date;

  while (isNonWorkingDate(cursor, closures)) {
    cursor = format(addDays(parseISO(cursor), 1), "yyyy-MM-dd");
  }

  return cursor;
}

export function previousWorkingDate(date: string, closures: ClosurePeriod[]) {
  let cursor = date;

  while (isNonWorkingDate(cursor, closures)) {
    cursor = format(addDays(parseISO(cursor), -1), "yyyy-MM-dd");
  }

  return cursor;
}

export function normalizeToWorkingSlot(slotKey: SlotKey, closures: ClosurePeriod[]) {
  const { date } = parseSlotKey(slotKey);
  return makeSlotKey(nextWorkingDate(date, closures), "AM");
}

export function advanceWorkingDuration(
  requestedStart: SlotKey,
  durationHalfDays: number,
  closures: ClosurePeriod[]
) {
  let cursor = normalizeToWorkingSlot(requestedStart, closures);
  let remaining = Math.max(1, durationHalfDays);
  const skippedDates = new Set<string>();

  while (remaining > 0) {
    const { date } = parseSlotKey(cursor);

    if (!isNonWorkingDate(date, closures)) {
      remaining -= 1;
    } else {
      skippedDates.add(date);
    }

    cursor = nextCalendarSlot(cursor);
  }

  const normalizedReadySlot = normalizeToWorkingSlot(cursor, closures);
  const readyDate = parseSlotKey(normalizedReadySlot).date;
  if (readyDate !== parseSlotKey(cursor).date) {
    skippedDates.add(parseSlotKey(cursor).date);
  }

  return {
    startSlot: normalizeToWorkingSlot(requestedStart, closures),
    calendarEndSlot: cursor,
    readySlot: normalizedReadySlot,
    skippedDates: [...skippedDates].sort(),
  };
}

export function addWorkingLag(
  startSlot: SlotKey,
  lagHalfDays: number,
  closures: ClosurePeriod[]
) {
  const normalizedStart = normalizeToWorkingSlot(startSlot, closures);
  return normalizeToWorkingSlot(shiftWorkingSlot(normalizedStart, lagHalfDays, closures), closures);
}

export function countWorkingHalfDays(
  startSlot: SlotKey,
  endSlotExclusive: SlotKey,
  closures: ClosurePeriod[]
) {
  let cursor = normalizeToWorkingSlot(startSlot, closures);
  let count = 0;

  while (compareSlotKeys(cursor, endSlotExclusive) < 0) {
    if (!isNonWorkingDate(parseSlotKey(cursor).date, closures)) {
      count += 1;
    }

    cursor = nextCalendarSlot(cursor);
  }

  return count;
}

export function countWorkingSlotDistance(
  startSlot: SlotKey,
  endSlot: SlotKey,
  closures: ClosurePeriod[]
) {
  if (startSlot === endSlot) {
    return 0;
  }

  if (compareSlotKeys(startSlot, endSlot) < 0) {
    let cursor = startSlot;
    let count = 0;

    while (compareSlotKeys(cursor, endSlot) < 0) {
      cursor = nextCalendarSlot(cursor);
      if (!isNonWorkingDate(parseSlotKey(cursor).date, closures)) {
        count += 1;
      }
    }

    return count;
  }

  let cursor = startSlot;
  let count = 0;

  while (compareSlotKeys(cursor, endSlot) > 0) {
    cursor = previousCalendarSlot(cursor);
    if (!isNonWorkingDate(parseSlotKey(cursor).date, closures)) {
      count += 1;
    }
  }

  return -count;
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

  void part;
  void zoom;
  return format(parsedDate, "yyyy");
}
