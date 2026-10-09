import { describe, expect, it } from 'vitest';
import {
  CALENDAR_SYSTEMS,
  DEFAULT_CALENDAR_SYSTEM,
  isCalendarSystem,
} from './calendar-system.js';
import {
  businessDateFromDbDate,
  businessDateFromInstant,
  businessDateFromUtcInstant,
  businessDateToDbDate,
  compareBusinessDates,
  formatBusinessDate,
  isBusinessDateInCalendar,
  isGregorianBusinessDate,
  isValidBusinessDateRange,
  parseBusinessDate,
  toBusinessDate,
} from './business-date.js';
import { parseBusinessDateInput } from './business-date-input.js';
import { gregorianToJalaliDay, isValidJalaliDay } from './jalali.js';
import {
  DEFAULT_TIME_ZONE,
  UTC_TIME_ZONE,
  calendarDayInTimeZone,
  isTimeZone,
  localDateTimeString,
  todayInTimeZone,
  utcOffsetMinutesAt,
} from './time-zone.js';
import {
  renderLocalJalaliDateTime,
  toApiBusinessDate,
  toApiInstant,
} from './api-date-time.js';

describe('calendar system', () => {
  it('defaults to the Jalali calendar for Vardena but stays configurable', () => {
    expect(DEFAULT_CALENDAR_SYSTEM).toBe('JALALI');
    expect(CALENDAR_SYSTEMS).toEqual(['GREGORIAN', 'JALALI']);
    expect(isCalendarSystem('JALALI')).toBe(true);
    expect(isCalendarSystem('HIJRI')).toBe(false);
    expect(isCalendarSystem(undefined)).toBe(false);
  });
});

describe('Gregorian ↔ Jalali conversion', () => {
  it('converts a known day in both directions', () => {
    // The reference pair of the C-63 brief: 2026-10-08 ⇔ 1405-07-16.
    expect(gregorianToJalaliDay(2026, 10, 8)).toEqual({
      year: 1405,
      month: 7,
      day: 16,
    });
    expect(parseBusinessDate('1405-07-16', 'JALALI')?.gregorian).toBe(
      '2026-10-08',
    );
    expect(formatBusinessDate('2026-10-08', 'JALALI')).toBe('1405-07-16');
  });

  it('handles the year boundary (Esfand 29 → 1 Farvardin)', () => {
    expect(formatBusinessDate('2026-03-20', 'JALALI')).toBe('1404-12-29');
    expect(formatBusinessDate('2026-03-21', 'JALALI')).toBe('1405-01-01');
    expect(parseBusinessDate('1405-01-01', 'JALALI')?.gregorian).toBe(
      '2026-03-21',
    );
  });

  it('applies the Jalali leap-year rule to Esfand', () => {
    // 1395 is leap (Esfand 30 exists), 1394 and 1405 are not.
    expect(isValidJalaliDay(1395, 12, 30)).toBe(true);
    expect(isValidJalaliDay(1394, 12, 30)).toBe(false);
    expect(isValidJalaliDay(1405, 12, 30)).toBe(false);
    expect(formatBusinessDate('2017-03-20', 'JALALI')).toBe('1395-12-30');
  });

  it('rejects days that do not exist instead of rolling them over', () => {
    expect(parseBusinessDate('2026-02-30', 'GREGORIAN')).toBeNull();
    expect(parseBusinessDate('1405-12-30', 'JALALI')).toBeNull();
    expect(parseBusinessDate('1405-13-01', 'JALALI')).toBeNull();
    expect(parseBusinessDate('1405-07-32', 'JALALI')).toBeNull();
    expect(formatBusinessDate('2026-10-08', 'JALALI')).toBe('1405-07-16');
    expect(formatBusinessDate('2026-02-30', 'JALALI')).toBeNull();
  });

  it('fails closed outside the four-digit Jalali rendering range', () => {
    expect(gregorianToJalaliDay(560, 1, 1)).toBeNull();
    expect(formatBusinessDate('0560-03-20', 'JALALI')).toBeNull();
    expect(formatBusinessDate('0621-03-20', 'JALALI')).toBeNull();
    expect(formatBusinessDate('0621-03-21', 'JALALI')).toBe('0000-01-01');
    expect(formatBusinessDate('3799-01-01', 'JALALI')).toBeNull();
  });

  it('round-trips a whole year without drift', () => {
    for (let offset = 0; offset < 366; offset += 1) {
      const day = new Date(Date.UTC(2026, 0, 1 + offset));
      const gregorian = [
        String(day.getUTCFullYear()).padStart(4, '0'),
        String(day.getUTCMonth() + 1).padStart(2, '0'),
        String(day.getUTCDate()).padStart(2, '0'),
      ].join('-');
      const jalali = formatBusinessDate(gregorian, 'JALALI');
      expect(jalali).not.toBeNull();
      expect(parseBusinessDate(jalali as string, 'JALALI')?.gregorian).toBe(
        gregorian,
      );
    }
  });
});

