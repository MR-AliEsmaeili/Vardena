import {
  DEFAULT_CALENDAR_SYSTEM,
  isCalendarSystem,
  type CalendarSystem,
} from './calendar';
import { DEFAULT_TIME_ZONE, isTimeZone } from './time-zone';

/**
 * The active date/time settings (C-63 §17, ADR-0042 §D5).
 *
 * The organization owns two values — `calendarSystem` and `timeZone` — and the
 * whole UI renders through them. They live in ONE external store rather than a
 * React context because the consumers are not only components: the API mapping
 * (`./api-mapping`) and the form defaults also need the current settings, and
 * threading a context through them would force every helper to take a
 * parameter it must never invent. `OrganizationContext` publishes the selected
 * organization's settings here once per change; everything else reads.
 *
 * The store NEVER invents a calendar for a known organization: a value the
 * backend did not send (an older deployment) leaves the previous value in
 * place, and only an explicit `null`/`undefined` reset falls back to the
 * product defaults (JALALI / Asia/Tehran).
 */

export interface DateTimeSettings {
  /** The calendar the UI renders and accepts input in. */
  calendarSystem: CalendarSystem;
  /** The IANA zone event timestamps are rendered in. */
  timeZone: string;
}

/** Product defaults, mirrored from the backend kernel. */
export const DEFAULT_DATE_TIME_SETTINGS: DateTimeSettings = {
  calendarSystem: DEFAULT_CALENDAR_SYSTEM,
  timeZone: DEFAULT_TIME_ZONE,
};

/**
 * Read a partial/untrusted settings shape (an API response, a test fixture)
 * into complete settings, falling back per FIELD: an unknown calendar or zone
 * never poisons the other value, and never reaches a formatter.
 */
export function resolveDateTimeSettings(
  source: { calendarSystem?: unknown; timeZone?: unknown } | null | undefined,
): DateTimeSettings {
  const calendarSystem = isCalendarSystem(source?.calendarSystem)
    ? source.calendarSystem
    : DEFAULT_DATE_TIME_SETTINGS.calendarSystem;
  const timeZone = isTimeZone(source?.timeZone)
    ? source.timeZone
    : DEFAULT_DATE_TIME_SETTINGS.timeZone;
  return { calendarSystem, timeZone };
}

let current: DateTimeSettings = DEFAULT_DATE_TIME_SETTINGS;

const listeners = new Set<() => void>();

/** The settings every formatter and field reads. Stable between changes. */
export function getDateTimeSettings(): DateTimeSettings {
  return current;
}

/** Subscribe to settings changes (the `useSyncExternalStore` contract). */
export function subscribeDateTimeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Publish the active organization's settings. Accepts a partial shape (the
 * API may omit either field) and is a NO-OP when the resolved settings equal
 * the current ones, so an unrelated re-render cannot churn every consumer.
 */
export function setDateTimeSettings(
  source: { calendarSystem?: unknown; timeZone?: unknown } | null | undefined,
): DateTimeSettings {
  const resolved = resolveDateTimeSettings(source);
  if (
    resolved.calendarSystem !== current.calendarSystem ||
    resolved.timeZone !== current.timeZone
  ) {
    current = resolved;
    for (const listener of [...listeners]) listener();
  }
  return current;
}

/** Return to the product defaults (tests, and a signed-out session). */
export function resetDateTimeSettings(): DateTimeSettings {
  return setDateTimeSettings(null);
}
