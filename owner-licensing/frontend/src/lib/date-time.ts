import {
  formatInstantWithSeconds,
  instantTimeZoneLabel,
  isInstant,
} from './.date-foundation/instant';
import { DEFAULT_TIME_ZONE } from './.date-foundation/time-zone';

// Owner has no organization settings; the approved display zone is Tehran.
// The implementation below only chooses context. Calendar/digit/time conversion
// comes from the exact staged canonical foundation, never Owner-local rules.
export function formatOwnerInstant(value: string): string {
  if (!isInstant(value)) return value;
  return `${formatInstantWithSeconds(value, DEFAULT_TIME_ZONE)} ${instantTimeZoneLabel(value, DEFAULT_TIME_ZONE)}`;
}
export {
  formatBusinessDay,
  resolveDayInput,
  isBusinessDay,
} from './.date-foundation/business-date';
export {
  calendarDayStartInstant,
  calendarDayExclusiveEnd,
} from './.date-foundation/instant-range';
