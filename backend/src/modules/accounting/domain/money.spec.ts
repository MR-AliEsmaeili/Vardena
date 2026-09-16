import { describe, expect, it } from 'vitest';
import {
  amountsEqual,
  canonicalizeAmount,
  compareAmounts,
  isAmountString,
  isZeroAmount,
  MONEY_INPUT_PATTERN,
  moneyProblemMessage,
  sumAmounts,
  validateEnteredAmount,
} from './money.js';

/**
 * Exact money (contract §13, AC-D-18/AC-I-07/08).
 *
 * The rules under test are the ones a float implementation would silently
 * break: exactness (`0.1 + 0.2` is `0.3`, not `0.30000000000000004`), the
 * refused sign (§13.2), the refused over-precision (§13.5 — reject, never
 * round), and the exact balance verdict with zero tolerance.
 */
describe('accounting money (contract §13)', () => {
  it('accepts only non-negative decimals of at most 16 digits and 2 places', () => {
    for (const value of ['0', '0.00', '1', '1250.00', '9999999999999999.99']) {
      expect(validateEnteredAmount(value)).toBeNull();
    }
    // A sign is MALFORMED on purpose: the side comes from the column.
    for (const value of [
      '-1',
      '-0.01',
      '+1',
      '1e3',
      ' 1',
      '1 ',
      '1.',
      '.5',
      '0,5',
    ]) {
      expect(validateEnteredAmount(value)).toBe('malformed');
    }
    // Rounding is never invented: three decimals are refused, not truncated.
    expect(validateEnteredAmount('1.005')).toBe('malformed');
    expect(validateEnteredAmount('10000000000000000')).toBe('malformed');
    expect(moneyProblemMessage('malformed')).toContain('non-negative');
    expect(moneyProblemMessage('exceeds_precision')).toContain('numeric(18,2)');
  });

  it('keeps the API shape pattern and the domain validator in step', () => {
    for (const value of ['0', '1.5', '1250.00', '9999999999999999.99']) {
      expect(MONEY_INPUT_PATTERN.test(value)).toBe(isAmountString(value));
    }
    for (const value of ['-1', '1.005', '', '1e3']) {
      expect(MONEY_INPUT_PATTERN.test(value)).toBe(false);
      expect(isAmountString(value)).toBe(false);
    }
  });

  it('canonicalizes spelling without losing value', () => {
    expect(canonicalizeAmount('12.50')).toBe('12.5');
    expect(canonicalizeAmount('12.00')).toBe('12');
    expect(canonicalizeAmount('0.00')).toBe('0');
    expect(canonicalizeAmount('00012.30')).toBe('12.3');
    expect(canonicalizeAmount('0.01')).toBe('0.01');
    expect(() => canonicalizeAmount('abc')).toThrow();
  });

  it('sums exactly — the 0.1 + 0.2 case a float would get wrong', () => {
    expect(sumAmounts(['0.1', '0.2'])).toBe('0.3');
    expect(sumAmounts(['0.07', '0.01', '0.02'])).toBe('0.1');
    expect(sumAmounts(['9999999999999999.99'])).toBe('9999999999999999.99');
    expect(sumAmounts([])).toBe('0');
    expect(sumAmounts(['0', '0.00'])).toBe('0');
  });

  it('compares and equates without float equality', () => {
    expect(compareAmounts('12.50', '12.5')).toBe(0);
    expect(compareAmounts('12.4', '12.5')).toBe(-1);
    expect(compareAmounts('13', '12.99')).toBe(1);
    expect(amountsEqual('0.10', '0.1')).toBe(true);
    expect(amountsEqual('0.1', '0.11')).toBe(false);
    expect(isZeroAmount('0.00')).toBe(true);
    expect(isZeroAmount('0.01')).toBe(false);
    // Exactness, again: the two totals of a balanced document are equal as
    // VALUES even when their spellings differ, and `'0.3' !== '0.30000000004'`.
    expect(amountsEqual(sumAmounts(['0.1', '0.2']), '0.3')).toBe(true);
    expect(amountsEqual(String(0.1 + 0.2), '0.3')).toBe(false);
  });
});
