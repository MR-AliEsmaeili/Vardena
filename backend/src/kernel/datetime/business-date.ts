/**
 * Business dates (C-63 §3/§10, ADR-0042).
 *
 * A **business date** answers "which calendar day does this document belong
 * to?" — an inventory receipt's date, a voucher's date, a fiscal year's start.
 * It is NOT when something happened, and it must never be interchangeable
 * with an event timestamp:
 *
 *   documentDate = 1405-07-01   (business day — the reporting axis)
 *   createdAt    = 1405-07-16 12:32  (event instant — the audit axis)
 *
 * A backdated receipt is exactly this difference, so the two representations
 * are deliberately distinct types of value here.
 *
 * Canonical representation (one, everywhere):
 *
 *   * persisted: the Gregorian calendar day (`date` in PostgreSQL, or a
 *     UTC-midnight instant in a module whose day column doubles as an
 *     ordering axis — see docs/datetime.md §Inventory);
 *   * over the API: `YYYY-MM-DD`, ASCII digits, no time part;
 *   * Jalali is DERIVED for display, never stored as the authoritative value.
 *
 * Framework-free (AR-05/AR-06): plain string/number functions.
 */

import {
  DEFAULT_CALENDAR_SYSTEM,
  isCalendarSystem,
  type CalendarSystem,
} from './calendar-system.js';
import {
  gregorianToJalaliDay,
  isRealGregorianDay,
  jalaliToGregorianDay,
} from './jalali.js';
import { calendarDayInTimeZone } from './time-zone.js';

/** The one canonical day shape: `YYYY-MM-DD` (Gregorian unless declared). */
export const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Why a value was refused — machine-readable, never a user-facing message. */
export type BusinessDateRejection = 'format' | 'calendar_date' | 'range';

/** A parsed day: always canonical Gregorian, whatever was submitted. */
export interface ParsedBusinessDate {
  /** Canonical Gregorian day (`YYYY-MM-DD`) — persist and return this. */
  gregorian: string;
  /** The calendar the caller expressed the day in. */
  calendar: CalendarSystem;
}

/**
 * Parse `YYYY-MM-DD` as a day of `calendar`.
 *
 * Returns `null` (never throws) for a malformed shape, a day that does not
 * exist in that calendar (`1405/12/30` in a common year, `2026-02-30`), or a
 * year outside the supported conversion range.
 */
