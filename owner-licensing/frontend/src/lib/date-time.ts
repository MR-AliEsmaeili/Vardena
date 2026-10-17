import {
  formatInstantWithSeconds,
  instantTimeZoneLabel,
  isInstant,
} from './.date-foundation/instant';
import {
  formatBusinessDay,
  formatBusinessDayWithCanonical,
  isBusinessDay,
  resolveDayInput,
} from './.date-foundation/business-date';
import { DEFAULT_TIME_ZONE } from './.date-foundation/time-zone';

// Owner has no organization settings; the approved display zone is Tehran.
// The implementation below only chooses context. Calendar/digit/time conversion
// comes from the exact staged canonical foundation, never Owner-local rules.
export function formatOwnerInstant(value: string): string {
  if (!isInstant(value)) return value;
  return `${formatInstantWithSeconds(value, DEFAULT_TIME_ZONE)} ${instantTimeZoneLabel(value, DEFAULT_TIME_ZONE)}`;
}

/**
 * One nullable canonical business day, rendered Jalali-first with its canonical
 * Gregorian day alongside so an operator can reconcile the display with what
 * the API stores. A day that is not recorded stays an explicit em-dash: never
 * a defaulted or inferred date.
 */
export function formatOwnerBusinessDay(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  return formatBusinessDayWithCanonical(value);
}
export {
  formatBusinessDay,
  formatBusinessDayWithCanonical,
  resolveDayInput,
  isBusinessDay,
};
export {
  calendarDayStartInstant,
  calendarDayExclusiveEnd,
} from './.date-foundation/instant-range';
