import { describe, expect, it } from 'vitest';
import {
  resolveEffectivePolicy,
  violatesNegativePolicy,
} from './negative-stock-policy.js';

describe('effective negative-stock policy', () => {
  it('defaults to reject (fail closed)', () => {
    expect(
      resolveEffectivePolicy({ itemAllow: null, warehouseAllow: false }),
    ).toBe(false);
  });

  it('follows the warehouse when the item has no override', () => {
    expect(
      resolveEffectivePolicy({ itemAllow: null, warehouseAllow: true }),
    ).toBe(true);
  });

  it('lets the item override the warehouse in both directions', () => {
    expect(
      resolveEffectivePolicy({ itemAllow: true, warehouseAllow: false }),
    ).toBe(true);
    expect(
      resolveEffectivePolicy({ itemAllow: false, warehouseAllow: true }),
    ).toBe(false);
  });
});

describe('negative policy violation', () => {
  it('rejects any negative level by default', () => {
    expect(violatesNegativePolicy('-0.0001', false)).toBe(true);
    expect(violatesNegativePolicy('-2', false)).toBe(true);
    expect(violatesNegativePolicy('0', false)).toBe(false);
    expect(violatesNegativePolicy('3.5', false)).toBe(false);
  });

  it('allows negative levels when the policy explicitly allows', () => {
    expect(violatesNegativePolicy('-2', true)).toBe(false);
    expect(violatesNegativePolicy('5', true)).toBe(false);
  });
});
