/**
 * Time zones (C-63, ADR-0042).
 *
 * A time zone is an IANA identifier (`Asia/Tehran`, `Europe/Berlin`,
 * `UTC`) — never a numeric offset. Offsets are NOT constants: `Asia/Tehran`
 * observed daylight saving time until 1401 (2022) and stopped; a stored
 * `+03:30` would have been wrong for half of Vardena's history. Every offset
 * used here is therefore resolved by the RUNTIME for the instant in question
 * (`Intl.DateTimeFormat` with `timeZone`), so the platform's tz database — not
 * Vardena — owns the rules, including historical ones.
 *
 * Framework-free (AR-05/AR-06): pure functions over the platform API.
 */

/**
 * The time zone a Vardena installation uses until an organization says
 * otherwise (C-63 §5). Like the calendar default this is a DEFAULT: the
 * organization owns `organization.organizations.time_zone`.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Tehran';

/** The zone Vardena always has, whatever the organization configures. */
export const UTC_TIME_ZONE = 'UTC';

let supportedTimeZones: Set<string> | undefined;

function timeZoneSet(): Set<string> {
  supportedTimeZones ??= new Set(
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [],
  );
  return supportedTimeZones;
}

/**
 * A bare numeric offset (`+03:30`, `+0330`, `-04`) — never a valid Vardena
 * time zone, even though the runtime happens to accept one as a "zone id"
 * (an offset has no rules, so it cannot stay correct across a DST change or a
 * zone-policy change; that is the whole point of ADR-0042 §5).
 */
const NUMERIC_OFFSET_PATTERN = /^[+-]\d{2}(?::?\d{2})?$/;

/**
 * True when `value` is an IANA time zone this runtime can resolve.
 *
 * `Intl.supportedValuesOf('timeZone')` lists the canonical zones; the
 * `Intl.DateTimeFormat` probe is the fallback (it also accepts long-standing
 * aliases such as `Asia/Calcutta`). `UTC` is accepted explicitly because the
 * canonical list omits it, and numeric offsets are rejected explicitly because
 * the probe accepts them.
 */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (NUMERIC_OFFSET_PATTERN.test(value)) return false;
  if (value === UTC_TIME_ZONE) return true;
  if (timeZoneSet().has(value)) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The explicit parts of an instant in one time zone (no arithmetic here). */
export interface LocalDateTimeParts {
  year: number;
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = PARTS_FORMATTERS.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    PARTS_FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * The calendar parts an instant has in `timeZone`.
 *
 * This is the ONLY place a zone is applied: callers never add or subtract an
 * offset themselves (`instant - offset` arithmetic is exactly the hardcoded
 * math ADR-0042 forbids).
 *
 * @throws {RangeError} when `timeZone` is not resolvable.
 */
export function localDateTimeParts(
  instant: Date,
  timeZone: string,
): LocalDateTimeParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new RangeError(
        `Time zone "${timeZone}" produced no "${type}" part for ${instant.toISOString()}.`,
      );
    }
    return Number(part.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/**
 * The offset of `timeZone` at `instant`, in minutes (east of UTC positive).
 *
 * Derived from {@link localDateTimeParts} — the runtime's own rules for THAT
 * instant — never from a table.
 *
 * @throws {RangeError} when `timeZone` is not resolvable.
 */
export function utcOffsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = localDateTimeParts(instant, timeZone);
  // `Date.UTC` remaps years 0–99 to 1900–1999. Preserve the calendar year
  // explicitly so historical four-digit Instants keep their real offset.
  const projectedUtc = new Date(0);
  projectedUtc.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  projectedUtc.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  const asUtc = projectedUtc.getTime();
  // Second-resolution comparison: both sides carry whole seconds.
  const minutes = Math.round((asUtc - instant.getTime()) / 60_000);
  // `-0` is mathematically 0 and must never leak into a stored/config value.
  return minutes === 0 ? 0 : minutes;
}

/** `YYYY-MM-DD` of the calendar day `instant` falls on in `timeZone`. */
export function calendarDayInTimeZone(instant: Date, timeZone: string): string {
  const parts = localDateTimeParts(instant, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * `YYYY-MM-DD HH:mm:ss` of `instant` in `timeZone`.
 *
 * The one local rendering shape (C-63 §11): deterministic, second precision,
 * no locale-dependent formatting, no numerals other than ASCII — display
 * shaping belongs to the frontend.
 */
export function localDateTimeString(instant: Date, timeZone: string): string {
  const parts = localDateTimeParts(instant, timeZone);
  return (
    `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}` +
    ` ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
  );
}

/** The current calendar day in `timeZone` (calendar-aware "today"). */
export function todayInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): string {
  return calendarDayInTimeZone(now, timeZone);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}
