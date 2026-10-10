/**
 * The date/time settings a rendering or day-authoring path needs (C-63,
 * ADR-0042 §6).
 *
 * The one organization-specific value is the IANA time zone used to resolve
 * Instants. Calendar display is a fixed Jalali-first MVP policy, not mutable
 * configuration. This is TECHNICAL configuration (it says how to interpret
 * local time, never what happened), which is why it lives in the kernel and
 * every module may depend on the type without depending on Organization
 * persistence (AR-06/AR-07). The Organization module owns the durable record;
 * consumers receive the value.
 *
 * Framework-free (AR-05/AR-06).
 */

import { DEFAULT_TIME_ZONE } from './time-zone.js';

export interface DateTimeSettings {
  /** IANA zone used to resolve an instant to a local date-time. */
  timeZone: string;
}

/**
 * The deployment time-zone default. The MVP display calendar is fixed to
 * Jalali in the UI; it is not an organization setting. Keeping that policy
 * outside this per-organization value prevents a stale legacy DB column from
 * changing date behavior.
 */
export const DEFAULT_DATE_TIME_SETTINGS: DateTimeSettings = {
  timeZone: DEFAULT_TIME_ZONE,
};