export function parseBusinessDate(
  value: string,
  calendar: CalendarSystem = DEFAULT_CALENDAR_SYSTEM,
): ParsedBusinessDate | null {
  if (!isCalendarSystem(calendar)) return null;
  if (typeof value !== 'string' || !BUSINESS_DATE_PATTERN.test(value)) {
    return null;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  if (calendar === 'GREGORIAN') {
    if (!isRealGregorianDay(year, month, day)) return null;
    return { gregorian: value, calendar };
  }

  const gregorian = jalaliToGregorianDay(year, month, day);
  if (gregorian === null) return null;
  return { gregorian: toDayString(gregorian), calendar };
}

/**
 * Render a canonical Gregorian day in `calendar`.
 *
 * `null` when the canonical day is malformed or outside the supported
 * conversion range — callers surface that as a data defect, never as a silent
 * fallback to Gregorian.
 */
export function formatBusinessDate(
  gregorian: string,
  calendar: CalendarSystem = DEFAULT_CALENDAR_SYSTEM,
): string | null {
  if (!isCalendarSystem(calendar)) return null;
  if (!BUSINESS_DATE_PATTERN.test(gregorian)) return null;
  if (calendar === 'GREGORIAN') {
    const parts = splitDay(gregorian);
    return isRealGregorianDay(parts.year, parts.month, parts.day)
      ? gregorian
      : null;
  }
  const parts = splitDay(gregorian);
  const jalali = gregorianToJalaliDay(parts.year, parts.month, parts.day);
  return jalali === null ? null : toDayString(jalali);
}

/** True when `value` is a real Gregorian calendar day (`YYYY-MM-DD`). */
export function isGregorianBusinessDate(value: unknown): value is string {
  if (typeof value !== 'string' || !BUSINESS_DATE_PATTERN.test(value)) {
    return false;
  }
  const parts = splitDay(value);
  return isRealGregorianDay(parts.year, parts.month, parts.day);
}

/** True when `value` is a real day of `calendar`. */
export function isBusinessDateInCalendar(
  value: unknown,
  calendar: CalendarSystem,
): value is string {
  return (
    typeof value === 'string' && parseBusinessDate(value, calendar) !== null
  );
}

/**
 * The instant a business day is carried by in a `timestamptz` day column:
 * UTC midnight of the canonical Gregorian day.
 *
 * This is the convention the existing Inventory ledger and the Accounting
 * `date` columns already use (a day has no time and no zone), so a day filter
 * and a stored day compare exactly. `null` for an invalid day.
 */
export function businessDateToUtcMidnight(gregorian: string): Date | null {
  if (!isGregorianBusinessDate(gregorian)) return null;
  const parts = splitDay(gregorian);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

/**
 * The business day a UTC-midnight-carried day column value names.
 *
 * Uses the **UTC** day on purpose: a day carried as `D T00:00:00Z` names day
 * `D` in every organization, whatever its time zone. Resolving it in an
 * organization zone with a negative offset would shift it a day earlier and
 * silently re-date every document (see docs/datetime.md §Inventory).
 */
export function businessDateFromUtcMidnight(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * The business day an *instant* falls on in a time zone — the calendar-aware
 * "today". Used where a day is derived from a moment (defaults, period
 * resolution), never to re-derive a stored business day.
 */
export function businessDateFromInstant(
  instant: Date,
  timeZone: string,
): string {
  return calendarDayInTimeZone(instant, timeZone);
}

/** True when both days are the same calendar day (canonical form). */
export function isSameBusinessDate(left: string, right: string): boolean {
  return left === right;
}

/** Chronological comparison of two canonical days; `null` when malformed. */
export function compareBusinessDates(
  left: string,
  right: string,
): number | null {
  if (!isGregorianBusinessDate(left) || !isGregorianBusinessDate(right)) {
    return null;
  }
  const leftTime = businessDateToUtcMidnight(left);
  const rightTime = businessDateToUtcMidnight(right);
  if (leftTime === null || rightTime === null) return null;
  return leftTime.getTime() - rightTime.getTime();
}

/**
 * An INCLUSIVE business-date range, `[startDate, endDate]` — the Accounting
 * fiscal-calendar contract's own semantics (`docs/accounting/domain-contract.md`
 * §6.1). Both ends are canonical Gregorian days.
 */
export interface BusinessDateRange {
  startDate: string;
  endDate: string;
}

/** True when the range is well-formed: `endDate` on or after `startDate`. */
export function isValidBusinessDateRange(range: BusinessDateRange): boolean {
  const comparison = compareBusinessDates(range.startDate, range.endDate);
  return comparison !== null && comparison <= 0;
}

/**
 * The half-open instant interval an inclusive day range covers:
 * `[start 00:00:00Z, end + 1 day 00:00:00Z)`.
 *
 * Half-open is deliberate (C-63 §18): the upper bound is the START of the day
 * after the last requested day, so no `23:59:59.999` end-of-day value is ever
 * constructed, ranges never double-count a boundary day, and the comparison
 * stays an index-friendly `>= / <` pair. `null` when either day is invalid.
 */
export function businessDateRangeToUtcInterval(
  range: BusinessDateRange,
): { start: Date; endExclusive: Date } | null {
  if (!isValidBusinessDateRange(range)) return null;
  const start = businessDateToUtcMidnight(range.startDate);
  const end = businessDateToUtcMidnight(range.endDate);
  if (start === null || end === null) return null;
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, endExclusive: end };
}

/** `YYYY-MM-DD`, zero-padded, ASCII digits — the canonical day shape. */
export function toDayString(day: {
  year: number;
  month: number;
  day: number;
}): string {
  return (
    `${String(day.year).padStart(4, '0')}-` +
    `${String(day.month).padStart(2, '0')}-` +
    `${String(day.day).padStart(2, '0')}`
  );
}

/** The numeric parts of a canonical day string (shape is assumed valid). */
export function splitDay(gregorian: string): {
  year: number;
  month: number;
  day: number;
} {
  return {
    year: Number(gregorian.slice(0, 4)),
    month: Number(gregorian.slice(5, 7)),
    day: Number(gregorian.slice(8, 10)),
  };
}
