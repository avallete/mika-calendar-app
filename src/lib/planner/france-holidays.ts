import { addDays, format, getYear } from "date-fns";

import type { ClosurePeriod } from "@/lib/planner/types";

function computeEasterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(Date.UTC(year, month - 1, day));
}

function buildHoliday(id: string, title: string, date: string): ClosurePeriod {
  return {
    id,
    title,
    type: "holiday",
    startDate: date,
    endDate: date,
    impact: "blocking",
    source: "fr-public-holiday",
    editable: false,
  };
}

export function buildFrancePublicHolidays(year: number) {
  const easterSunday = computeEasterSunday(year);
  const easterMonday = format(addDays(easterSunday, 1), "yyyy-MM-dd");
  const ascension = format(addDays(easterSunday, 39), "yyyy-MM-dd");
  const whitMonday = format(addDays(easterSunday, 50), "yyyy-MM-dd");

  return [
    buildHoliday(`fr-${year}-new-year`, "Jour de l'an", `${year}-01-01`),
    buildHoliday(`fr-${year}-easter-monday`, "Lundi de Paques", easterMonday),
    buildHoliday(`fr-${year}-labour-day`, "Fete du Travail", `${year}-05-01`),
    buildHoliday(`fr-${year}-victory-day`, "Victoire 1945", `${year}-05-08`),
    buildHoliday(`fr-${year}-ascension`, "Ascension", ascension),
    buildHoliday(`fr-${year}-whit-monday`, "Lundi de Pentecote", whitMonday),
    buildHoliday(`fr-${year}-national-day`, "Fete nationale", `${year}-07-14`),
    buildHoliday(`fr-${year}-assumption`, "Assomption", `${year}-08-15`),
    buildHoliday(`fr-${year}-all-saints`, "Toussaint", `${year}-11-01`),
    buildHoliday(`fr-${year}-armistice`, "Armistice", `${year}-11-11`),
    buildHoliday(`fr-${year}-christmas`, "Noel", `${year}-12-25`),
  ];
}

export function getCoveredYears(dates: string[]) {
  const years = new Set<number>();

  for (const date of dates) {
    if (!date) {
      continue;
    }

    years.add(getYear(new Date(`${date}T00:00:00.000Z`)));
  }

  if (!years.size) {
    years.add(new Date().getUTCFullYear());
  }

  return [...years].sort((left, right) => left - right);
}
