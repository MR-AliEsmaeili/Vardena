import { convertDay, type CalendarSystem } from './calendar';
import { isBusinessDay } from './business-date';
import { isInstant } from './instant';
import { isTimeZone } from './time-zone';

/**
 * The API boundary of the C-63 date/time model (ADR-0042 §D8).
 *
 * Two shapes cross the wire, and they are deliberately different:
 *
 *  - **Business date** — `{ gregorian, jalali }`: the same calendar DAY;
 *    `gregorian` is canonical and `jalali` is a display-only rendering that is
 *    `null` outside the supported conversion range.
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
  jalali: string | null;
}

export interface ApiInstant {
  instant: string;
  timeZone: string;
  gregorian: string;
  jalali: string | null;
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
 * The fixed Jalali-first UI sends the DECLARED form when the canonical day is
 * renderable as Jalali, so the backend resolves it exactly once. A valid day
 * outside that rendering envelope stays a canonical Gregorian string. The
 * backend continues accepting either form for existing API/integration clients.
 */
export function toBusinessDateInput(day: string): BusinessDateInput {
  if (!isBusinessDay(day)) return day;
  const jalali = convertDay(day, 'GREGORIAN', 'JALALI');
  return jalali === null ? day : { calendar: 'JALALI', value: jalali };
}

/** Narrow an unknown value with a canonical day and nullable Jalali rendering. */
export function readApiBusinessDate(value: unknown): ApiBusinessDate | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.gregorian !== 'string' ||
    (candidate.jalali !== null && typeof candidate.jalali !== 'string')
  ) {
    return null;
  }
  return { gregorian: candidate.gregorian, jalali: candidate.jalali };
}

/**
 * Narrow an unknown value that should be a
 * `{ instant, timeZone, gregorian, jalali|null }` block. The block is only
 * accepted when its `instant`, `timeZone`, and rendering fields are usable: a
 * half-formed block must not replace a locally derived rendering.
 */
export function readApiInstant(value: unknown): ApiInstant | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !isInstant(candidate.instant) ||
    !isTimeZone(candidate.timeZone) ||
    typeof candidate.gregorian !== 'string' ||
    (candidate.jalali !== null && typeof candidate.jalali !== 'string')
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
