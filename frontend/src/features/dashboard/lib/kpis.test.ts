import { describe, expect, it } from 'vitest';
import {
  aggregateKpis,
  sumDecimalStrings,
  topAccountsByTurnover,
} from './kpis';
import { testAccountBalances } from '@/test/fixtures';

/**
 * KPI aggregation is a pure string transformation over the backend's exact
 * decimal strings — these tests pin the digit-exactness (no float parsing).
 */
describe('sumDecimalStrings', () => {
  it('adds two decimal strings exactly', () => {
    expect(sumDecimalStrings('12000.00', '3000.50')).toBe('15000.50');
  });

  it('never loses precision where a float would round', () => {
    expect(sumDecimalStrings('0.1', '0.2')).toBe('0.3');
    expect(sumDecimalStrings('9007199254740993', '0')).toBe('9007199254740993');
  });

  it('keeps the wider fraction length', () => {
    expect(sumDecimalStrings('1.5', '2.25')).toBe('3.75');
    expect(sumDecimalStrings('-1.005', '0.5')).toBe('-0.505');
  });

  it('normalizes signed fractional results with a leading zero', () => {
    expect(sumDecimalStrings('-1.00', '0.50')).toBe('-0.50');
    expect(sumDecimalStrings('-0.50', '0.25')).toBe('-0.25');
  });

  it('normalizes exact cancellation to unsigned zero', () => {
    expect(sumDecimalStrings('-0.25', '0.25')).toBe('0.00');
  });

  it('adds zero, integers, and negative values without losing precision', () => {
    expect(sumDecimalStrings('0.00', '0.50')).toBe('0.50');
    expect(sumDecimalStrings('2', '0.75')).toBe('2.75');
    expect(sumDecimalStrings('-1.20', '-2.30')).toBe('-3.50');
  });
});

describe('aggregateKpis', () => {
  it('sums the backend rows digit-exactly and groups per period', () => {
    const kpis = aggregateKpis(testAccountBalances);
    expect(kpis.totalDebit).toBe('12000.00');
    expect(kpis.totalCredit).toBe('3000.50');
    expect(kpis.totalNet).toBe('8999.50');
    expect(kpis.periodTurnover).toHaveLength(1);
    expect(kpis.periodTurnover[0]).toMatchObject({
      periodSequence: 1,
      debit: '12000.00',
      credit: '3000.50',
      net: '8999.50',
    });
  });

  it('reads an empty page as zero turnover, not an error', () => {
    const kpis = aggregateKpis([]);
    expect(kpis.totalDebit).toBe('0');
    expect(kpis.totalCredit).toBe('0');
    expect(kpis.totalNet).toBe('0');
    expect(kpis.periodTurnover).toHaveLength(0);
  });
});

describe('topAccountsByTurnover', () => {
  it('ranks accounts by absolute turnover and limits the list', () => {
    const top = topAccountsByTurnover(testAccountBalances, 1);
    expect(top).toHaveLength(1);
    // acc-2: debit 12000.00 + credit 3000.50 = 15000.50 (sum of both sides).
    expect(top[0]).toMatchObject({ accountId: 'acc-2', total: '15000.50' });
  });
});
