import { describe, expect, it } from 'vitest';
import {
  calendarDayExclusiveEnd,
  calendarDayStartInstant,
} from './instant-range';
import { formatInstant } from './instant';
import { toPersianDigits } from './numerals';
import { resolveDayInput } from './business-date';

// Fixtures are explicit; these tests also run under non-Tehran process TZs.
describe('Iranian display / UTC event-query boundary', () => {
  it('formats Persian date and time across UTC midnight without changing the Instant', () => {
    const instant = '2026-10-08T21:00:00.000Z';
    expect(formatInstant(instant, 'Asia/Tehran')).toBe('۱۴۰۵/۰۷/۱۷ ۰۰:۳۰');
    expect(instant).toBe('2026-10-08T21:00:00.000Z');
    expect(toPersianDigits('1405/07/17 00:30')).toBe('۱۴۰۵/۰۷/۱۷ ۰۰:۳۰');
    expect(toPersianDigits('١٤٠٥/٠٧/١٧')).toBe('۱۴۰۵/۰۷/۱۷');
  });

  it('maps inclusive Jalali local days to a half-open UTC interval', () => {
    const day = resolveDayInput('۱۴۰۵/۰۷/۱۷');
    expect(day).toBe('2026-10-09');
    expect(calendarDayStartInstant(day!, 'Asia/Tehran')).toBe(
      '2026-10-08T20:30:00.000Z',
    );
    expect(calendarDayExclusiveEnd(day!, 'Asia/Tehran')).toBe(
      '2026-10-09T20:30:00.000Z',
    );
    expect(calendarDayStartInstant(day!, 'UTC')).toBe(
      '2026-10-09T00:00:00.000Z',
    );
  });

  it('resolves both midnights, including a historical Tehran DST transition', () => {
    expect(calendarDayStartInstant('2022-09-21', 'Asia/Tehran')).toBe(
      '2022-09-20T19:30:00.000Z',
    );
    expect(calendarDayExclusiveEnd('2022-09-21', 'Asia/Tehran')).toBe(
      '2022-09-21T20:30:00.000Z',
    );
    expect(calendarDayExclusiveEnd('2028-02-29', 'UTC')).toBe(
      '2028-03-01T00:00:00.000Z',
    );
  });

  it.each([
    ['2022-03-22', '2022-03-21', 'Asia/Tehran'],
    ['2019-09-08', '2019-09-07', 'America/Santiago'],
  ])(
    'rejects a skipped midnight normalized within the same date (%s, %s, %s)',
    (skipped, preceding, zone) => {
      // Both zones jump from the preceding day to 01:00 on `skipped`.
      // Checking only YYYY-MM-DD would silently accept that normalized 01:00.
      expect(calendarDayStartInstant(skipped, zone)).toBeUndefined();
      expect(calendarDayExclusiveEnd(preceding, zone)).toBeUndefined();
      expect(calendarDayStartInstant(preceding, zone)).toBeDefined();
    },
  );

  it('fails invalid or unrepresentable bounds rather than widening a query', () => {
    expect(calendarDayStartInstant('2026-02-30', 'UTC')).toBeUndefined();
    expect(
      calendarDayStartInstant('2026-10-09T00:00:00Z', 'UTC'),
    ).toBeUndefined();
    expect(calendarDayStartInstant('2026-10-09', '+03:30')).toBeUndefined();
    expect(calendarDayStartInstant('0001-01-01', 'UTC')).toBe(
      '0001-01-01T00:00:00.000Z',
    );
    expect(
      calendarDayStartInstant('0001-01-01', 'Asia/Tehran'),
    ).toBeUndefined();
    expect(
      calendarDayStartInstant('2011-12-30', 'Pacific/Apia'),
    ).toBeUndefined();
    expect(calendarDayExclusiveEnd('9999-12-31', 'UTC')).toBeUndefined();
    expect(resolveDayInput('۱۴۰۵/۱۲/۳۰')).toBeNull();
    expect(resolveDayInput('۱۴۰۳/۱۲/۳۰')).toBe('2025-03-20');
  });
});
