import { describe, expect, it } from 'vitest';
import { baseToDisplayExact, formatQuantity } from './kardex-quantity.js';

describe('Kardex quantity presentation', () => {
  it('formats base quantities at the fixed four-place scale', () => {
    expect(formatQuantity('100')).toBe('100.0000');
    expect(formatQuantity('-12.5')).toBe('-12.5000');
    expect(formatQuantity('0.0001')).toBe('0.0001');
  });

  it('converts base quantities to an alternate unit exactly without floating point', () => {
    expect(baseToDisplayExact('120.0000', '12.000000')).toBe('10.0000');
    expect(baseToDisplayExact('-30.0000', '12')).toBe('-2.5000');
  });

  it('fails closed rather than rounding or truncating', () => {
    expect(baseToDisplayExact('1.0000', '3.000000')).toBeNull();
    expect(baseToDisplayExact('0.0001', '12.000000')).toBeNull();
  });
});
