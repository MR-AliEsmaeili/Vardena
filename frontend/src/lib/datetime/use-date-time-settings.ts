import { useSyncExternalStore } from 'react';
import {
  getDateTimeSettings,
  subscribeDateTimeSettings,
  type DateTimeSettings,
} from './settings';
import type { CalendarSystem } from './calendar';

/**
 * React access to the active date/time settings (C-63 §17).
 *
 * Reads go through `useSyncExternalStore`, so a screen re-renders exactly when
 * the organization's calendar or zone changes — never on an unrelated render,
 * and never from a duplicated copy of the settings held in component state.
 */

/** The active settings (`{ calendarSystem, timeZone }`). */
export function useDateTimeSettings(): DateTimeSettings {
  return useSyncExternalStore(
    subscribeDateTimeSettings,
    getDateTimeSettings,
    getDateTimeSettings,
  );
}

/** The active calendar only — the common case for form fields. */
export function useCalendarSystem(): CalendarSystem {
  return useDateTimeSettings().calendarSystem;
}

/** The active IANA time zone only — the common case for timestamp rendering. */
export function useTimeZone(): string {
  return useDateTimeSettings().timeZone;
}
