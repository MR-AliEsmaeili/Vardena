/**
 * Jalali (Persian) calendar conversion (C-63, ADR-0042).
 *
 * This is the ONLY module in the backend allowed to know a third-party Jalali
 * library exists (AG-11/AR-30; the same isolation rule ADR-0003 applies to
 * external systems). `jalaali-js` implements the exact Borkowski algorithm
 * (Jalaali years −61…3177), is MIT-licensed, dependency-free and ESM — its
 * numeric API is wrapped here so:
 *
 *   * the algorithm is never re-implemented by hand anywhere else;
 *   * the rest of Vardena speaks Gregorian day strings and never a library
 *     type;
 *   * a future replacement (or the `Intl` Persian calendar) is a change to
 *     this file only, covered by the specs beside it.
 *
 * Conversions are pure arithmetic over calendar fields — no `Date` object is
 * constructed here, so no local-timezone behaviour can leak into a calendar
 * conversion (a classic Jalali bug: `new Date(2026, 9, 8)` is a DIFFERENT day
 * depending on the host zone).
 *
 * The library supports Jalaali years −61…3177 (Gregorian ≈ 560…3798), but the
 * public four-digit day shape cannot represent negative Jalali years. The
 * conversion wrapper therefore returns `null` for those renderings and catches
 * the library's boundary exceptions so callers keep the "invalid input never
 * throws, it is rejected" contract of the kernel.
 *
 * Framework-free (AR-05/AR-06).
 */

import {
  MAX_JALAALI_YEAR,
  MIN_JALAALI_YEAR,
  isLeapJalaaliYear,
  isValidJalaaliDate,
  jalaaliMonthLength,
  toGregorian,
  toJalaali,
} from 'jalaali-js';

/** A day named in the Jalali calendar, all fields 1-based where applicable. */
export interface JalaliDay {
  /** Jalali year, e.g. `1405`. */
  year: number;
  /** 1–12; 1 = Farvardin. */
  month: number;
  /** 1–31 (1–30 in the second half of the year). */
  day: number;
}

/** A day named in the Gregorian (proleptic) calendar. */
export interface GregorianDay {
  year: number;
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
}

/** True when the Jalali year is a leap year (366 days) and is supported. */
export function isJalaliLeapYear(year: number): boolean {
  if (!isSupportedJalaliYear(year)) return false;
  return isLeapJalaaliYear(year);
}

/** Number of days in a Jalali month, or `null` outside the supported range. */
export function jalaliMonthLengthOf(
  year: number,
  month: number,
): number | null {
  if (!isSupportedJalaliYear(year) || month < 1 || month > 12) return null;
  return jalaaliMonthLength(year, month);
}

/**
 * True when `(year, month, day)` is a real day of the Jalali calendar —
 * including the leap-year rule (`1405/12/30` exists only in a leap year).
 */
export function isValidJalaliDay(
  year: number,
  month: number,
  day: number,
): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }
  if (!isSupportedJalaliYear(year)) return false;
  return isValidJalaaliDate(year, month, day);
}

/** True when the year can be converted at all (library range −61…3177). */
export function isSupportedJalaliYear(year: number): boolean {
  return (
    Number.isInteger(year) &&
    year >= MIN_JALAALI_YEAR &&
    year <= MAX_JALAALI_YEAR
  );
}

/** True when the Gregorian year maps inside the supported Jalali range. */
export function isSupportedGregorianYear(year: number): boolean {
  // The Jalali year begins in March, so the year that STARTS in Gregorian Y
  // is Y−621; allow a one-year margin on both sides of the range.
  return Number.isInteger(year) && year >= 560 && year <= 3798;
}

/**
 * Jalali day → Gregorian day. `null` when the Jalali date does not exist
 * (bad month/day, leap-day in a common year) or is outside the supported
 * range.
 */
export function jalaliToGregorianDay(
  year: number,
  month: number,
  day: number,
): GregorianDay | null {
  if (!isValidJalaliDay(year, month, day)) return null;
  const converted = toGregorian(year, month, day);
  return { year: converted.gy, month: converted.gm, day: converted.gd };
}

/**
 * Gregorian day → Jalali day. `null` when the Gregorian date does not exist
 * (e.g. `2026-02-30`) or is outside the supported range.
 */
export function gregorianToJalaliDay(
  year: number,
  month: number,
  day: number,
): JalaliDay | null {
  if (!isRealGregorianDay(year, month, day)) return null;
  if (!isSupportedGregorianYear(year)) return null;
  try {
    const converted = toJalaali(year, month, day);
    if (converted.jy < 0 || !isSupportedJalaliYear(converted.jy)) return null;
    return { year: converted.jy, month: converted.jm, day: converted.jd };
  } catch {
    // The library can throw for Gregorian days before/after its exact
    // conversion interval even when the Gregorian year is within our coarse
    // supported-year guard. An unsupported rendering is data, not a crash.
    return null;
  }
}

/** Proleptic-Gregorian day check (the same calendar PostgreSQL `date` uses). */
export function isRealGregorianDay(
  year: number,
  month: number,
  day: number,
): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }
  if (year < 1 || year > 9999) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(0);
  probe.setUTCHours(0, 0, 0, 0);
  probe.setUTCFullYear(year, month - 1, day);
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}
