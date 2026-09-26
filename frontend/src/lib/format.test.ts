import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatCount,
  formatDateOnly,
  formatDateTime,
  isNegativeAmount,
} from './format';

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
  it('shows date-only API values verbatim (no calendar conversion)', () => {
    expect(formatDateOnly('2026-03-21')).toBe('2026-03-21');
    expect(formatDateOnly(null)).toBe('');
  });

  it('formats ISO timestamps through Day.js', () => {
    expect(formatDateTime('2026-03-21T08:30:00.000Z')).toMatch(
      /^2026-03-21 \d{2}:\d{2}$/,
    );
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});

describe('formatCount', () => {
  it('groups plain counts', () => {
    expect(formatCount(1234)).toBe('1,234');
  });
});
