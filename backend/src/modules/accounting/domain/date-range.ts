/**
 * Date-only ranges for the fiscal calendar (Task 10.2, contract §6.1/§7.1,
 * AC-I-03).
 *
 * Fiscal years and accounting periods are INCLUSIVE date-only ranges:
 * `[start_date, end_date]`, stored as PostgreSQL `DATE`. There is no time
 * component, no timezone, and no calendar-system assumption (the calendar
 * choice is OQ-23/OQ-02; the model stores dates, never a calendar).
 *
 * Representation rules (the whole module follows these):
 * - the API carries dates as `YYYY-MM-DD` strings (never datetimes);
 * - inside the domain a date-only value is a `Date` at UTC midnight,
 *   constructed ONLY through `parseDateOnly`;
 * - comparisons use the UTC day (millisecond timestamps of UTC-midnight
 *   instants), never local-time accessors;
 * - the API renders dates through `formatDateOnly` (UTC).
 *
 * Overlap is the inclusive test `[aStart, aEnd] ∩ [bStart, bEnd] ≠ ∅`.
 * Touching ranges (one ends 1404-12-29, the next starts 1404-12-30) do
 * NOT overlap; ranges sharing even one day DO — including a zero-length
 * range (start = end) that falls inside another range. Do NOT "fix" this
 * to half-open semantics: the contract fixes inclusive bounds.
 *
 * Framework-free (AR-05): pure functions, unit-tested.
 */

/** `YYYY-MM-DD` shape (syntax only — calendar validity is `parseDateOnly`). */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** An inclusive date-only range. Both ends are UTC-midnight instants. */
export interface DateOnlyRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Parse a `YYYY-MM-DD` string into a UTC-midnight `Date`.
 *
 * Returns `null` when the shape is wrong OR the calendar date does not
 * exist (month 13, 2026-02-30, …). Leap years follow the proleptic
 * Gregorian calendar, like PostgreSQL's `DATE` itself.
 */
export function parseDateOnly(value: string): Date | null {
  if (!DATE_ONLY_PATTERN.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // A rolled-over construction (Feb 30 → Mar 2) proves a bad calendar date.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Render a date-only value as `YYYY-MM-DD` (UTC — never local time). */
export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** True when the range is well-formed: `endDate` on or after `startDate`. */
export function isValidDateOnlyRange(range: DateOnlyRange): boolean {
  return range.endDate.getTime() >= range.startDate.getTime();
}

/**
 * Inclusive overlap test: `[aStart, aEnd] ∩ [bStart, bEnd] ≠ ∅`.
 *
 * Both ranges must be valid (`isValidDateOnlyRange`); an invalid range
 * never "overlaps" — it is rejected before overlap is considered.
 */
export function dateOnlyRangesOverlap(
  a: DateOnlyRange,
  b: DateOnlyRange,
): boolean {
  return (
    a.startDate.getTime() <= b.endDate.getTime() &&
    b.startDate.getTime() <= a.endDate.getTime()
  );
}

/** True when `inner` lies fully inside `outer` (bounds included). */
export function dateOnlyRangeWithin(
  inner: DateOnlyRange,
  outer: DateOnlyRange,
): boolean {
  return (
    inner.startDate.getTime() >= outer.startDate.getTime() &&
    inner.endDate.getTime() <= outer.endDate.getTime()
  );
}
