/**
 * Inclusive BusinessDate ranges for the Accounting fiscal calendar (contract
 * §6.1/§7.1, AC-I-03). Fiscal years and accounting periods are calendar days,
 * stored as PostgreSQL `date` and represented in the domain by the shared
 * canonical Gregorian `BusinessDate` type. No JS `Date`, timezone, midnight
 * carrier or calendar-system assumption enters these rules.
 *
 * Overlap is the inclusive test `[aStart, aEnd] ∩ [bStart, bEnd] ≠ ∅`.
 * Touching ranges (one ends 1404-12-29, the next starts 1404-12-30) do NOT
 * overlap; ranges sharing even one day DO — including a zero-length range
 * (start = end) that falls inside another range. Do NOT "fix" this to
 * half-open semantics: the Accounting contract fixes inclusive bounds.
 *
 * Framework-free (AR-05): pure functions, unit-tested.
 */

import {
  BUSINESS_DATE_PATTERN,
  compareBusinessDates,
  toBusinessDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';

/** `YYYY-MM-DD` shape (syntax only — calendar validity is `parseDateOnly`). */
export const DATE_ONLY_PATTERN = BUSINESS_DATE_PATTERN;

/** An inclusive date-only range. Both ends are canonical Gregorian days. */
export interface DateOnlyRange {
  startDate: BusinessDate;
  endDate: BusinessDate;
}

/**
 * Parse one canonical Gregorian `YYYY-MM-DD` business date. Returns `null`
 * when the shape is wrong or the date does not exist in the Gregorian
 * calendar. Jalali and legacy-instant inputs are handled by the shared
 * BusinessDate input parser at the API/application boundary.
 */
export function parseDateOnly(value: string): BusinessDate | null {
  return toBusinessDate(value);
}

/** Render the already-canonical business day without constructing an instant. */
export function formatDateOnly(date: BusinessDate): string {
  return date;
}

/** True when the range is well-formed: `endDate` on or after `startDate`. */
export function isValidDateOnlyRange(range: DateOnlyRange): boolean {
  const comparison = compareBusinessDates(range.startDate, range.endDate);
  return comparison !== null && comparison <= 0;
}

/**
 * Inclusive overlap test: `[aStart, aEnd] ∩ [bStart, bEnd] ≠ ∅`.
 * Both ranges must be valid (`isValidDateOnlyRange`); an invalid range never
 * "overlaps" — it is rejected before overlap is considered.
 */
export function dateOnlyRangesOverlap(
  a: DateOnlyRange,
  b: DateOnlyRange,
): boolean {
  const aStartsBeforeBEnds = compareBusinessDates(a.startDate, b.endDate);
  const bStartsBeforeAEnds = compareBusinessDates(b.startDate, a.endDate);
  return (
    aStartsBeforeBEnds !== null &&
    bStartsBeforeAEnds !== null &&
    aStartsBeforeBEnds <= 0 &&
    bStartsBeforeAEnds <= 0
  );
}

/** True when `inner` lies fully inside `outer` (bounds included). */
export function dateOnlyRangeWithin(
  inner: DateOnlyRange,
  outer: DateOnlyRange,
): boolean {
  const innerStartsAfterOuter = compareBusinessDates(
    inner.startDate,
    outer.startDate,
  );
  const innerEndsBeforeOuter = compareBusinessDates(
    inner.endDate,
    outer.endDate,
  );
  return (
    innerStartsAfterOuter !== null &&
    innerEndsBeforeOuter !== null &&
    innerStartsAfterOuter >= 0 &&
    innerEndsBeforeOuter <= 0
  );
}
