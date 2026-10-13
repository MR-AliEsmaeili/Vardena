import { DEFAULT_TIME_ZONE, isTimeZone } from './time-zone';

/**
 * The active date/time settings. The organization owns its IANA time zone;
 * Jalali is a fixed MVP presentation policy, not mutable configuration.
 *
 * The external store remains useful to components, formatters, form defaults
 * and API mapping, all of which need one coherent organization zone. A legacy
 * `calendarSystem` response property is deliberately ignored so stale server
 * data cannot change the fixed Jalali-first experience.
 */

export interface DateTimeSettings {
  /** The IANA zone event timestamps are rendered in. */
  timeZone: string;
}

/** Product defaults, mirrored from the backend kernel. */
export const DEFAULT_DATE_TIME_SETTINGS: DateTimeSettings = {
  timeZone: DEFAULT_TIME_ZONE,
};

type DateTimeSettingsSource =
  { calendarSystem?: unknown; timeZone?: unknown } | null | undefined;

/** Resolve the organization zone; any obsolete calendar field is ignored. */
export function resolveDateTimeSettings(
  source: DateTimeSettingsSource,
): DateTimeSettings {
  const timeZone = isTimeZone(source?.timeZone)
    ? source.timeZone
    : DEFAULT_DATE_TIME_SETTINGS.timeZone;
  return { timeZone };
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

/** Publish the selected organization's zone, ignoring legacy calendar data. */
export function setDateTimeSettings(
  source: DateTimeSettingsSource,
): DateTimeSettings {
  const resolved = resolveDateTimeSettings(source);
  if (resolved.timeZone !== current.timeZone) {
    current = resolved;
    for (const listener of [...listeners]) listener();
  }
  return current;
}

/** Return to the product defaults (tests, and a signed-out session). */
export function resetDateTimeSettings(): DateTimeSettings {
  return setDateTimeSettings(null);
}
