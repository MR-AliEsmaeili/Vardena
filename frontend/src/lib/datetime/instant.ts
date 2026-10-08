import {
  DATE_TIME_DISPLAY_FORMAT,
  DATE_TIME_SECONDS_DISPLAY_FORMAT,
  dayjs,
} from './dayjs';
import { todayBusinessDay } from './business-date';

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

/** True when `value` parses as an instant the runtime can render. */
export function isInstant(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && dayjs(value).isValid();
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
): string {
  if (!value) return '';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.tz(timeZone).format(format) : value;
}

/** The instant rendered with seconds (detail and audit surfaces). */
export function formatInstantWithSeconds(
  value: string | null | undefined,
  timeZone: string,
): string {
  return formatInstant(value, timeZone, DATE_TIME_SECONDS_DISPLAY_FORMAT);
}

/** The calendar day an instant falls on in `timeZone` (never its UTC day). */
export function instantDayInZone(
  value: string,
  timeZone: string,
): string | null {
  const parsed = dayjs(value);
  if (!parsed.isValid()) return null;
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
  const parsed = dayjs(value);
  if (!parsed.isValid()) return null;
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
