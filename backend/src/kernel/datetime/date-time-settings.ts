/**
 * The date/time settings a rendering or day-authoring path needs (C-63,
 * ADR-0042 §6).
 *
 * Two values, deliberately: which calendar days are named in, and which IANA
 * zone an instant is resolved in. They are TECHNICAL configuration (they say
 * how to render, never what happened), which is why they live in the kernel
 * and every module may depend on the type without depending on the
 * Organization module (AR-06/AR-07). The Organization module owns the
 * durable record; consumers receive the value.
 *
 * Framework-free (AR-05/AR-06).
 */

import {
  DEFAULT_CALENDAR_SYSTEM,
  type CalendarSystem,
} from './calendar-system.js';
import { DEFAULT_TIME_ZONE } from './time-zone.js';

export interface DateTimeSettings {
  /** Calendar days are named in (rendering + authoring). */
  calendarSystem: CalendarSystem;
  /** IANA zone used to resolve an instant to a local date-time. */
  timeZone: string;
}

/**
 * The settings in effect when nothing states otherwise: Vardena's Persian
 * business default (C-63 §4/§5). It is a DEFAULT — the Organization module
 * stores the real value per organization, and no module may branch on this
 * constant instead of reading that.
 */
export const DEFAULT_DATE_TIME_SETTINGS: DateTimeSettings = {
  calendarSystem: DEFAULT_CALENDAR_SYSTEM,
  timeZone: DEFAULT_TIME_ZONE,
};
