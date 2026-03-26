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

import { recordPlannerPerfProbeCount } from "@/lib/planner/planner-perf";
import type { ClosurePeriod, SlotKey, SlotPart, ZoomLevel } from "@/lib/planner/types";

export const PART_SEQUENCE: SlotPart[] = ["AM", "PM"];

const DEFAULT_CALENDAR_BUFFER_DAYS = 180;
const EMPTY_SKIPPED_DATES: string[] = [];
const workingCalendarIndexCache = new WeakMap<ClosurePeriod[], WorkingCalendarIndexImpl>();

export type ParsedSlot = {
  date: string;
  part: SlotPart;
};

export type WorkingCalendarSpan = {
  startSlot: SlotKey;
  calendarEndSlot: SlotKey;
  readySlot: SlotKey;
  endDate: string;
  sectionIds: string[];
  skippedDates: string[];
};

export type WorkingCalendarIndex = {
  prepareRange: (startDate: string, endDate: string) => void;
  normalizeSlot: (slotKey: SlotKey) => SlotKey;
  computeSpan: (startSlot: SlotKey, durationHalfDays: number) => WorkingCalendarSpan;
  addWorkingLag: (startSlot: SlotKey, lagHalfDays: number) => SlotKey;
  countWorkingHalfDays: (startSlot: SlotKey, endSlotExclusive: SlotKey) => number;
  countWorkingSlotDistance: (startSlot: SlotKey, endSlot: SlotKey) => number;
};

