import { afterEach, describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatCount,
  formatDateOnly,
  formatDateOnlyCanonical,
  formatDateOnlyWithCanonical,
  formatDateTime,
  formatDateTimeWithZone,
  isNegativeAmount,
} from './format';
import { resetDateTimeSettings, setDateTimeSettings } from './datetime';

describe('formatAmount', () => {
  it('groups the integer part without touching the fraction digits', () => {
    expect(formatAmount('1234567.89')).toBe('1,234,567.89');
    expect(formatAmount('0.10')).toBe('0.10');
    expect(formatAmount('100')).toBe('100');
  });

  it('preserves every digit of a value that exceeds IEEE-754 precision', () => {
    // Number('9007199254740993.99') would lose digits; the formatter must not.
    expect(formatAmount('9007199254740993.99')).toBe(
      '9,007,199,254,740,993.99',
    );
    expect(formatAmount('12345678901234567890.1234')).toBe(
      '12,345,678,901,234,567,890.1234',
    );
  });

  it('keeps the sign and the exact trailing zeros returned by the API', () => {
    expect(formatAmount('-1000.00')).toBe('-1,000.00');
    expect(formatAmount('-0.1')).toBe('-0.1');
  });

  it('returns unexpected values unchanged instead of mangling them', () => {
    expect(formatAmount('n/a')).toBe('n/a');
    expect(formatAmount('')).toBe('');
    expect(formatAmount(null)).toBe('');
    expect(formatAmount(undefined)).toBe('');
  });
});

describe('isNegativeAmount', () => {
  it('detects negative decimal strings', () => {
    expect(isNegativeAmount('-0.01')).toBe(true);
    expect(isNegativeAmount('-1000')).toBe(true);
  });

  it('does not treat zero or positive values as negative', () => {
    expect(isNegativeAmount('0.00')).toBe(false);
    expect(isNegativeAmount('-0.00')).toBe(false);
    expect(isNegativeAmount('12.5')).toBe(false);
    expect(isNegativeAmount(null)).toBe(false);
  });
});

describe('date formatters', () => {
  afterEach(() => {
    resetDateTimeSettings();
  });

  it('renders a business day in the organization calendar (C-63)', () => {
    // The product default is Jalali; the canonical value stays available.
    expect(formatDateOnly('2026-03-21')).toBe('1405/01/01');
    expect(formatDateOnlyCanonical('2026-03-21')).toBe('2026-03-21');
    expect(formatDateOnlyWithCanonical('2026-03-21')).toBe(
      '1405/01/01 (2026-03-21)',
    );
    expect(formatDateOnly(null)).toBe('');

    setDateTimeSettings({ calendarSystem: 'GREGORIAN', timeZone: 'UTC' });
    expect(formatDateOnly('2026-03-21')).toBe('2026-03-21');
    expect(formatDateOnly('0600-01-01')).toBe('0600-01-01');
    expect(formatDateOnlyWithCanonical('2026-03-21')).toBe('2026-03-21');
  });

  it('formats an ISO instant in the organization zone and calendar', () => {
    setDateTimeSettings({ calendarSystem: 'JALALI', timeZone: 'UTC' });
    expect(formatDateTime('2026-03-21T08:30:00.000Z')).toBe('1405/01/01 08:30');

    setDateTimeSettings({ calendarSystem: 'JALALI', timeZone: 'Asia/Tehran' });
    expect(formatDateTime('2026-03-21T08:30:00.000Z')).toBe('1405/01/01 12:00');
    // Convert the local day after applying the zone, not the UTC date.
    expect(formatDateTime('2026-10-08T21:00:00.000Z')).toBe('1405/07/17 00:30');
    expect(formatDateTimeWithZone('2026-10-08T21:00:00.000Z')).toBe(
      '1405/07/17 00:30:00 Asia/Tehran (UTC+03:30)',
    );
    // An unexpected value is shown as-is, never blanked or given a fake zone.
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
    expect(formatDateTimeWithZone('not-a-date')).toBe('not-a-date');
  });
});

describe('formatCount', () => {
  it('groups plain counts', () => {
    expect(formatCount(1234)).toBe('1,234');
  });
});
