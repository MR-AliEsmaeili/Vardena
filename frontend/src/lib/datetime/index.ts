/**
 * The date/time layer — ONE entry point (C-63 §17, ADR-0042).
 *
 * Everything a screen needs for dates comes from here: the active settings,
 * the calendar conversion, the day/instant formatters and the API boundary.
 * A component that imports `dayjs` or the Jalali library directly, or that
 * converts a calendar itself, is duplicating this layer.
 */

export {
  BUSINESS_DATE_PATTERN,
  CALENDAR_SYSTEMS,
  DEFAULT_CALENDAR_SYSTEM,
  convertDay,
  formatDayParts,
  gregorianDayToJalaliDay,
  isCalendarSystem,
  isGregorianDay,
  isJalaliLeapYear,
  isValidDayInCalendar,
  jalaliDayToGregorianDay,
  jalaliMonthLengthOf,
  parseDayParts,
  type CalendarSystem,
  type DayParts,
} from './calendar';
export { containsNonLatinDigits, toLatinDigits } from './numerals';
export {
  DATE_DISPLAY_FORMAT,
  DATE_TIME_DISPLAY_FORMAT,
  DATE_TIME_SECONDS_DISPLAY_FORMAT,
  dayjs,
} from './dayjs';
export { DEFAULT_TIME_ZONE, UTC_TIME_ZONE, isTimeZone } from './time-zone';
export {
  formatBusinessDay,
  formatBusinessDayWithCanonical,
  isBusinessDay,
  jalaliDayOf,
  resolveDayInput,
  todayBusinessDay,
} from './business-date';
export {
  formatInstant,
  formatInstantWithSeconds,
  instantDayInZone,
  instantOffsetLabel,
  instantTimeZoneLabel,
  isInstant,
} from './instant';
export {
  DEFAULT_DATE_TIME_SETTINGS,
  getDateTimeSettings,
  resetDateTimeSettings,
  resolveDateTimeSettings,
  setDateTimeSettings,
  subscribeDateTimeSettings,
  type DateTimeSettings,
} from './settings';
export {
  useCalendarSystem,
  useDateTimeSettings,
  useTimeZone,
} from './use-date-time-settings';
export {
  readApiBusinessDate,
  readApiInstant,
  toBusinessDateInput,
  type ApiBusinessDate,
  type ApiInstant,
  type BusinessDateInput,
  type DeclaredBusinessDate,
} from './api-mapping';