type CalendarDayEntry = {
  date: string;
  isWorking: boolean;
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

function addDayOffset(date: string, dayOffset: number) {
  return format(addDays(parseISO(date), dayOffset), "yyyy-MM-dd");
}

function isNonWorkingDateSlow(date: string, closures: ClosurePeriod[]) {
  const day = getDay(parseISO(date));
  if (day === 0 || day === 6) {
    return true;
  }

  return closures.some(
    (closure) => closure.impact === "blocking" && isDateInsideClosure(date, closure)
  );
}

function lowerBoundDayIndex(values: number[], target: number) {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function lowerBoundWorkingSlot(
  workingSlotKeys: SlotKey[],
  slotKey: SlotKey
) {
  let low = 0;
  let high = workingSlotKeys.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareSlotKeys(workingSlotKeys[middle], slotKey) < 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function upperBoundWorkingSlot(
  workingSlotKeys: SlotKey[],
  slotKey: SlotKey
) {
  let low = 0;
  let high = workingSlotKeys.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareSlotKeys(workingSlotKeys[middle], slotKey) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function listMonthSectionIdsBetween(startDate: string, endDate: string) {
  const sectionIds: string[] = [];
  let cursor = startDate.slice(0, 7);
  const endSectionId = endDate.slice(0, 7);

  while (cursor <= endSectionId) {
    sectionIds.push(cursor);
    const [year, month] = cursor.split("-").map(Number);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    cursor = `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
  }

  return sectionIds;
}

class WorkingCalendarIndexImpl implements WorkingCalendarIndex {
  private readonly closures: ClosurePeriod[];
  private startDate: string | null = null;
  private endDate: string | null = null;
  private dayEntries: CalendarDayEntry[] = [];
  private dayIndexByDate = new Map<string, number>();
  private workingDayIndices: number[] = [];
  private workingSlotKeys: SlotKey[] = [];
  private workingSlotOrdinalByKey = new Map<SlotKey, number>();

  constructor(closures: ClosurePeriod[], startDate?: string, endDate?: string) {
    this.closures = closures;
    if (startDate && endDate) {
      this.prepareRange(startDate, endDate);
    }
  }

  prepareRange(startDate: string, endDate: string) {
    if (this.startDate && this.endDate && startDate >= this.startDate && endDate <= this.endDate) {
      return;
    }

    const nextStartDate =
      this.startDate && this.startDate < startDate ? this.startDate : startDate;
    const nextEndDate =
      this.endDate && this.endDate > endDate ? this.endDate : endDate;
    this.rebuild(nextStartDate, nextEndDate);
  }

  normalizeSlot(slotKey: SlotKey) {
    const { date, part } = parseSlotKey(slotKey);
    this.ensureDate(date);

    const dayIndex = this.dayIndexByDate.get(date);
    if (dayIndex === undefined) {
      return slotKey;
    }

    const entry = this.dayEntries[dayIndex];
    if (entry?.isWorking) {
      return makeSlotKey(date, part);
    }

    let nextWorkingDayPosition = lowerBoundDayIndex(this.workingDayIndices, dayIndex);
    while (nextWorkingDayPosition >= this.workingDayIndices.length) {
      this.extendAfter(date);
      nextWorkingDayPosition = lowerBoundDayIndex(this.workingDayIndices, dayIndex);
    }

    const nextWorkingDayIndex = this.workingDayIndices[nextWorkingDayPosition];
    return makeSlotKey(this.dayEntries[nextWorkingDayIndex].date, "AM");
  }

  computeSpan(startSlot: SlotKey, durationHalfDays: number) {
    recordPlannerPerfProbeCount("spanComputeCalls");

    const normalizedStart = this.normalizeSlot(startSlot);
    let startOrdinal = this.workingSlotOrdinalByKey.get(normalizedStart);
    while (typeof startOrdinal !== "number") {
      this.extendAfter(parseSlotKey(normalizedStart).date);
      startOrdinal = this.workingSlotOrdinalByKey.get(normalizedStart);
    }

    const targetOrdinal = startOrdinal + Math.max(1, durationHalfDays) - 1;
    this.ensureWorkingOrdinal(targetOrdinal, parseSlotKey(normalizedStart).date);

    const lastWorkingSlot = this.workingSlotKeys[targetOrdinal];
    const calendarEndSlot = nextCalendarSlot(lastWorkingSlot);
    const readySlot = this.normalizeSlot(calendarEndSlot);
    const endDate = parseSlotKey(previousCalendarSlot(calendarEndSlot)).date;

    return {
      startSlot: normalizedStart,
      calendarEndSlot,
      readySlot,
      endDate,
      sectionIds: listMonthSectionIdsBetween(parseSlotKey(normalizedStart).date, endDate),
      skippedDates: EMPTY_SKIPPED_DATES,
    } satisfies WorkingCalendarSpan;
  }

  addWorkingLag(startSlot: SlotKey, lagHalfDays: number) {
    const normalizedStart = this.normalizeSlot(startSlot);
    if (lagHalfDays === 0) {
      return normalizedStart;
    }

    let startOrdinal = this.workingSlotOrdinalByKey.get(normalizedStart);
    while (typeof startOrdinal !== "number") {
      this.extendAfter(parseSlotKey(normalizedStart).date);
      startOrdinal = this.workingSlotOrdinalByKey.get(normalizedStart);
    }

    let targetOrdinal = startOrdinal + lagHalfDays;
    while (targetOrdinal < 0) {
      this.extendBefore(parseSlotKey(normalizedStart).date);
      startOrdinal = this.workingSlotOrdinalByKey.get(normalizedStart);
      if (typeof startOrdinal !== "number") {
        throw new Error("Unable to resolve normalized working slot after extending range.");
      }
      targetOrdinal = startOrdinal + lagHalfDays;
    }

    this.ensureWorkingOrdinal(targetOrdinal, parseSlotKey(normalizedStart).date);
    return this.workingSlotKeys[targetOrdinal];
  }

  countWorkingHalfDays(startSlot: SlotKey, endSlotExclusive: SlotKey) {
    const normalizedStart = this.normalizeSlot(startSlot);
    if (compareSlotKeys(normalizedStart, endSlotExclusive) >= 0) {
      return 0;
    }

    let startOrdinal = this.workingSlotOrdinalByKey.get(normalizedStart);
    while (typeof startOrdinal !== "number") {
      this.extendAfter(parseSlotKey(normalizedStart).date);
      startOrdinal = this.workingSlotOrdinalByKey.get(normalizedStart);
    }

    this.ensureDate(parseSlotKey(endSlotExclusive).date);
    return Math.max(
      0,
      lowerBoundWorkingSlot(this.workingSlotKeys, endSlotExclusive) - startOrdinal
    );
  }

  countWorkingSlotDistance(startSlot: SlotKey, endSlot: SlotKey) {
    if (startSlot === endSlot) {
      return 0;
    }

    this.ensureDate(parseSlotKey(startSlot).date);
    this.ensureDate(parseSlotKey(endSlot).date);

    if (compareSlotKeys(startSlot, endSlot) < 0) {
      return (
        upperBoundWorkingSlot(this.workingSlotKeys, endSlot) -
        upperBoundWorkingSlot(this.workingSlotKeys, startSlot)
      );
    }

    return -(
      upperBoundWorkingSlot(this.workingSlotKeys, startSlot) -
      upperBoundWorkingSlot(this.workingSlotKeys, endSlot)
    );
  }

  private rebuild(startDate: string, endDate: string) {
    const dayEntries = eachDayOfInterval({
      start: parseISO(startDate),
      end: parseISO(endDate),
    }).map((value) => {
      const date = format(value, "yyyy-MM-dd");
      return {
        date,
        isWorking: !isNonWorkingDateSlow(date, this.closures),
      } satisfies CalendarDayEntry;
    });

    this.startDate = startDate;
    this.endDate = endDate;
    this.dayEntries = dayEntries;
    this.dayIndexByDate = new Map(dayEntries.map((entry, index) => [entry.date, index] as const));
    this.workingDayIndices = [];
    this.workingSlotKeys = [];
    this.workingSlotOrdinalByKey = new Map();

    for (const [index, entry] of dayEntries.entries()) {
      if (!entry.isWorking) {
        continue;
      }

      this.workingDayIndices.push(index);
      const amSlot = makeSlotKey(entry.date, "AM");
      const pmSlot = makeSlotKey(entry.date, "PM");
      this.workingSlotOrdinalByKey.set(amSlot, this.workingSlotKeys.length);
      this.workingSlotKeys.push(amSlot);
      this.workingSlotOrdinalByKey.set(pmSlot, this.workingSlotKeys.length);
      this.workingSlotKeys.push(pmSlot);
    }
  }

  private ensureDate(date: string) {
    if (!this.startDate || !this.endDate) {
      this.rebuild(
        addDayOffset(date, -DEFAULT_CALENDAR_BUFFER_DAYS),
        addDayOffset(date, DEFAULT_CALENDAR_BUFFER_DAYS)
      );
      return;
    }

    if (date < this.startDate) {
      this.rebuild(addDayOffset(date, -DEFAULT_CALENDAR_BUFFER_DAYS), this.endDate);
      return;
    }

    if (date > this.endDate) {
      this.rebuild(this.startDate, addDayOffset(date, DEFAULT_CALENDAR_BUFFER_DAYS));
    }
  }

  private ensureWorkingOrdinal(targetOrdinal: number, anchorDate: string) {
    while (targetOrdinal >= this.workingSlotKeys.length) {
      this.extendAfter(anchorDate);
    }
  }

  private extendAfter(anchorDate: string) {
    const endDate = this.endDate ?? anchorDate;
    this.rebuild(
      this.startDate ?? addDayOffset(anchorDate, -DEFAULT_CALENDAR_BUFFER_DAYS),
      addDayOffset(endDate, DEFAULT_CALENDAR_BUFFER_DAYS)
    );
  }

  private extendBefore(anchorDate: string) {
    const startDate = this.startDate ?? anchorDate;
    this.rebuild(
      addDayOffset(startDate, -DEFAULT_CALENDAR_BUFFER_DAYS),
      this.endDate ?? addDayOffset(anchorDate, DEFAULT_CALENDAR_BUFFER_DAYS)
    );
  }
}

export function createWorkingCalendarIndex(
  closures: ClosurePeriod[],
  range?: {
    startDate: string;
    endDate: string;
  }
): WorkingCalendarIndex {
  return new WorkingCalendarIndexImpl(closures, range?.startDate, range?.endDate);
}

export function getWorkingCalendarIndex(
  closures: ClosurePeriod[],
  range?: {
    startDate: string;
    endDate: string;
  }
) {
  const existingIndex = workingCalendarIndexCache.get(closures);
  if (existingIndex) {
    if (range) {
      existingIndex.prepareRange(range.startDate, range.endDate);
    }
    return existingIndex;
  }

  const nextIndex = new WorkingCalendarIndexImpl(
    closures,
    range?.startDate,
    range?.endDate
  );
  workingCalendarIndexCache.set(closures, nextIndex);
  return nextIndex;
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
  return isNonWorkingDateSlow(date, closures);
}

export function nextWorkingDate(date: string, closures: ClosurePeriod[]) {
  return parseSlotKey(
    getWorkingCalendarIndex(closures).normalizeSlot(makeSlotKey(date, "AM"))
  ).date;
}

export function previousWorkingDate(date: string, closures: ClosurePeriod[]) {
  if (!isNonWorkingDateSlow(date, closures)) {
    return date;
  }

  const index = getWorkingCalendarIndex(closures);
  const normalizedStart = index.normalizeSlot(makeSlotKey(date, "AM"));
  const previousSlot = index.addWorkingLag(normalizedStart, -1);
  return parseSlotKey(previousSlot).date;
}

export function normalizeToWorkingSlot(slotKey: SlotKey, closures: ClosurePeriod[]) {
  return getWorkingCalendarIndex(closures).normalizeSlot(slotKey);
}

export function advanceWorkingDuration(
  requestedStart: SlotKey,
  durationHalfDays: number,
  closures: ClosurePeriod[]
) {
  return getWorkingCalendarIndex(closures).computeSpan(requestedStart, durationHalfDays);
}

export function addWorkingLag(
  startSlot: SlotKey,
  lagHalfDays: number,
  closures: ClosurePeriod[]
) {
  return getWorkingCalendarIndex(closures).addWorkingLag(startSlot, lagHalfDays);
}

export function countWorkingHalfDays(
  startSlot: SlotKey,
  endSlotExclusive: SlotKey,
  closures: ClosurePeriod[]
) {
  return getWorkingCalendarIndex(closures).countWorkingHalfDays(startSlot, endSlotExclusive);
}

export function countWorkingSlotDistance(
  startSlot: SlotKey,
  endSlot: SlotKey,
  closures: ClosurePeriod[]
) {
  return getWorkingCalendarIndex(closures).countWorkingSlotDistance(startSlot, endSlot);
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
