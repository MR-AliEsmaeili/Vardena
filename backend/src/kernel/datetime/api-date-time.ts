/**
 * The standardized API representations of time (C-63 §10/§11, ADR-0042).
 *
 * Two shapes, and only two — no endpoint invents its own:
 *
 *   event timestamps → {@link ApiInstant}
 *     { instant, timeZone, gregorian, jalali }
 *
 *   business dates   → {@link ApiBusinessDate}
 *     { gregorian, jalali|null }
 *
 * Rules that hold for both:
 *
 *   * the canonical field (`instant`, `gregorian`) is AUTHORITATIVE and is
 *     what a client persists or compares;
 *   * the Jalali field is DERIVED from the canonical one, on every request,
 *     from the organization's configured zone/calendar — nothing is stored;
 *   * ASCII digits and fixed shapes only (`YYYY-MM-DD`, `YYYY-MM-DD HH:mm:ss`):
 *     numerals (۱۲۳) and locale formats are a frontend concern (C-63 §32),
 *     and an API value is machine-readable by contract;
 *   * an unavailable Jalali rendering is `null`, never a silently wrong
 *     calendar. A Gregorian BusinessDate remains authoritative; Inventory
 *     callers require a Jalali rendering when the organization uses Jalali.
 *
 * These are DERIVED fields, not a second truth: a response keeps its existing
 * canonical fields exactly as they are and adds the standardized object
 * beside them, so nothing that already consumes the API breaks.
 *
 * Framework-free (AR-05/AR-06).
 */

import { formatBusinessDate } from './business-date.js';
import {
  localDateTimeString,
  localDateTimeParts,
  isTimeZone,
} from './time-zone.js';
import { gregorianToJalaliDay } from './jalali.js';

/** A canonical business day with its optional Jalali rendering. */
export interface ApiBusinessDate {
  /** Canonical day, `YYYY-MM-DD`. */
  gregorian: string;
  /** Derived Jalali day, or `null` outside the supported rendering range. */
  jalali: string | null;
}

/** An event timestamp, canonical + both local renderings. */
export interface ApiInstant {
  /** Authoritative instant, ISO-8601 UTC (`2026-10-08T08:32:14.421Z`). */
  instant: string;
  /** The IANA zone the derived renderings were produced in. */
  timeZone: string;
  /** Derived local Gregorian rendering, `YYYY-MM-DD HH:mm:ss`. */
  gregorian: string;
  /** Derived local Jalali rendering, `YYYY-MM-DD HH:mm:ss`. */
  jalali: string;
}

/** The one local date-time rendering shape (derived, never persisted). */
export const LOCAL_DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

/**
 * Build the standardized business-date representation of a canonical
 * Gregorian day. `null` only when the canonical day is invalid; Jalali is null
 * when that valid day cannot be rendered in the supported conversion range.
 */
export function toApiBusinessDate(
  gregorianDay: string,
): ApiBusinessDate | null {
  if (formatBusinessDate(gregorianDay, 'GREGORIAN') === null) return null;
  return {
    gregorian: gregorianDay,
    jalali: formatBusinessDate(gregorianDay, 'JALALI'),
  };
}

/**
 * Build the standardized instant representation of an event timestamp in
 * `timeZone`. `null` when the zone is unknown, the instant is invalid, or the
 * Jalali rendering is outside the supported range.
 */
export function toApiInstant(
  instant: Date,
  timeZone: string,
): ApiInstant | null {
  if (!isTimeZone(timeZone)) return null;
  if (Number.isNaN(instant.getTime())) return null;
  const jalali = renderLocalJalaliDateTime(instant, timeZone);
  if (jalali === null) return null;
  return {
    instant: instant.toISOString(),
    timeZone,
    gregorian: localDateTimeString(instant, timeZone),
    jalali,
  };
}

/**
 * `YYYY-MM-DD HH:mm:ss` in the Jalali calendar for `instant` in `timeZone`.
 *
 * The local time-of-day is the organization-zone time-of-day; only the day is
 * re-named by the calendar. `null` outside the supported Jalali range.
 */
export function renderLocalJalaliDateTime(
  instant: Date,
  timeZone: string,
): string | null {
  const parts = localDateTimeParts(instant, timeZone);
  const jalali = gregorianToJalaliDay(parts.year, parts.month, parts.day);
  if (jalali === null) return null;
  return (
    `${pad(jalali.year, 4)}-${pad(jalali.month)}-${pad(jalali.day)} ` +
    `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
  );
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}
