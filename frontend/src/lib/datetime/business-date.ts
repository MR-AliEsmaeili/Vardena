import {
  BUSINESS_DATE_PATTERN,
  DEFAULT_CALENDAR_SYSTEM,
  convertDay,
  isGregorianDay,
  isValidDayInCalendar,
  parseDayParts,
  type CalendarSystem,
} from './calendar';
import { dayjs } from './dayjs';
import { toLatinDigits } from './numerals';

/**
 * Business dates (C-63 §9, ADR-0042 §D2).
 *
 * A business date is a CALENDAR DAY — the day a document belongs to
 * economically — not an instant. On the wire the canonical form is always the
 * Gregorian `YYYY-MM-DD`; Jalali is a rendering of that same day, and the
 * frontend only ever converts at the edges (this module), never inside a
 * component.
 *
 * The one convenience the ledger needs: modules that store their day in a
 * timestamp column carry it as the day's UTC-midnight instant
 * (`${day}T00:00:00.000Z`). That convention is defined ONCE here, so the
 * backend and the frontend cannot drift.
 */

const LEDGER_INSTANT_SUFFIX = 'T00:00:00.000Z';

/** True when `value` is a real canonical (Gregorian) business day. */
export function isBusinessDay(value: string): boolean {
  return isGregorianDay(value);
}

/**
 * The UTC-midnight instant of a business day — the value timestamp-backed
 * business-day columns (and their filters) already use.
 *
 * A timestamp column is the ledger's ordering axis, so its day is the UTC day
 * of the stored instant; deriving it in the organization's zone would shift
 * the day for zones west of UTC. Returns `''` for a day that is not canonical.
 */
export function businessDayToInstantIso(day: string): string {
  return isBusinessDay(day) ? `${day}${LEDGER_INSTANT_SUFFIX}` : '';
}

/** The business day a timestamp-backed value carries (its UTC day). */
export function businessDayFromInstantIso(instant: string): string | null {
  if (typeof instant !== 'string' || instant.length < 10) return null;
  const day = instant.slice(0, 10);
  return isBusinessDay(day) ? day : null;
}

/**
 * Today, as a business day of `timeZone` — the default every date field
 * starts from. Never the browser's own midnight: a document dated "today" in
 * Tehran must not become yesterday because the operator's laptop is in another
 * zone (C-63 §5).
 */
export function todayBusinessDay(
  timeZone: string,
  now: Date = new Date(),
): string {
  return dayjs(now).tz(timeZone).format('YYYY-MM-DD');
}

/** `YYYY/MM/DD` for Jalali, unchanged `YYYY-MM-DD` for Gregorian. */
export function formatBusinessDay(
  day: string,
  calendar: CalendarSystem = DEFAULT_CALENDAR_SYSTEM,
): string {
  if (!isBusinessDay(day)) return day;
  if (calendar === 'GREGORIAN') return day;
  const jalali = convertDay(day, 'GREGORIAN', 'JALALI');
  return jalali === null ? day : jalali.replace(/-/g, '/');
}

/**
 * The business day in the display calendar, with the canonical Gregorian day
 * in parentheses — for detail views and audit surfaces, where the user must
 * be able to reconcile what they see with what the API stores.
 */
export function formatBusinessDayWithCanonical(
  day: string,
  calendar: CalendarSystem = DEFAULT_CALENDAR_SYSTEM,
): string {
  if (calendar === 'GREGORIAN' || !isBusinessDay(day)) {
    return formatBusinessDay(day, calendar);
  }
  return `${formatBusinessDay(day, 'JALALI')} (${day})`;
}

/**
 * Resolve what an operator TYPED into a canonical business day, or `null`
 * while the text is not (yet) a complete, valid day of `calendar`.
 *
 * Accepts `1405/07/16`, `1405-07-16`, Persian digits, and a genuinely typo'd
 * short month (`1405/7/6`): all of them are the same instruction, and a Jalali
 * user's keyboard produces all of them. The single `null` answer covers
 * "still typing" and "invalid" because the field renders both the same way —
 * as "not a usable day yet".
 */
export function resolveDayInput(
  text: string,
  calendar: CalendarSystem = DEFAULT_CALENDAR_SYSTEM,
): string | null {
  const normalized = toLatinDigits(text.trim()).replace(/[/.]/g, '-');
  if (!BUSINESS_DATE_PATTERN.test(normalized)) {
    // A human types `1405/7/6` as readily as `1405/07/06`; both are the same
    // day. Pad the parts and let the strict parser decide validity below.
    const lenient = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
    if (lenient === null) return null;
    return resolveDayInput(
      `${lenient[1]!.padStart(4, '0')}-${lenient[2]!.padStart(2, '0')}-${lenient[3]!.padStart(2, '0')}`,
      calendar,
    );
  }
  const parts = parseDayParts(normalized);
  if (parts === null) return null;
  const padded = `${String(parts.year).padStart(4, '0')}-${String(
    parts.month,
  ).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  if (!isValidDayInCalendar(padded, calendar)) return null;
  // A canonical day is ALWAYS Gregorian: the declared calendar only says how
  // to read the input, never what to store.
  return convertDay(padded, calendar, 'GREGORIAN');
}

/**
 * The Jalali rendering of a canonical day, or `null` when the day is not
 * canonical or outside the Jalali library's supported range.
 */
export function jalaliDayOf(day: string): string | null {
  if (!BUSINESS_DATE_PATTERN.test(day)) return null;
  return convertDay(day, 'GREGORIAN', 'JALALI');
}
