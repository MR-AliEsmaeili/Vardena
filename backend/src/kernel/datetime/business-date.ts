/**
 * Business dates (C-63 §3/§10, ADR-0042; OQ-73 resolution).
 *
 * A **business date** answers "which calendar day does this document belong
 * to?" — an inventory receipt's date, a voucher's date, a fiscal year's
 * start. It is NOT when something happened, and it must never be
 * interchangeable with an event timestamp:
 *
 *   documentDate = 1405-07-01   (business day — the reporting axis)
 *   createdAt    = 1405-07-16 12:32  (event instant — the audit axis)
 *
 * A backdated receipt is exactly this difference, so the two are DISTINCT
 * TYPES here: {@link BusinessDate} (a calendar day) and {@link Instant} (an
 * exact moment). A business date has NO time-of-day component and NO time
 * zone — it is never carried as a UTC-midnight timestamp and no timezone may
 * ever be applied to reinterpret it.
 *
 * Canonical representation (one, everywhere):
 *
 *   * persisted: the Gregorian calendar day in a PostgreSQL `date` column
 *     (OQ-73: business dates are `date`, never `timestamptz`);
 *   * in memory at the persistence boundary: Prisma maps `date` to a JS
 *     `Date` whose UTC components ARE the day (see {@link businessDateToDbDate}
 *     / {@link businessDateFromDbDate} — transport adapters only);
 *   * over the API and inside the domain: `YYYY-MM-DD`, ASCII digits, no
 *     time part;
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

/**
 * An exact moment in time — `created_at`, `finalized_at`, an approval or
 * posting timestamp. Persisted as PostgreSQL `timestamptz`, canonical on the
 * wire as ISO-8601 UTC, rendered through an IANA time zone. A BusinessDate is
 * NEVER an Instant and an Instant is NEVER a BusinessDate (ADR-0042 §2).
 */
export type Instant = Date;

/**
 * A calendar day — the BusinessDate of ADR-0042. Nominal type: a canonical
 * Gregorian `YYYY-MM-DD` string that has been validated by
 * {@link toBusinessDate}. It carries no time of day and no time zone; no
 * function may shift it by an offset. Persisted as PostgreSQL `date`.
 */
export type BusinessDate = string & {
  readonly __businessDateBrand: unique symbol;
};

/**
 * Validate and brand a canonical Gregorian day. `null` when the value is not
 * a real calendar day — callers report that instead of guessing.
 */
export function toBusinessDate(value: string): BusinessDate | null {
  return isGregorianBusinessDate(value) ? (value as BusinessDate) : null;
}

/** Why a value was refused — machine-readable, never a user-facing message. */
export type BusinessDateRejection = 'format' | 'calendar_date' | 'range';

/** A parsed day: always canonical Gregorian, whatever was submitted. */
export interface ParsedBusinessDate {
  /** Canonical Gregorian day (`YYYY-MM-DD`) — persist and return this. */
  gregorian: BusinessDate;
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
    const gregorian = toBusinessDate(value);
    return gregorian === null ? null : { gregorian, calendar };
  }

  const jalali = jalaliToGregorianDay(year, month, day);
  if (jalali === null) return null;
  const gregorian = toBusinessDate(toDayString(jalali));
  return gregorian === null ? null : { gregorian, calendar };
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
export function isGregorianBusinessDate(value: unknown): value is BusinessDate {
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
 * The JS `Date` carrier a PostgreSQL `date` column is written with.
 *
 * TRANSPORT ADAPTER ONLY — this does NOT make a business date an instant:
 * Prisma represents a `date` value as a `Date` whose **UTC components are the
 * day itself**, and serializes it back to `YYYY-MM-DD` from those UTC
 * components. The value never crosses the API and must never be rendered or
 * compared as a moment in time. `null` for an invalid day.
 */
export function businessDateToDbDate(gregorian: string): Date | null {
  if (!isGregorianBusinessDate(gregorian)) return null;
  const parts = splitDay(gregorian);
  // Date.UTC treats years 0–99 as 1900–1999. Set the UTC calendar fields
  // directly so valid four-digit PostgreSQL days such as year 0001 remain the
  // day itself in Prisma's Date carrier.
  const carrier = new Date(0);
  carrier.setUTCHours(0, 0, 0, 0);
  carrier.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return carrier;
}

/**
 * The business day read back from a PostgreSQL `date` column.
 *
 * Reads the **UTC** components on purpose — that is how Prisma materializes a
 * `date` value, and a day has no zone: resolving it in an organization zone
 * with a negative offset would shift it a day earlier and silently re-date
 * every document. The result is zone-independent by construction
 * (ADR-0042 §2, OQ-73).
 */
export function businessDateFromDbDate(value: Date): BusinessDate {
  if (Number.isNaN(value.getTime())) {
    throw new Error(
      'Prisma returned an invalid carrier for a PostgreSQL date.',
    );
  }
  const year = value.getUTCFullYear();
  const day = [
    String(year).padStart(4, '0'),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
  const businessDate = toBusinessDate(day);
  if (businessDate === null) {
    throw new Error(
      `PostgreSQL date carrier "${day}" is outside the canonical BusinessDate range.`,
    );
  }
  return businessDate;
}

/**
 * The business day an *instant* falls on in a time zone — the calendar-aware
 * "today". Used ONLY where a day is derived from a genuine moment (defaults,
 * period resolution, a legacy instant input), never to re-derive a stored
 * business date: a stored day is already a day and needs no zone.
 */
export function businessDateFromInstant(
  instant: Instant,
  timeZone: string,
): BusinessDate {
  return calendarDayInTimeZone(instant, timeZone) as BusinessDate;
}

/**
 * The UTC calendar day of a legacy instant supplied to a BusinessDate field.
 *
 * OQ-73 migration semantics are UTC-day preserving, so the compatibility
 * parser must resolve equivalent legacy inputs using the same UTC calendar
 * rather than the organization's display zone. This helper is intentionally
 * separate from {@link businessDateFromInstant}, which is used for "today"
 * defaults and renders a real instant in the organization's configured zone.
 * Returns `null` for an invalid instant or a UTC day outside the canonical
 * four-digit BusinessDate range.
 */
export function businessDateFromUtcInstant(
  instant: Instant,
): BusinessDate | null {
  if (Number.isNaN(instant.getTime())) return null;
  const day = [
    String(instant.getUTCFullYear()).padStart(4, '0'),
    String(instant.getUTCMonth() + 1).padStart(2, '0'),
    String(instant.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return toBusinessDate(day);
}

/** True when both days are the same calendar day (canonical form). */
export function isSameBusinessDate(left: string, right: string): boolean {
  return left === right;
}

/**
 * Chronological comparison of two canonical days; `null` when malformed.
 * Canonical `YYYY-MM-DD` strings compare lexically in chronological order —
 * no instant is constructed to compare two days.
 */
export function compareBusinessDates(
  left: string,
  right: string,
): number | null {
  if (!isGregorianBusinessDate(left) || !isGregorianBusinessDate(right)) {
    return null;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * An INCLUSIVE business-date range, `[startDate, endDate]` — the Accounting
 * fiscal-calendar contract's own semantics (`docs/accounting/domain-contract.md`
 * §6.1). Both ends are canonical Gregorian days.
 */
export interface BusinessDateRange {
  startDate: BusinessDate;
  endDate: BusinessDate;
}

/** True when the range is well-formed: `endDate` on or after `startDate`. */
export function isValidBusinessDateRange(range: BusinessDateRange): boolean {
  const comparison = compareBusinessDates(range.startDate, range.endDate);
  return comparison !== null && comparison <= 0;
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
