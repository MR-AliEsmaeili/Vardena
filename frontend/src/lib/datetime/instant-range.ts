import { isBusinessDay } from './business-date';
import { dayjs } from './dayjs';
import { isInstant } from './instant';
import { isTimeZone } from './time-zone';

/**
 * Explicit event-query boundary, NOT BusinessDate domain/persistence conversion.
 * Inclusive local calendar days select [local midnight, next local midnight).
 * Resolve each midnight independently: adding 24 hours to an Instant is wrong
 * across DST. Canonical days/UTC wire results remain ASCII, never renderings.
 */
export function calendarDayStartInstant(
  day: string,
  timeZone: string,
): string | undefined {
  if (!isBusinessDay(day) || !isTimeZone(timeZone)) return undefined;
  const local =
    timeZone === 'UTC'
      ? dayjs.utc(`${day}T00:00:00.000Z`)
      : dayjs.tz(`${day} 00:00:00`, timeZone);
  // A date-only round trip misses a midnight normalized to 01:00 on the
  // SAME day (e.g. Tehran 2022-03-22). Never shift an event-query bound.
  if (local.format('YYYY-MM-DD HH:mm:ss.SSS') !== `${day} 00:00:00.000`)
    return undefined;
  const value = local.toISOString();
  return isInstant(value) ? value : undefined;
}

export function calendarDayExclusiveEnd(
  day: string,
  timeZone: string,
): string | undefined {
  if (calendarDayStartInstant(day, timeZone) === undefined) return undefined;
  // UTC here is a calendar-arithmetic carrier confined to this boundary helper,
  // not a stored BusinessDate or an assumption about the selected local zone.
  const next = dayjs
    .utc(`${day}T00:00:00.000Z`)
    .add(1, 'day')
    .format('YYYY-MM-DD');
  return calendarDayStartInstant(next, timeZone);
}
