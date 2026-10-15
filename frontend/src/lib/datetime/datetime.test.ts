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

  it('never throws for a day outside the library or wire-rendering range', () => {
    expect(gregorianDayToJalaliDay('9999-12-31')).toBeNull();
    expect(convertDay('9999-12-31', 'GREGORIAN', 'JALALI')).toBeNull();
    expect(gregorianDayToJalaliDay('0560-03-20')).toBeNull();
    expect(gregorianDayToJalaliDay('0621-03-20')).toBeNull();
    expect(gregorianDayToJalaliDay('0621-03-21')).toBe('0000-01-01');
    expect(gregorianDayToJalaliDay('3798-12-31')).toBe('3177-10-11');
    expect(gregorianDayToJalaliDay('3799-01-01')).toBeNull();
    expect(jalaliDayToGregorianDay('3177-10-11')).toBe('3798-12-31');
    expect(jalaliDayToGregorianDay('3177-10-12')).toBeNull();
    expect(resolveDayInput('3177/10/12', 'JALALI')).toBeNull();
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
    expect(isBusinessDay('0001-01-01')).toBe(true);
    expect(isBusinessDay('0000-01-01')).toBe(false);
  });

  it('sends a declared Jalali day and preserves canonical fallback values', () => {
    // 2026-10-08 and 1405-07-16 are the SAME day; the fixed UI emits the
    // Jalali form when the canonical date is inside the renderer's envelope.
    expect(toBusinessDateInput('2026-10-08')).toEqual({
      calendar: 'JALALI',
      value: '1405-07-16',
    });
    // Historical dates outside that envelope remain Gregorian API values.
    expect(toBusinessDateInput('0600-01-01')).toBe('0600-01-01');
    // A non-canonical day goes through unchanged — never invented.
    expect(toBusinessDateInput('not-a-day')).toBe('not-a-day');
  });

  it('takes "today" from the organization zone, not from the browser', () => {
    const instant = new Date('2026-10-08T21:30:00.000Z');
    expect(todayBusinessDay('Asia/Tehran', instant)).toBe('2026-10-09');
    expect(todayBusinessDay('UTC', instant)).toBe('2026-10-08');
  });

  it('renders a day in the active calendar and keeps the canonical value', () => {
    expect(formatBusinessDay('2026-10-08', 'JALALI')).toBe('۱۴۰۵/۰۷/۱۶');
    expect(formatBusinessDay('2026-10-08', 'GREGORIAN')).toBe('2026-10-08');
    // Unsupported legacy years remain visible as their canonical source day.
    expect(formatBusinessDay('0600-01-01', 'JALALI')).toBe('0600-01-01');
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
    expect(formatInstant(instant, 'Asia/Tehran')).toBe('۱۴۰۵/۰۷/۱۶ ۱۲:۰۲');
    expect(formatInstant(instant, 'UTC')).toBe('۱۴۰۵/۰۷/۱۶ ۰۸:۳۲');
    expect(isInstant(instant)).toBe(true);
    expect(isInstant('nope')).toBe(false);
    expect(isInstant('2026-10-08T08:32:14')).toBe(false);
    expect(isInstant('2026-10-08')).toBe(false);
    expect(isInstant('2026-02-30T08:32:14.000Z')).toBe(false);
    // This wire contract is canonical UTC-Z; an offset-bearing ISO timestamp
    // is not silently reparsed in the browser or substituted for the API form.
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
  it('follows the organization time zone but ignores legacy calendar settings', () => {
    expect(getDateTimeSettings()).toEqual(DEFAULT_DATE_TIME_SETTINGS);

    setDateTimeSettings({
      calendarSystem: 'GREGORIAN',
      timeZone: 'Europe/Berlin',
    });
    expect(getDateTimeSettings()).toEqual({ timeZone: 'Europe/Berlin' });

    resetDateTimeSettings();
    expect(getDateTimeSettings()).toEqual(DEFAULT_DATE_TIME_SETTINGS);
  });

  it('validates only the organization IANA time zone', () => {
    expect(
      resolveDateTimeSettings({ calendarSystem: 'HIJRI', timeZone: '+03:30' }),
    ).toEqual(DEFAULT_DATE_TIME_SETTINGS);
    expect(
      resolveDateTimeSettings({
        calendarSystem: 'GREGORIAN',
        timeZone: 'Europe/Berlin',
      }),
    ).toEqual({ timeZone: 'Europe/Berlin' });
    // A deployment that has not sent a zone keeps the product default.
    expect(resolveDateTimeSettings(undefined)).toEqual(
      DEFAULT_DATE_TIME_SETTINGS,
    );
  });
});

describe('API mapping', () => {
  it('accepts only complete API date/time blocks', () => {
    expect(
      readApiBusinessDate({ gregorian: '2026-10-08', jalali: '1405-07-16' }),
    ).toEqual({ gregorian: '2026-10-08', jalali: '1405-07-16' });
    expect(
      readApiBusinessDate({ gregorian: '0600-01-01', jalali: null }),
    ).toEqual({ gregorian: '0600-01-01', jalali: null });
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
    expect(
      readApiInstant({
        instant: '0600-01-01T08:32:14.421Z',
        timeZone: 'Asia/Tehran',
        gregorian: '0600-01-01 12:02:14',
        jalali: null,
      }),
    ).toMatchObject({ jalali: null });
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
