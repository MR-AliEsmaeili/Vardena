import { afterEach, describe, expect, it } from 'vitest';
import {
  convertDay,
  formatBusinessDay,
  formatDayParts,
  gregorianDayToJalaliDay,
  isBusinessDay,
  isCalendarSystem,
  isGregorianDay,
  isJalaliLeapYear,
  isTimeZone,
  jalaliDayToGregorianDay,
  jalaliMonthLengthOf,
  parseDayParts,
  resolveDayInput,
  toLatinDigits,
} from './index';
import { todayBusinessDay } from './business-date';
import {
  formatInstant,
  instantDayInZone,
  instantOffsetLabel,
  isInstant,
} from './instant';
import {
  DEFAULT_DATE_TIME_SETTINGS,
  getDateTimeSettings,
  resetDateTimeSettings,
  resolveDateTimeSettings,
  setDateTimeSettings,
} from './settings';
import {
  readApiBusinessDate,
  readApiInstant,
  toBusinessDateInput,
} from './api-mapping';

afterEach(() => {
  resetDateTimeSettings();
});

/**
 * The C-63 date/time layer (ADR-0042). What a reviewer cannot check by reading
 * a formatter: that round trips hold, that a leap day is refused only in the
 * year it does not exist, that a Jalali day and its Gregorian twin produce the
 * SAME stored day, and that a zone's offset is the runtime's answer for that
 * instant rather than a constant.
 */
describe('calendar conversion', () => {
  it('round-trips a day through both calendars', () => {
    expect(gregorianDayToJalaliDay('2026-10-08')).toBe('1405-07-16');
    expect(jalaliDayToGregorianDay('1405-07-16')).toBe('2026-10-08');
    expect(jalaliDayToGregorianDay('1405-01-01')).toBe('2026-03-21');
    expect(gregorianDayToJalaliDay('2026-03-21')).toBe('1405-01-01');
  });

  it('refuses a day that does not exist in the calendar it is written in', () => {
    // 1405 is not a Jalali leap year: Esfand has 29 days.
    expect(isJalaliLeapYear(1405)).toBe(false);
    expect(jalaliMonthLengthOf(1405, 12)).toBe(29);
    expect(jalaliDayToGregorianDay('1405-12-30')).toBeNull();
    // …while 1403 is, so the same day exists there.
    expect(isJalaliLeapYear(1403)).toBe(true);
    expect(jalaliDayToGregorianDay('1403-12-30')).toBe('2025-03-20');
  });

  it('treats a bare YYYY-MM-DD as Gregorian, never as a guess', () => {
    // 1405-12-30 IS a valid Gregorian day — which is exactly why a Jalali day
    // must be declared instead of inferred from the shape.
    expect(isGregorianDay('1405-12-30')).toBe(true);
    expect(convertDay('1405-12-30', 'JALALI', 'GREGORIAN')).toBeNull();
    expect(isGregorianDay('2026-02-30')).toBe(false);
    expect(isGregorianDay('not-a-day')).toBe(false);
  });

  it('never throws for a day outside the library range', () => {
    expect(gregorianDayToJalaliDay('9999-12-31')).toBeNull();
    expect(convertDay('9999-12-31', 'GREGORIAN', 'JALALI')).toBeNull();
  });

  it('parses and formats day parts', () => {
    expect(parseDayParts('1405-07-16')).toEqual({
      year: 1405,
      month: 7,
      day: 16,
    });
    expect(parseDayParts('1405-13-01')).toBeNull();
    expect(formatDayParts({ year: 1405, month: 7, day: 6 })).toBe('1405-07-06');
  });

  it('rejects a value outside the closed calendar vocabulary', () => {
    expect(isCalendarSystem('JALALI')).toBe(true);
    expect(isCalendarSystem('GREGORIAN')).toBe(true);
    expect(isCalendarSystem('HIJRI')).toBe(false);
    expect(isCalendarSystem(undefined)).toBe(false);
  });
});

