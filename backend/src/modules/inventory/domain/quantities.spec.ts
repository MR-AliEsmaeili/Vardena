import { describe, expect, it } from 'vitest';
import {
  addDecimalStrings,
  canonicalizeDecimal,
  compareDecimalStrings,
  fitsQuantity,
  isPositiveQuantityString,
  isQuantityString,
  multiplyDecimalStrings,
  subtractDecimalStrings,
  validateEnteredQuantity,
} from './quantities.js';

describe('entered quantity validation', () => {
  it.each(['1', '10', '0.0001', '99999999999999.9999', '3.50'])(
    'accepts %s',
    (value) => {
      expect(validateEnteredQuantity(value)).toBeNull();
      expect(isQuantityString(value)).toBe(true);
      expect(isPositiveQuantityString(value)).toBe(true);
    },
  );

  it.each([
    '',
    ' ',
    'abc',
    '1e3',
    '+5',
    '-5',
    '.5',
    '5.',
    '1,000',
    '0x10',
    '999999999999999.9999', // 15 integer digits
    '1.00001', // 5 decimal places
    'NaN',
    'Infinity',
  ])('rejects malformed %s', (value) => {
    expect(validateEnteredQuantity(value)).toBe('malformed');
  });

  it.each(['0', '0.0', '0.0000'])('rejects non-positive %s', (value) => {
    expect(validateEnteredQuantity(value)).toBe('not_positive');
  });
});

describe('canonical decimals', () => {
  it.each([
    ['3.50', '3.5'],
    ['3.0000', '3'],
    ['0.0000', '0'],
    ['-0', '0'],
    ['-0.00', '0'],
    ['0.0001', '0.0001'],
    ['007', '7'],
    ['-12.340', '-12.34'],
  ])('canonicalizes %s to %s', (input, expected) => {
    expect(canonicalizeDecimal(input)).toBe(expected);
  });

  it('throws for malformed input', () => {
    expect(() => canonicalizeDecimal('abc')).toThrow();
  });
});

describe('exact decimal comparison', () => {
  it('compares across scales without float drift', () => {
    expect(compareDecimalStrings('3.50', '3.5')).toBe(0);
    expect(compareDecimalStrings('0.1', '0.10')).toBe(0);
    expect(compareDecimalStrings('0.1', '0.2')).toBe(-1);
    expect(compareDecimalStrings('10', '9.9999')).toBe(1);
    expect(compareDecimalStrings('-2', '0')).toBe(-1);
    expect(compareDecimalStrings('-2', '-10')).toBe(1);
    // The classic float trap: 0.1 + 0.2 territory stays exact here.
    expect(compareDecimalStrings('0.30000000000000004', '0.3')).toBe(1);
  });
});

describe('exact decimal arithmetic', () => {
  it('adds without float drift', () => {
    expect(addDecimalStrings('0.1', '0.2')).toBe('0.3');
    expect(addDecimalStrings('10', '-3')).toBe('7');
    expect(addDecimalStrings('-2', '-3')).toBe('-5');
    expect(addDecimalStrings('99999999999999.9999', '0.0001')).toBe(
      '100000000000000',
    );
  });

  it('subtracts availability exactly', () => {
    expect(subtractDecimalStrings('10', '7')).toBe('3');
    expect(subtractDecimalStrings('10', '10')).toBe('0');
    expect(subtractDecimalStrings('3', '5')).toBe('-2');
    expect(subtractDecimalStrings('1.000', '0.9999')).toBe('0.0001');
  });

  it('multiplies conversions exactly', () => {
    expect(multiplyDecimalStrings('3', '12')).toBe('36');
    expect(multiplyDecimalStrings('2.5', '0.5')).toBe('1.25');
    expect(multiplyDecimalStrings('1', '0.333333')).toBe('0.333333');
    expect(multiplyDecimalStrings('0.1', '0.2')).toBe('0.02');
  });
});

describe('numeric(18,4) fit (the OQ-29 fail-closed gate)', () => {
  it.each(['36', '1.25', '0.0001', '99999999999999.9999', '10.000000'])(
    'fits %s',
    (value) => {
      expect(fitsQuantity(value)).toBe(true);
    },
  );

  it.each([
    '0.333333', // 1 × 1/3-style factor: 6 places, must not be rounded
    '1.00001',
    '100000000000000', // 10^14: over the magnitude
    '99999999999999.99991',
  ])('does not fit %s', (value) => {
    expect(fitsQuantity(value)).toBe(false);
  });
});
