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
 * The plain string stays the default (Gregorian, the canonical calendar), so
 * existing clients that send canonical Gregorian day strings keep working
 * unchanged; a Jalali day must be DECLARED. A full ISO-8601 instant remains
 * accepted as a legacy input because event timestamps arrived on these fields
 * before the calendar model existed. The current owner-approved rule resolves
 * one by its UTC calendar day. This aligns with migration 110's conversion of
 * stored UTC carriers, but intentionally differs from the pre-cutover API
 * parser, which first resolved ISO inputs in the organization's zone. It is an
 * input behavior change, not a claim that the former request path already used
 * UTC.
 *
 * Rejections are machine-readable codes ({@link BusinessDateInputRejection});
 * the Persian wording belongs to the caller (the frontend owns user text).
 *
 * Framework-free (AR-05/AR-06).
 */

import { isCalendarSystem, type CalendarSystem } from './calendar-system.js';
import {
  BUSINESS_DATE_PATTERN,
  businessDateFromUtcInstant,
  parseBusinessDate,
  type BusinessDate,
} from './business-date.js';

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
      gregorian: BusinessDate;
      /** Which calendar the caller used (informational/audit). */
      calendar: CalendarSystem;
      /** The caller stated a calendar day (canonical or declared). */
      source: 'day' | 'declared_day';
    }
  | {
      ok: true;
      /** UTC calendar day of the legacy instant. */
      gregorian: BusinessDate;
      calendar: CalendarSystem;
      /**
       * A legacy ISO instant was supplied. The DAY is the value to persist
       * (the columns are PostgreSQL `date` — OQ-73); the instant is carried
       * through for audit/reporting only and is never written to a
       * business-date column.
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
 * Resolve any accepted input into the canonical Gregorian day. Calendar-day
 * input needs no zone; an owner-approved legacy ISO instant uses its UTC day.
 * This request-input rule is distinct from zone-based resolution of "today"
 * and from the pre-cutover API parser behavior documented above.
 */
export function parseBusinessDateInput(
  value: BusinessDateInput,
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
      // Date.parse normalizes some impossible civil dates (for example,
      // February 30) into the following month. Reject the day component
      // before constructing an Instant so a malformed compatibility input
      // can never silently change its UTC BusinessDate.
      if (parseBusinessDate(value.slice(0, 10), 'GREGORIAN') === null) {
        return { ok: false, reason: 'business_date_calendar' };
      }
      const instant = new Date(value);
      if (Number.isNaN(instant.getTime())) {
        return { ok: false, reason: 'business_date_format' };
      }
      const gregorian = businessDateFromUtcInstant(instant);
      if (gregorian === null) {
        return { ok: false, reason: 'business_date_calendar' };
      }
      return {
        ok: true,
        gregorian,
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