describe('business days', () => {
  it('treats a business day as a plain canonical day, never an instant', () => {
    // OQ-73: the day travels as `YYYY-MM-DD` and is never reinterpreted as a
    // UTC-midnight instant or shifted by a timezone.
    expect(isBusinessDay('2026-10-08')).toBe(true);
    expect(isBusinessDay('2026-02-30')).toBe(false);
    expect(isBusinessDay('2026-10-08T00:00:00.000Z')).toBe(false);
  });

  it('sends a declared Jalali day for Jalali organizations, canonical otherwise', () => {
    // 2026-10-08 and 1405-07-16 are the SAME day; the declared form carries
    // the calendar the operator wrote it in.
    expect(toBusinessDateInput('2026-10-08', 'JALALI')).toEqual({
      calendar: 'JALALI',
      value: '1405-07-16',
    });
    expect(toBusinessDateInput('2026-10-08', 'GREGORIAN')).toBe('2026-10-08');
    // A non-canonical day goes through unchanged — never invented.
    expect(toBusinessDateInput('not-a-day', 'JALALI')).toBe('not-a-day');
  });

  it('takes "today" from the organization zone, not from the browser', () => {
    const instant = new Date('2026-10-08T21:30:00.000Z');
    expect(todayBusinessDay('Asia/Tehran', instant)).toBe('2026-10-09');
    expect(todayBusinessDay('UTC', instant)).toBe('2026-10-08');
  });

  it('renders a day in the active calendar and keeps the canonical value', () => {
    expect(formatBusinessDay('2026-10-08', 'JALALI')).toBe('1405/07/16');
    expect(formatBusinessDay('2026-10-08', 'GREGORIAN')).toBe('2026-10-08');
    // An unexpected value stays visible instead of being mangled.
    expect(formatBusinessDay('2026-10-08T13:00:00.000Z', 'JALALI')).toBe(
      '2026-10-08T13:00:00.000Z',
    );
  });

  it('resolves what an operator typed — including Persian digits', () => {
    expect(resolveDayInput('1405/07/16', 'JALALI')).toBe('2026-10-08');
    expect(resolveDayInput('۱۴۰۵/۰۷/۱۶', 'JALALI')).toBe('2026-10-08');
    expect(resolveDayInput('1405-7-6', 'JALALI')).toBe('2026-09-28');
    expect(resolveDayInput('2026-10-08', 'GREGORIAN')).toBe('2026-10-08');
    // A Jalali day does NOT mean the same thing in the Gregorian calendar.
    expect(resolveDayInput('1405/07/16', 'GREGORIAN')).toBe('1405-07-16');
    // Still typing, or invalid: one answer, so the field can show it the same.
    expect(resolveDayInput('1405/07/', 'JALALI')).toBeNull();
    expect(resolveDayInput('1405/12/30', 'JALALI')).toBeNull();
  });

  it('converts numerals without touching the calendar', () => {
    expect(toLatinDigits('۱۴۰۵/۰۷/۱۶')).toBe('1405/07/16');
    expect(toLatinDigits('2026-10-08')).toBe('2026-10-08');
  });
});

describe('event timestamps', () => {
  it('renders an instant in the organization zone', () => {
    const instant = '2026-10-08T08:32:14.421Z';
    expect(formatInstant(instant, 'Asia/Tehran')).toBe('2026-10-08 12:02');
    expect(formatInstant(instant, 'UTC')).toBe('2026-10-08 08:32');
    expect(isInstant(instant)).toBe(true);
    expect(isInstant('nope')).toBe(false);
    expect(isInstant('2026-10-08T08:32:14')).toBe(false);
    expect(isInstant('2026-10-08')).toBe(false);
    expect(isInstant('2026-02-30T08:32:14.000Z')).toBe(false);
    expect(isInstant('2026-10-08T08:32:14.000+03:30')).toBe(false);
    expect(formatInstant('nope', 'UTC')).toBe('nope');
    expect(formatInstant('2026-10-08T08:32:14', 'Asia/Tehran')).toBe(
      '2026-10-08T08:32:14',
    );
    expect(formatInstant('2026-10-08T08:32:14.000+03:30', 'Asia/Tehran')).toBe(
      '2026-10-08T08:32:14.000+03:30',
    );
    expect(formatInstant(instant, 'not/a-zone')).toBe(instant);
  });

  it('resolves the zone offset for the instant, not from a constant', () => {
    // Tehran observed DST until 1401 (2022) and stopped afterwards: the same
    // zone, two different offsets — a hardcoded +03:30 would be wrong for one.
    expect(instantOffsetLabel('2022-06-01T00:00:00.000Z', 'Asia/Tehran')).toBe(
      'UTC+04:30',
    );
    expect(instantOffsetLabel('2026-06-01T00:00:00.000Z', 'Asia/Tehran')).toBe(
      'UTC+03:30',
    );
    expect(instantOffsetLabel('2026-06-01T00:00:00.000Z', 'UTC')).toBe(
      'UTC+00:00',
    );
    expect(instantOffsetLabel('2026-06-01T00:00:00', 'Asia/Tehran')).toBeNull();
    expect(
      instantOffsetLabel('2026-06-01T00:00:00+03:30', 'Asia/Tehran'),
    ).toBeNull();
  });

  it('derives the calendar day of an instant in the zone', () => {
    expect(instantDayInZone('2026-10-08T21:30:00.000Z', 'Asia/Tehran')).toBe(
      '2026-10-09',
    );
    expect(instantDayInZone('2026-10-08T21:30:00.000Z', 'UTC')).toBe(
      '2026-10-08',
    );
    expect(instantDayInZone('2026-10-08T21:30:00', 'Asia/Tehran')).toBeNull();
    expect(
      instantDayInZone('2026-10-08T21:30:00+03:30', 'Asia/Tehran'),
    ).toBeNull();
  });

  it('accepts only IANA zones, never a fixed offset', () => {
    expect(isTimeZone('Asia/Tehran')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('+03:30')).toBe(false);
    expect(isTimeZone('Not/AZone')).toBe(false);
    expect(isTimeZone(null)).toBe(false);
  });
});

