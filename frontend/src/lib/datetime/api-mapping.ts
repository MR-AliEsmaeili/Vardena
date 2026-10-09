import { convertDay, type CalendarSystem } from './calendar';
import { isBusinessDay } from './business-date';

/**
 * The API boundary of the C-63 date/time model (ADR-0042 §D8).
 *
 * Two shapes cross the wire, and they are deliberately different:
 *
 *  - **Business date** — `{ gregorian, jalali }`: the same calendar DAY in
 *    both calendars. The Gregorian member is canonical; the Jalali member is
 *    a rendering, usable for display only, never for arithmetic.
 *  - **Instant** — `{ instant, timeZone, gregorian, jalali }`: the ISO-8601
 *    UTC instant is authoritative; the two renderings were resolved in
 *    `timeZone` by the backend and are display values.
 *  - **Declared business date input** — `{ calendar, value }`: what the
 *    frontend SENDS when the operator typed a Jalali day. Sending the day the
 *    user actually wrote, plus the calendar it is written in, is the only way
 *    the two `YYYY-MM-DD` shapes can be told apart; the backend converts once.
 *
 * Nothing here parses a date for computation: parsed values are handed to the
 * formatters, so a raw date string cannot leak into a component.
 */

export interface ApiBusinessDate {
  gregorian: string;
  jalali: string;
}

export interface ApiInstant {
  instant: string;
  timeZone: string;
  gregorian: string;
  jalali: string;
}

export interface DeclaredBusinessDate {
  calendar: CalendarSystem;
  value: string;
}

/** The request body form of a business day: a declared day, or canonical. */
export type BusinessDateInput = string | DeclaredBusinessDate;

/**
 * What the frontend sends for a business day.
 *
 * A Jalali organization sends the DECLARED form — the day the operator wrote,
 * plus the calendar it is written in — so the request carries the calendar the
 * user worked in and the backend resolves it exactly once. A Gregorian
 * organization (or a day that is not canonical) sends the day unchanged:
 * `YYYY-MM-DD` is Gregorian by contract.
 */
export function toBusinessDateInput(
  day: string,
  calendar: CalendarSystem,
): BusinessDateInput {
  if (calendar === 'GREGORIAN' || !isBusinessDay(day)) return day;
  const jalali = convertDay(day, 'GREGORIAN', 'JALALI');
  return jalali === null ? day : { calendar: 'JALALI', value: jalali };
}

/** Narrow an unknown value that should be a `{ gregorian, jalali }` pair. */
export function readApiBusinessDate(value: unknown): ApiBusinessDate | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.gregorian !== 'string' ||
    typeof candidate.jalali !== 'string'
  ) {
    return null;
  }
  return { gregorian: candidate.gregorian, jalali: candidate.jalali };
}

/**
 * Narrow an unknown value that should be a
 * `{ instant, timeZone, gregorian, jalali }` block. The block is only accepted
 * when its `instant` and `timeZone` are usable: a half-formed block must not
 * replace a locally derived rendering.
 */
export function readApiInstant(value: unknown): ApiInstant | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.instant !== 'string' ||
    candidate.instant === '' ||
    typeof candidate.timeZone !== 'string' ||
    typeof candidate.gregorian !== 'string' ||
    typeof candidate.jalali !== 'string'
  ) {
    return null;
  }
  return {
    instant: candidate.instant,
    timeZone: candidate.timeZone,
    gregorian: candidate.gregorian,
    jalali: candidate.jalali,
  };
}