describe('time zone handling', () => {
  it('accepts IANA zones and rejects offsets and nonsense', () => {
    expect(isTimeZone('Asia/Tehran')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('+03:30')).toBe(false);
    expect(isTimeZone('Tehran')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });

  it('resolves the current offset from the runtime, not from arithmetic', () => {
    expect(
      utcOffsetMinutesAt(new Date('2026-10-08T08:32:14.421Z'), 'Asia/Tehran'),
    ).toBe(210);
    expect(
      utcOffsetMinutesAt(new Date('2026-10-08T08:32:14.421Z'), 'UTC'),
    ).toBe(0);
  });

  it('does not remap years 0001–0099 when deriving an instant offset', () => {
    expect(utcOffsetMinutesAt(new Date('0001-01-01T00:00:00Z'), 'UTC')).toBe(0);
  });

  it('applies the historical DST rule (Tehran observed +04:30 in 2022)', () => {
    expect(
      utcOffsetMinutesAt(new Date('2022-06-15T00:00:00Z'), 'Asia/Tehran'),
    ).toBe(270);
    expect(
      utcOffsetMinutesAt(new Date('2026-06-15T00:00:00Z'), 'Asia/Tehran'),
    ).toBe(210);
  });

  it('renders the local date-time of an instant', () => {
    const instant = new Date('2026-10-08T08:32:14.421Z');
    expect(localDateTimeString(instant, 'Asia/Tehran')).toBe(
      '2026-10-08 12:02:14',
    );
    expect(localDateTimeString(instant, 'UTC')).toBe('2026-10-08 08:32:14');
    expect(calendarDayInTimeZone(instant, 'Asia/Tehran')).toBe('2026-10-08');
  });

  it('keeps the calendar day stable across a midnight-crossing zone', () => {
    // 21:00 UTC is already the NEXT day in Tehran (+03:30).
    const instant = new Date('2026-10-08T21:00:00Z');
    expect(calendarDayInTimeZone(instant, 'Asia/Tehran')).toBe('2026-10-09');
    expect(calendarDayInTimeZone(instant, 'UTC')).toBe('2026-10-08');
  });

  it('answers "today" in the configured zone', () => {
    const instant = new Date('2026-10-08T21:00:00Z');
    expect(todayInTimeZone('Asia/Tehran', instant)).toBe('2026-10-09');
    expect(todayInTimeZone('UTC', instant)).toBe('2026-10-08');
    expect(DEFAULT_TIME_ZONE).toBe('Asia/Tehran');
  });
});

describe('business dates', () => {
  it('parses a canonical Gregorian day', () => {
    expect(parseBusinessDate('2026-10-08', 'GREGORIAN')).toEqual({
      gregorian: '2026-10-08',
      calendar: 'GREGORIAN',
    });
  });

  it('parses a declared Jalali day into the canonical Gregorian day', () => {
    expect(
      parseBusinessDateInput({ calendar: 'JALALI', value: '1405-07-16' }),
    ).toEqual({
      ok: true,
      gregorian: '2026-10-08',
      calendar: 'JALALI',
      source: 'declared_day',
    });
  });

  it('renders the canonical day back into either calendar', () => {
    expect(formatBusinessDate('2026-10-08', 'GREGORIAN')).toBe('2026-10-08');
    expect(formatBusinessDate('2026-10-08', 'JALALI')).toBe('1405-07-16');
    expect(isBusinessDateInCalendar('1405-07-16', 'JALALI')).toBe(true);
    // The SAME digits can be a real day in one calendar and not in the other,
    // which is exactly why a Jalali day must be declared:
    expect(isBusinessDateInCalendar('1405-12-30', 'JALALI')).toBe(false);
    expect(isBusinessDateInCalendar('1405-12-30', 'GREGORIAN')).toBe(true);
    expect(isBusinessDateInCalendar('1405-13-30', 'GREGORIAN')).toBe(false);
  });

  it('brands only real calendar days as BusinessDate values', () => {
    expect(toBusinessDate('2026-10-08')).toBe('2026-10-08');
    expect(toBusinessDate('2026-02-30')).toBeNull();
    expect(toBusinessDate('2026-10-08T00:00:00.000Z')).toBeNull();
  });

  it('round-trips through the PostgreSQL DATE carrier without a zone', () => {
    // The DB adapter pair is the ONLY place a Date object touches a business
    // date: Prisma maps `date` ⇔ a Date whose UTC components are the day.
    const carrier = businessDateToDbDate('2026-10-08');
    if (carrier === null) throw new Error('Expected a date carrier.');
    expect(carrier.getUTCHours()).toBe(0);
    expect(carrier.getUTCMinutes()).toBe(0);
    expect(carrier.getUTCSeconds()).toBe(0);
    expect(carrier.getUTCMilliseconds()).toBe(0);
    expect(businessDateFromDbDate(carrier)).toBe('2026-10-08');
    expect(businessDateToDbDate('2026-02-30')).toBeNull();
  });

  it('round-trips Gregorian years 0001–0099 without JavaScript Date.UTC remapping', () => {
    for (const day of ['0001-01-01', '0050-12-31', '0099-03-01']) {
      const carrier = businessDateToDbDate(day);
      expect(isGregorianBusinessDate(day)).toBe(true);
      if (carrier === null) throw new Error('Expected a date carrier.');
      expect(carrier.getUTCFullYear()).toBe(Number(day.slice(0, 4)));
      expect(carrier.getUTCMonth() + 1).toBe(Number(day.slice(5, 7)));
      expect(carrier.getUTCDate()).toBe(Number(day.slice(8, 10)));
      expect(businessDateFromDbDate(carrier)).toBe(day);
    }
    expect(isGregorianBusinessDate('0000-01-01')).toBe(false);
    expect(businessDateToDbDate('0000-01-01')).toBeNull();
  });

  it('rejects invalid or noncanonical PostgreSQL DATE carriers', () => {
    expect(() => businessDateFromDbDate(new Date(Number.NaN))).toThrow(
      'Prisma returned an invalid carrier for a PostgreSQL date.',
    );
    const outsideCanonicalRange = new Date(0);
    outsideCanonicalRange.setUTCFullYear(10_000, 0, 1);
    expect(() => businessDateFromDbDate(outsideCanonicalRange)).toThrow(
      'outside the canonical BusinessDate range',
    );
  });

  it('keeps a BusinessDate identical in every time zone (OQ-73)', () => {
    // A stored day has NO time-of-day and NO zone: whatever zone an
    // organization configures, 2026-10-08 stays 2026-10-08 — no shift, no
    // re-derivation. The carrier read uses UTC components by construction,
    // so no zone even enters the computation.
    const carrier = businessDateToDbDate('2026-10-08') as Date;
    for (const timeZone of [
      'Asia/Tehran',
      'UTC',
      'America/New_York',
      'Europe/Berlin',
    ]) {
      expect(businessDateFromDbDate(carrier), timeZone).toBe('2026-10-08');
      expect(
        formatBusinessDate(businessDateFromDbDate(carrier), 'JALALI'),
        timeZone,
      ).toBe('1405-07-16');
    }
  });

  it('uses the organization zone only for a real instant-day rule such as today', () => {
    // Defaults ask for the organization's current day; stored BusinessDates
    // never pass through this function.
    expect(
      businessDateFromInstant(new Date('2026-10-08T21:00:00Z'), 'Asia/Tehran'),
    ).toBe('2026-10-09');
    expect(
      businessDateFromInstant(new Date('2026-10-08T21:00:00Z'), 'UTC'),
    ).toBe('2026-10-08');
    // Legacy business-date instants use OQ-73's UTC calendar-day policy.
    expect(businessDateFromUtcInstant(new Date('2026-10-08T21:00:00Z'))).toBe(
      '2026-10-08',
    );
    expect(businessDateFromUtcInstant(new Date(Number.NaN))).toBeNull();
  });

  it('validates rather than coerces', () => {
    expect(isGregorianBusinessDate('2026-10-08')).toBe(true);
    expect(isGregorianBusinessDate('2026-2-8')).toBe(false);
    expect(isGregorianBusinessDate('2026-10-08T00:00:00Z')).toBe(false);
    expect(businessDateToDbDate('2026-02-30')).toBeNull();
  });

  it('compares days and validates inclusive ranges without instants', () => {
    expect(compareBusinessDates('2026-10-08', '2026-10-09')).toBeLessThan(0);
    expect(compareBusinessDates('2026-10-08', '2026-10-08')).toBe(0);
    expect(compareBusinessDates('2026-10-08', 'nonsense')).toBeNull();
    expect(
      isValidBusinessDateRange({
        startDate: toBusinessDate('2026-10-01')!,
        endDate: toBusinessDate('2026-10-08')!,
      }),
    ).toBe(true);
    expect(
      isValidBusinessDateRange({
        startDate: toBusinessDate('2026-10-08')!,
        endDate: toBusinessDate('2026-10-01')!,
      }),
    ).toBe(false);
  });
});

describe('business-date input contract', () => {
  it('keeps the canonical string backward compatible', () => {
    expect(parseBusinessDateInput('2026-10-08')).toEqual({
      ok: true,
      gregorian: '2026-10-08',
      calendar: 'GREGORIAN',
      source: 'day',
    });
  });

  it('resolves a legacy ISO instant to its UTC day, matching OQ-73 migration semantics', () => {
    expect(parseBusinessDateInput('2026-10-08T00:00:00.000Z')).toMatchObject({
      ok: true,
      gregorian: '2026-10-08',
      source: 'instant',
    });
    expect(parseBusinessDateInput('2026-10-08T21:00:00.000Z')).toMatchObject({
      ok: true,
      gregorian: '2026-10-08',
    });
    expect(parseBusinessDateInput('2026-10-09T00:15:00+03:30')).toMatchObject({
      ok: true,
      gregorian: '2026-10-08',
    });
  });

  it('rejects impossible civil days and UTC days outside the BusinessDate range', () => {
    expect(parseBusinessDateInput('2026-02-30T23:30:00-08:00')).toEqual({
      ok: false,
      reason: 'business_date_calendar',
    });
    expect(parseBusinessDateInput('0000-01-01T00:00:00Z')).toEqual({
      ok: false,
      reason: 'business_date_calendar',
    });
  });

  it('refuses an undated or declared-invalid value with a stable reason', () => {
    expect(parseBusinessDateInput('')).toEqual({
      ok: false,
      reason: 'business_date_format',
    });
    expect(parseBusinessDateInput('08/10/2026')).toEqual({
      ok: false,
      reason: 'business_date_format',
    });
    // A bare string is GREGORIAN by contract (backward compatibility), so
    // `1405-12-30` is a valid — if surprising — Gregorian day:
    expect(parseBusinessDateInput('1405-12-30')).toMatchObject({
      ok: true,
      gregorian: '1405-12-30',
      calendar: 'GREGORIAN',
    });
    expect(parseBusinessDateInput('1405-13-30')).toEqual({
      ok: false,
      reason: 'business_date_calendar',
    });
    expect(
      parseBusinessDateInput({ calendar: 'JALALI', value: '1405-12-30' }),
    ).toEqual({ ok: false, reason: 'business_date_calendar' });
    // A declaration smuggled with extra keys is rejected, not partially read.
    expect(
      parseBusinessDateInput({
        calendar: 'JALALI',
        value: '1405-07-16',
        extra: 'x',
      } as never),
    ).toEqual({ ok: false, reason: 'business_date_declaration' });
  });
});

describe('standardized API representations', () => {
  it('derives both calendars for one business date from one canonical value', () => {
    expect(toApiBusinessDate('2026-10-08')).toEqual({
      gregorian: '2026-10-08',
      jalali: '1405-07-16',
    });
    expect(toApiBusinessDate('2026-02-30')).toBeNull();
  });

  it('derives UTC, local Gregorian and local Jalali for ONE instant', () => {
    const instant = new Date('2026-10-08T08:32:14.421Z');
    const dto = toApiInstant(instant, 'Asia/Tehran');
    expect(dto).toEqual({
      // The instant is untouched by the renderings.
      instant: '2026-10-08T08:32:14.421Z',
      timeZone: 'Asia/Tehran',
      gregorian: '2026-10-08 12:02:14',
      jalali: '1405-07-16 12:02:14',
    });
    // Same instant, another zone: still the same truth, different rendering.
    const utc = toApiInstant(instant, 'UTC');
    expect(utc?.instant).toBe('2026-10-08T08:32:14.421Z');
    expect(utc?.gregorian).toBe('2026-10-08 08:32:14');
    expect(utc?.jalali).toBe('1405-07-16 08:32:14');
  });

  it('refuses to invent a rendering for an unknown zone or an invalid instant', () => {
    expect(
      toApiInstant(new Date('2026-10-08T08:32:14.421Z'), '+03:30'),
    ).toBeNull();
    expect(toApiInstant(new Date(Number.NaN), 'Asia/Tehran')).toBeNull();
  });

  it('renders the Jalali local date-time of an instant in a zone', () => {
    expect(
      renderLocalJalaliDateTime(
        new Date('2026-10-08T21:30:00Z'),
        'Asia/Tehran',
      ),
    ).toBe('1405-07-17 01:00:00');
    expect(UTC_TIME_ZONE).toBe('UTC');
  });
});