describe('settings store', () => {
  it('starts on the product defaults and follows the organization', () => {
    expect(getDateTimeSettings()).toEqual(DEFAULT_DATE_TIME_SETTINGS);

    setDateTimeSettings({
      calendarSystem: 'GREGORIAN',
      timeZone: 'Europe/Berlin',
    });
    expect(getDateTimeSettings()).toEqual({
      calendarSystem: 'GREGORIAN',
      timeZone: 'Europe/Berlin',
    });

    resetDateTimeSettings();
    expect(getDateTimeSettings()).toEqual(DEFAULT_DATE_TIME_SETTINGS);
  });

  it('falls back per field, so one bad value cannot poison the other', () => {
    expect(
      resolveDateTimeSettings({ calendarSystem: 'HIJRI', timeZone: '+03:30' }),
    ).toEqual(DEFAULT_DATE_TIME_SETTINGS);
    expect(
      resolveDateTimeSettings({
        calendarSystem: 'GREGORIAN',
        timeZone: '+03:30',
      }),
    ).toEqual({
      calendarSystem: 'GREGORIAN',
      timeZone: DEFAULT_DATE_TIME_SETTINGS.timeZone,
    });
    // A deployment that has not sent the fields keeps the defaults.
    expect(resolveDateTimeSettings(undefined)).toEqual(
      DEFAULT_DATE_TIME_SETTINGS,
    );
  });
});

describe('API mapping', () => {
  it('sends a declared Jalali day for a Jalali organization', () => {
    expect(toBusinessDateInput('2026-10-08', 'JALALI')).toEqual({
      calendar: 'JALALI',
      value: '1405-07-16',
    });
    expect(toBusinessDateInput('2026-10-08', 'GREGORIAN')).toBe('2026-10-08');
  });

  it('accepts only complete API date/time blocks', () => {
    expect(
      readApiBusinessDate({ gregorian: '2026-10-08', jalali: '1405-07-16' }),
    ).toEqual({ gregorian: '2026-10-08', jalali: '1405-07-16' });
    expect(readApiBusinessDate({ gregorian: '2026-10-08' })).toBeNull();
    expect(readApiBusinessDate(null)).toBeNull();

    expect(
      readApiInstant({
        instant: '2026-10-08T08:32:14.421Z',
        timeZone: 'Asia/Tehran',
        gregorian: '2026-10-08 12:02:14',
        jalali: '1405-07-16 12:02:14',
      }),
    ).toMatchObject({ instant: '2026-10-08T08:32:14.421Z' });
    expect(readApiInstant({ instant: '', timeZone: 'Asia/Tehran' })).toBeNull();
    expect(
      readApiInstant({
        instant: '2026-10-08T08:32:14',
        timeZone: 'Asia/Tehran',
        gregorian: '2026-10-08 12:02:14',
        jalali: '1405-07-16 12:02:14',
      }),
    ).toBeNull();
    expect(
      readApiInstant({
        instant: '2026-10-08T08:32:14.421Z',
        timeZone: '+03:30',
        gregorian: '2026-10-08 12:02:14',
        jalali: '1405-07-16 12:02:14',
      }),
    ).toBeNull();
  });
});
