import { describe, expect, it } from 'vitest';
import { toAmountString } from './accounting-documents.repository.js';

/**
 * Focused mapping spec for the document line amount conversion (money
 * semantics consolidation): the helper accepts exactly what the persistence
 * layer produces — canonical strings (in-memory fakes) and Prisma `Decimal`
 * objects with an exact `toString()` (production `numeric(18,2)`) — and
 * refuses everything else loudly, mirroring the accepted Task 10.7 ledger
 * semantics. In particular a JS `number` must never silently become money
 * (contract §13.1/§13.5: exact decimal arithmetic, no float).
 */
describe('toAmountString (document line amounts)', () => {
  it('preserves a string amount verbatim', () => {
    expect(toAmountString('1250.50')).toBe('1250.50');
    expect(toAmountString('0')).toBe('0');
    expect(toAmountString('0.00')).toBe('0.00');
  });

  it('converts a Decimal-like exact value via toString()', () => {
    const decimal = { toString: () => '9999999999999999.99' };
    expect(toAmountString(decimal)).toBe('9999999999999999.99');
  });

  it('refuses a JS number loudly instead of stringifying it', () => {
    expect(() => toAmountString(0.1)).toThrow(/without float semantics/);
    // The float trap itself: 0.1 + 0.2 is not 0.3 in binary floats.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(() => toAmountString(0.1 + 0.2)).toThrow(/without float semantics/);
    expect(() => toAmountString(0)).toThrow(/without float semantics/);
  });

  it('refuses nullish and other non-decimal values loudly', () => {
    expect(() => toAmountString(null)).toThrow(/without float semantics/);
    expect(() => toAmountString(undefined)).toThrow(/without float semantics/);
    expect(() => toAmountString(true)).toThrow(/without float semantics/);
  });
});
