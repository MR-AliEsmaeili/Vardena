import {
  isLeapJalaaliYear,
  isValidJalaaliDate,
  jalaaliMonthLength,
  toGregorian,
  toJalaali,
} from 'jalaali-js';

/**
 * Calendar vocabulary and Gregorian↔Jalali CONVERSION (C-63, ADR-0042 §D3).
 *
 * This is the ONLY module in the frontend that imports a calendar library.
 * Everything else — formatters, the date field, the API mapping — goes
 * through these functions, so the calendar rules have exactly one
 * implementation and one test surface. The `jalaali-js` range (Jalali years
 * −61…3177) is narrower than `Date`; every function here answers `null` for
 * anything outside it instead of throwing, because a formatter must never
 * crash a screen on unexpected data.
 *
 * The calendar NAMES mirror the backend kernel (`kernel/datetime/
 * calendar-system.ts`): `GREGORIAN` (identity) and `JALALI` (Sunni-less
 * astronomical Jalali / Solar Hijri, the civil calendar of Iran). The
 * deployment default is JALALI (docs/datetime.md), but nothing here hard-codes
 * it for a given screen: the active calendar comes from the organization's
 * date/time settings.
 */

export const CALENDAR_SYSTEMS = ['GREGORIAN', 'JALALI'] as const;
export type CalendarSystem = (typeof CALENDAR_SYSTEMS)[number];

/** Product default, mirrored from the backend kernel (`DEFAULT_CALENDAR_SYSTEM`). */
export const DEFAULT_CALENDAR_SYSTEM: CalendarSystem = 'JALALI';

/** True for a value the closed vocabulary accepts (any other string is not). */
export function isCalendarSystem(value: unknown): value is CalendarSystem {
  return (
    typeof value === 'string' &&
    (CALENDAR_SYSTEMS as readonly string[]).includes(value)
  );
}

/** Canonical, calendar-independent day shape: `YYYY-MM-DD`. */
export const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface DayParts {
  year: number;
  month: number;
  day: number;
}

/** Split `YYYY-MM-DD` into numbers; `null` when the shape is wrong. */
export function parseDayParts(value: string): DayParts | null {
  if (!BUSINESS_DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Two-digit zero padding for day/month parts. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Compose canonical `YYYY-MM-DD` from parts (no validity check). */
export function formatDayParts(parts: DayParts): string {
  return `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * True when `YYYY-MM-DD` is a real Gregorian day. A bare day is Gregorian by
 * contract on the API (`docs/datetime.md` §API): `1405-12-30` is a legitimate
 * Gregorian date even though the same digits are an invalid Jalali day, which
 * is exactly why a Jalali value must always be DECLARED as such.
 */
export function isGregorianDay(value: string): boolean {
  const parts = parseDayParts(value);
  if (parts === null) return false;
  const probe = new Date(Date.UTC(2000, 0, 1));
  probe.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  probe.setUTCHours(0, 0, 0, 0);
  return (
    probe.getUTCFullYear() === parts.year &&
    probe.getUTCMonth() === parts.month - 1 &&
    probe.getUTCDate() === parts.day
  );
}

/** True when `YYYY-MM-DD` is a real day of `calendar`. */
export function isValidDayInCalendar(
  value: string,
  calendar: CalendarSystem,
): boolean {
  const parts = parseDayParts(value);
  if (parts === null) return false;
  return calendar === 'GREGORIAN'
    ? isGregorianDay(value)
    : isValidJalaaliDate(parts.year, parts.month, parts.day);
}

/** The canonical Gregorian day for a Jalali day (or `null` when invalid). */
export function jalaliDayToGregorianDay(value: string): string | null {
  const parts = parseDayParts(value);
  if (parts === null) return null;
  if (!isValidJalaaliDate(parts.year, parts.month, parts.day)) return null;
  const gregorian = toGregorian(parts.year, parts.month, parts.day);
  return formatDayParts({
    year: gregorian.gy,
    month: gregorian.gm,
    day: gregorian.gd,
  });
}

/** The Jalali day for a canonical Gregorian day (or `null` when invalid). */
export function gregorianDayToJalaliDay(value: string): string | null {
  if (!isGregorianDay(value)) return null;
  const parts = parseDayParts(value);
  if (parts === null) return null;
  try {
    const jalali = toJalaali(parts.year, parts.month, parts.day);
    if (!isValidJalaaliDate(jalali.jy, jalali.jm, jalali.jd)) return null;
    return formatDayParts({
      year: jalali.jy,
      month: jalali.jm,
      day: jalali.jd,
    });
  } catch {
    // Outside the library's supported range: "no rendering", never a crash.
    return null;
  }
}

/** True when `year` is a leap year in the Jalali calendar. */
export function isJalaliLeapYear(year: number): boolean {
  return isLeapJalaaliYear(year);
}

/** Number of days in a Jalali month (1–12; 1–29 for an invalid input). */
export function jalaliMonthLengthOf(year: number, month: number): number {
  return jalaaliMonthLength(year, month);
}

/**
 * The same day in the other calendar, or `null` when the day does not exist
 * in the calendar it is written in.
 */
export function convertDay(
  value: string,
  from: CalendarSystem,
  to: CalendarSystem,
): string | null {
  if (from === to) return isValidDayInCalendar(value, from) ? value : null;
  return from === 'JALALI'
    ? jalaliDayToGregorianDay(value)
    : gregorianDayToJalaliDay(value);
}
