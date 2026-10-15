import { describe, expect, it } from 'vitest';
import { formatOwnerInstant, resolveDayInput } from './date-time';

describe('Owner consumes canonical date foundation with Tehran context', () => {
  it('formats Instant display with Persian digits, seconds and explicit zone', () => {
    expect(formatOwnerInstant('2026-10-08T21:00:00.000Z')).toBe(
      '۱۴۰۵/۰۷/۱۷ ۰۰:۳۰:۰۰ Asia/Tehran (UTC+03:30)',
    );
    expect(formatOwnerInstant('invalid')).toBe('invalid');
  });
  it('preserves canonical days and rejects invalid Jalali input', () => {
    expect(resolveDayInput('۱۴۰۵/۰۷/۱۷')).toBe('2026-10-09');
    expect(resolveDayInput('۱۴۰۵/۱۲/۳۰')).toBeNull();
  });
});
