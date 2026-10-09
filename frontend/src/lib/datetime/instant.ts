import {
  DATE_DISPLAY_FORMAT,
  DATE_TIME_DISPLAY_FORMAT,
  DATE_TIME_SECONDS_DISPLAY_FORMAT,
  dayjs,
} from './dayjs';
import {
  formatBusinessDay,
  isBusinessDay,
  todayBusinessDay,
} from './business-date';
import type { CalendarSystem } from './calendar';
import { isTimeZone } from './time-zone';

/**
 * Event timestamps (C-63 §10, ADR-0042 §D1).
 *
 * A timestamp is an INSTANT: it answers "when did this happen", it is stored
 * as `timestamptz`, and it travels as ISO-8601 UTC. Rendering it is a
 * derivation — instant → organization time zone → local date/time → calendar
 * — and it happens here and nowhere else, so a component can never add an
 * offset by hand or show a UTC value as if it were local.
 *
 * Historical records are rendered with the organization settings in effect
 * NOW (ADR-0042 §D6 policy A): the rendering is presentational, the stored
 * instant is the truth, and the settings that produced a historical rendering
 * are not retained. Detail views therefore show the zone name next to the
 * value (`instantTimeZoneLabel`), so the rendering can never be mistaken for
 * a fact about the record itself.
 */

const UTC_INSTANT_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

/** True when `value` is a valid UTC instant from the API, never a local time. */
export function isInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = UTC_INSTANT_PATTERN.exec(value);
  if (match === null || !isBusinessDay(match[1]!)) return false;
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) {
    return false;
  }
  return dayjs(value).isValid();
}

/**
 * The instant rendered in `timeZone` (default: minute precision, the shape the
 * rest of the UI uses). An unparsable value is returned UNCHANGED rather than
 * blanked or approximated — an unexpected server value must stay visible.
 */
export function formatInstant(
  value: string | null | undefined,
  timeZone: string,
  format: string = DATE_TIME_DISPLAY_FORMAT,
  calendarSystem: CalendarSystem = 'GREGORIAN',
): string {
  if (!value) return '';
  if (!isInstant(value) || !isTimeZone(timeZone)) return value;
  const parsed = dayjs(value);

  // Resolve the local day in the organization's IANA zone FIRST, then render
  // that day in its configured calendar. Converting the UTC day instead would
  // be wrong around zone boundaries (the instant remains authoritative).
  const zoned = parsed.tz(timeZone);
  const gregorianDay = zoned.format(DATE_DISPLAY_FORMAT);
  const rendered = zoned.format(format);
  if (!rendered.startsWith(gregorianDay)) return rendered;
  return `${formatBusinessDay(gregorianDay, calendarSystem)}${rendered.slice(
    gregorianDay.length,
  )}`;
}

/** The instant rendered with seconds (detail and audit surfaces). */
export function formatInstantWithSeconds(
  value: string | null | undefined,
  timeZone: string,
  calendarSystem: CalendarSystem = 'GREGORIAN',
): string {
  return formatInstant(
    value,
    timeZone,
    DATE_TIME_SECONDS_DISPLAY_FORMAT,
    calendarSystem,
  );
}

/** The calendar day an instant falls on in `timeZone` (never its UTC day). */
export function instantDayInZone(
  value: string,
  timeZone: string,
): string | null {
  if (!isInstant(value) || !isTimeZone(timeZone)) return null;
  const parsed = dayjs(value);
  const day = parsed.tz(timeZone).format('YYYY-MM-DD');
  return day === 'Invalid Date' ? null : day;
}

/**
 * The zone's offset at `value`, as `UTC+03:30` — the label a detail view
 * shows next to a rendered timestamp so the zone is explicit.
 *
 * Resolved by the runtime for THAT instant (an offset is not a constant:
 * Tehran was `UTC+04:30` in 1401 and is `UTC+03:30` today), and derived by
 * Day.js rather than by hand. Returns `null` when the value cannot be parsed.
 */
export function instantOffsetLabel(
  value: string,
  timeZone: string,
): string | null {
  if (!isInstant(value) || !isTimeZone(timeZone)) return null;
  const parsed = dayjs(value);
  const minutes = parsed.tz(timeZone).utcOffset();
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const rest = String(absolute % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${rest}`;
}

/**
 * `Asia/Tehran (UTC+03:30)` — the label of the zone an instant is rendered
 * in, for the detail views that must not hide where the time came from.
 */
export function instantTimeZoneLabel(value: string, timeZone: string): string {
  const offset = instantOffsetLabel(value, timeZone);
  return offset === null ? timeZone : `${timeZone} (${offset})`;
}

/** Today's business day in `timeZone` — re-exported for form defaults. */
export { todayBusinessDay };
