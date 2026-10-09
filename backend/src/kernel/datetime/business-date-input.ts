/**
 * Business-date INPUT parsing (C-63 §16, ADR-0042).
 *
 * A Persian business user writes `1405-07-16`; a machine writes
 * `2026-10-08`. Both are `YYYY-MM-DD`, so a bare string cannot say which
 * calendar it is in — and guessing would silently re-date documents by
 * centuries. The input contract therefore makes the calendar explicit:
 *
 *   "businessDate": "2026-10-08"                                // canonical
 *   "businessDate": { "calendar": "JALALI", "value": "1405-07-16" }
 *
 * The plain string stays the default (Gregorian, the canonical calendar) so
 * every existing client keeps working unchanged; a Jalali day must be
 * DECLARED. A full ISO-8601 instant is also accepted, because event timestamps
 * arrived on these fields before the calendar model existed; when one is
 * given, the day it names is resolved in the organization's time zone.
 *
 * Rejections are machine-readable codes ({@link BusinessDateInputRejection});
 * the Persian wording belongs to the caller (the frontend owns user text).
 *
 * Framework-free (AR-05/AR-06).
 */

import { isCalendarSystem, type CalendarSystem } from './calendar-system.js';
import {
  BUSINESS_DATE_PATTERN,
  businessDateFromInstant,
  parseBusinessDate,
} from './business-date.js';
import { DEFAULT_TIME_ZONE } from './time-zone.js';

/**
 * A day whose calendar the caller declares explicitly.
 *
 * The declaration is required precisely because `1405-07-16` and `2026-10-08`
 * are indistinguishable by shape.
 */
export interface DeclaredBusinessDateInput {
  calendar: CalendarSystem;
  /** `YYYY-MM-DD` in `calendar`. */
  value: string;
}

/** Accepted business-date input: a canonical string, or a declared calendar. */
export type BusinessDateInput = string | DeclaredBusinessDateInput;

/** Stable refusal codes (never user-facing prose). */
export type BusinessDateInputRejection =
  | 'business_date_format'
  | 'business_date_calendar'
  | 'business_date_declaration';

export type BusinessDateInputResult =
  | {
      ok: true;
      /** Canonical Gregorian day — the value to persist/return. */
      gregorian: string;
      /** Which calendar the caller used (informational/audit). */
      calendar: CalendarSystem;
      /** The caller stated a calendar day (canonical or declared). */
      source: 'day' | 'declared_day';
    }
  | {
      ok: true;
      /** The calendar day that instant falls on in the resolved zone. */
      gregorian: string;
      calendar: CalendarSystem;
      /**
       * A legacy ISO instant was supplied. Carried through UNCHANGED so a
       * column that stores the instant (the inventory ledger's day axis)
       * keeps exactly the value the caller sent — the day is the derived
       * part, never the other way round.
       */
      source: 'instant';
      instant: Date;
    }
  | { ok: false; reason: BusinessDateInputRejection };

/** ISO-8601 instant shape accepted for backward compatibility. */
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * True when `value` is a well-formed business-date input of either form.
 *
 * Shape-only on purpose (mirrors `@IsDateString`'s role in the existing DTOs):
 * the *calendar* validity check belongs to {@link parseBusinessDateInput},
 * which the application layer calls so it can report one precise reason.
 */
export function isBusinessDateInput(
  value: unknown,
): value is BusinessDateInput {
  if (typeof value === 'string') {
    return BUSINESS_DATE_PATTERN.test(value) || ISO_INSTANT_PATTERN.test(value);
  }
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== 2 ||
    !keys.includes('calendar') ||
    !keys.includes('value')
  ) {
    return false;
  }
  return (
    isCalendarSystem(candidate['calendar']) &&
    typeof candidate['value'] === 'string' &&
    BUSINESS_DATE_PATTERN.test(candidate['value'])
  );
}

/**
 * Resolve any accepted input into the canonical Gregorian day.
 *
 * `timeZone` is only consulted for a full instant (the day it names is
 * resolved there, because "which day was that, for this organization?" is the
 * business question); a day value needs no zone at all.
 */
export function parseBusinessDateInput(
  value: BusinessDateInput,
  options: { timeZone?: string } = {},
): BusinessDateInputResult {
  if (typeof value === 'string') {
    if (BUSINESS_DATE_PATTERN.test(value)) {
      const parsed = parseBusinessDate(value, 'GREGORIAN');
      if (parsed === null)
        return { ok: false, reason: 'business_date_calendar' };
      return {
        ok: true,
        gregorian: parsed.gregorian,
        calendar: 'GREGORIAN',
        source: 'day',
      };
    }
    if (ISO_INSTANT_PATTERN.test(value)) {
      const instant = new Date(value);
      if (Number.isNaN(instant.getTime())) {
        return { ok: false, reason: 'business_date_format' };
      }
      return {
        ok: true,
        gregorian: businessDateFromInstant(
          instant,
          options.timeZone ?? DEFAULT_TIME_ZONE,
        ),
        calendar: 'GREGORIAN',
        source: 'instant',
        instant,
      };
    }
    return { ok: false, reason: 'business_date_format' };
  }

  if (!isBusinessDateInput(value)) {
    return { ok: false, reason: 'business_date_declaration' };
  }
  const parsed = parseBusinessDate(value.value, value.calendar);
  if (parsed === null) {
    // A well-declared calendar with a day that does not exist in it — the
    // distinction the frontend needs to say "30 Esfand does not exist this
    // year" instead of "bad format".
    return { ok: false, reason: 'business_date_calendar' };
  }
  return {
    ok: true,
    gregorian: parsed.gregorian,
    calendar: parsed.calendar,
    source: 'declared_day',
  };
}
