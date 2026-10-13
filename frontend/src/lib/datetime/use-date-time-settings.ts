import { useSyncExternalStore } from 'react';
import {
  getDateTimeSettings,
  subscribeDateTimeSettings,
  type DateTimeSettings,
} from './settings';

/** React access to the selected organization's IANA time-zone setting. */
export function useDateTimeSettings(): DateTimeSettings {
  return useSyncExternalStore(
    subscribeDateTimeSettings,
    getDateTimeSettings,
    getDateTimeSettings,
  );
}

/** The active IANA time zone only — the common case for timestamp rendering. */
export function useTimeZone(): string {
  return useDateTimeSettings().timeZone;
}
